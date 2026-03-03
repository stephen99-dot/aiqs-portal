const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { authMiddleware } = require('./auth');
const db = require('./database');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `import-${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Add a new rate manually
router.post('/my-rates/add', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { category, display_name, value, unit, note } = req.body;
    if (!category || !display_name || value === undefined || !unit) {
      return res.status(400).json({ error: 'category, display_name, value, and unit are required' });
    }
    const item_key = display_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const existing = db.prepare('SELECT id FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ? AND is_active = 1').get(userId, category, item_key);
    if (existing) return res.status(409).json({ error: 'Rate already exists in that category. Edit it instead.' });
    const id = 'rl_' + uuidv4().slice(0, 8);
    db.prepare('INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, client_note) VALUES (?, ?, ?, ?, ?, ?, ?, 0.80, ?)').run(id, userId, category, item_key, display_name, parseFloat(value), unit, note || null);
    res.json({ success: true, id, message: 'Added: ' + display_name + ' = ' + value + ' ' + unit });
  } catch(e) { console.error('[Rates] Add:', e); res.status(500).json({ error: 'Failed to add rate' }); }
});

// Delete a rate (soft delete)
router.delete('/my-rates/:rateId', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('UPDATE client_rate_library SET is_active = 0 WHERE id = ? AND user_id = ?').run(req.params.rateId, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Rate not found' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete rate' }); }
});

// Import rates from Excel/CSV
router.post('/my-rates/import', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) return res.status(400).json({ error: 'Upload .xlsx or .csv' });

    let ExcelJS;
    try { ExcelJS = require('exceljs'); } catch(e) { return res.status(500).json({ error: 'Excel not available' }); }

    const wb = new ExcelJS.Workbook();
    if (ext === '.csv') await wb.csv.readFile(req.file.path);
    else await wb.xlsx.readFile(req.file.path);

    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'No worksheet found' });

    // Detect header row and columns
    var headerRow = null;
    var colMap = {};
    for (var r = 1; r <= Math.min(5, ws.rowCount); r++) {
      var row = ws.getRow(r);
      var vals = [];
      row.eachCell({ includeEmpty: true }, function(cell, col) {
        vals.push({ col: col, val: String(cell.value || '').toLowerCase().trim() });
      });
      var hasRate = vals.some(function(v) { return /rate|value|price|cost|amount/i.test(v.val); });
      var hasDesc = vals.some(function(v) { return /desc|name|item|trade|element/i.test(v.val); });
      if (hasRate || hasDesc) {
        headerRow = r;
        for (var i = 0; i < vals.length; i++) {
          var v = vals[i];
          if (/desc|name|item|trade|element|display/i.test(v.val) && !colMap.name) colMap.name = v.col;
          else if (/categor|section|group/i.test(v.val) && !colMap.category) colMap.category = v.col;
          else if (/rate|value|price|cost|amount/i.test(v.val) && !colMap.value) colMap.value = v.col;
          else if (/unit|uom|measure/i.test(v.val) && !colMap.unit) colMap.unit = v.col;
          else if (/note|comment/i.test(v.val) && !colMap.note) colMap.note = v.col;
        }
        break;
      }
    }

    if (!headerRow) {
      headerRow = 0;
      var cc = ws.getRow(1).cellCount;
      if (cc >= 2) { colMap.name = 1; colMap.value = 2; if (cc >= 3) colMap.unit = 3; if (cc >= 4) colMap.category = 4; }
    }

    if (!colMap.name || !colMap.value) {
      return res.status(400).json({ error: 'Could not detect Name and Value columns. Add headers: Description, Rate, Unit, Category' });
    }

    var imported = [];
    var skipped = [];
    var defaultCat = 'general';

    var tx = db.transaction(function() {
      for (var r2 = headerRow + 1; r2 <= ws.rowCount; r2++) {
        var dataRow = ws.getRow(r2);
        var name = String(dataRow.getCell(colMap.name).value || '').trim();
        var rawVal = String(dataRow.getCell(colMap.value).value || '');
        var value = parseFloat(rawVal.replace(/[^0-9.\-]/g, ''));
        var unit = colMap.unit ? String(dataRow.getCell(colMap.unit).value || '').trim() || 'unit' : 'unit';
        var category = colMap.category ? String(dataRow.getCell(colMap.category).value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || defaultCat : defaultCat;
        var note = colMap.note ? String(dataRow.getCell(colMap.note).value || '').trim() : null;

        if (!name || isNaN(value) || value <= 0) { if (name) skipped.push(name); continue; }

        var item_key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 100);
        var existing = db.prepare('SELECT id FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ? AND is_active = 1').get(userId, category, item_key);

        if (existing) {
          db.prepare('UPDATE client_rate_library SET value = ?, unit = ?, confidence = 0.85, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, unit, existing.id);
          imported.push({ name: name, value: value, unit: unit, action: 'updated' });
        } else {
          db.prepare('INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, client_note, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0.85, ?, 1)')
            .run('rl_' + uuidv4().slice(0, 8), userId, category, item_key, name, value, unit, note);
          imported.push({ name: name, value: value, unit: unit, action: 'created' });
        }
      }
    });
    tx();

    try { fs.unlinkSync(req.file.path); } catch(e) {}
    console.log('[Import] ' + imported.length + ' rates imported for ' + req.user.email);
    res.json({ success: true, imported: imported.length, skipped: skipped.length, skipped_items: skipped.slice(0, 10), rates: imported });
  } catch(e) {
    console.error('[Import]', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// Admin: import rates for a specific client
router.post('/admin/import-rates/:clientId', authMiddleware, upload.single('file'), async function(req, res) {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    var targetUserId = req.params.clientId;
    var targetUser = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) return res.status(404).json({ error: 'Client not found' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    var ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.xlsx','.xls','.csv'].includes(ext)) return res.status(400).json({ error: 'Upload .xlsx or .csv' });
    var ExcelJS; try { ExcelJS = require('exceljs'); } catch(e) { return res.status(500).json({ error: 'Excel not available' }); }
    var wb = new ExcelJS.Workbook();
    if (ext === '.csv') await wb.csv.readFile(req.file.path); else await wb.xlsx.readFile(req.file.path);
    var ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'No worksheet' });
    var headerRow = null, colMap = {};
    for (var r = 1; r <= Math.min(5, ws.rowCount); r++) { var row = ws.getRow(r); var vals = []; row.eachCell({ includeEmpty:true }, function(cell,col){ vals.push({col:col,val:String(cell.value||'').toLowerCase().trim()}); }); if (vals.some(function(v){return /rate|value|price|cost|amount/i.test(v.val);}) || vals.some(function(v){return /desc|name|item|trade/i.test(v.val);})) { headerRow=r; for(var i=0;i<vals.length;i++){var v=vals[i]; if(/desc|name|item|trade|element/i.test(v.val)&&!colMap.name)colMap.name=v.col; else if(/categor|section|group/i.test(v.val)&&!colMap.category)colMap.category=v.col; else if(/rate|value|price|cost|amount/i.test(v.val)&&!colMap.value)colMap.value=v.col; else if(/unit|uom/i.test(v.val)&&!colMap.unit)colMap.unit=v.col;} break; } }
    if (!headerRow) { headerRow=0; colMap={name:1,value:2,unit:3,category:4}; }
    if (!colMap.name||!colMap.value) return res.status(400).json({error:'Could not detect columns'});
    var imported=[], skipped=[];
    var tx = db.transaction(function(){ for(var r2=headerRow+1;r2<=ws.rowCount;r2++){var dr=ws.getRow(r2); var nm=String(dr.getCell(colMap.name).value||'').trim(); var vl=parseFloat(String(dr.getCell(colMap.value).value||'').replace(/[^0-9.\-]/g,'')); var un=colMap.unit?String(dr.getCell(colMap.unit).value||'').trim()||'unit':'unit'; var ct=colMap.category?String(dr.getCell(colMap.category).value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_')||'general':'general'; if(!nm||isNaN(vl)||vl<=0){if(nm)skipped.push(nm);continue;} var ik=nm.toLowerCase().replace(/[^a-z0-9]+/g,'_').substring(0,100); var ex=db.prepare('SELECT id FROM client_rate_library WHERE user_id=? AND category=? AND item_key=? AND is_active=1').get(targetUserId,ct,ik); if(ex){db.prepare('UPDATE client_rate_library SET value=?,unit=?,confidence=0.85,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(vl,un,ex.id);imported.push({name:nm,value:vl,action:'updated'});}else{db.prepare('INSERT INTO client_rate_library(id,user_id,category,item_key,display_name,value,unit,confidence,is_active)VALUES(?,?,?,?,?,?,?,0.85,1)').run('rl_'+uuidv4().slice(0,8),targetUserId,ct,ik,nm,vl,un);imported.push({name:nm,value:vl,action:'created'});}} });
    tx();
    try{fs.unlinkSync(req.file.path);}catch(e){}
    console.log('[AdminImport] '+imported.length+' rates for '+targetUser.email);
    res.json({success:true, client:targetUser.full_name||targetUser.email, imported:imported.length, skipped:skipped.length, rates:imported});
  } catch(e) { console.error('[AdminImport]',e); res.status(500).json({error:'Import failed: '+e.message}); }
});

// Admin: get clients list for dropdown
router.get('/admin/clients-list', authMiddleware, function(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({error:'Admin only'});
  res.json({clients: db.prepare("SELECT id,email,full_name,company FROM users WHERE role!='admin' ORDER BY full_name").all()});
});

module.exports = router;
