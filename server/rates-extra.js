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

    var imported = [];
    var skipped = [];
    var sheetsProcessed = [];

    // Helper: detect headers in a worksheet
    function detectColumns(ws) {
      var colMap = {};
      var headerRow = null;
      for (var r = 1; r <= Math.min(5, ws.rowCount); r++) {
        var row = ws.getRow(r);
        var vals = [];
        row.eachCell({ includeEmpty: true }, function(cell, col) {
          vals.push({ col: col, val: String(cell.value || '').toLowerCase().trim() });
        });
        var hasRate = vals.some(function(v) { return /\b(rate|value|price|cost|amount|total)\b/i.test(v.val); });
        var hasDesc = vals.some(function(v) { return /\b(desc|name|item|trade|element)\b/i.test(v.val); });
        if (hasRate || hasDesc) {
          headerRow = r;
          for (var i = 0; i < vals.length; i++) {
            var v = vals[i];
            // Match "Total Rate" before plain "Item" to avoid "Item" grabbing the wrong column
            if (/total\s*rate|total\s*cost|all[\-\s]*in|combined/i.test(v.val) && !colMap.value) colMap.value = v.col;
            else if (/^(desc|name|trade|element|display)/i.test(v.val) && !colMap.name) colMap.name = v.col;
            else if (/categor|section|group/i.test(v.val) && !colMap.category) colMap.category = v.col;
            else if (/\b(rate|value|price|cost|amount)\b/i.test(v.val) && !colMap.value) colMap.value = v.col;
            else if (/\b(unit|uom|measure)\b/i.test(v.val) && !colMap.unit) colMap.unit = v.col;
            else if (/\b(note|comment|remark)\b/i.test(v.val) && !colMap.note) colMap.note = v.col;
            else if (/\blabour\b/i.test(v.val) && !colMap.labour) colMap.labour = v.col;
            else if (/\bmateria/i.test(v.val) && !colMap.materials) colMap.materials = v.col;
          }
          // If we found "Description" but colMap.name ended up with "Item" column, prefer Description
          // Also handle case where "Item" is a code column and "Description" is the name
          if (!colMap.name) {
            for (var i2 = 0; i2 < vals.length; i2++) {
              if (/\bitem\b/i.test(vals[i2].val)) { colMap.item_code = vals[i2].col; }
              if (/\bdesc/i.test(vals[i2].val)) { colMap.name = vals[i2].col; }
            }
            // Fallback: use Item column as name if no Description found
            if (!colMap.name && colMap.item_code) colMap.name = colMap.item_code;
          }
          break;
        }
      }
      // Fallback for headerless sheets
      if (!headerRow) {
        headerRow = 0;
        var cc = ws.getRow(1).cellCount;
        if (cc >= 2) { colMap.name = 1; colMap.value = 2; if (cc >= 3) colMap.unit = 3; }
      }
      return { headerRow: headerRow, colMap: colMap };
    }

    // Process all worksheets (skip INDEX/summary sheets)
    var skipSheets = ['index', 'summary', 'contents', 'cover', 'location factors'];
    
    var tx = db.transaction(function() {
      for (var si = 0; si < wb.worksheets.length; si++) {
        var ws = wb.worksheets[si];
        var sheetName = ws.name || 'Sheet ' + (si + 1);
        
        // Skip non-data sheets
        if (skipSheets.indexOf(sheetName.toLowerCase().trim()) >= 0) continue;
        if (ws.rowCount < 2) continue;

        var detected = detectColumns(ws);
        var headerRow = detected.headerRow;
        var colMap = detected.colMap;

        if (!colMap.name && !colMap.value) continue; // Skip sheets we can't parse

        // Use sheet name as category (cleaned up)
        var sheetCategory = sheetName.toLowerCase()
          .replace(/&/g, '_and_')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .substring(0, 50) || 'general';

        sheetsProcessed.push(sheetName);

        for (var r2 = (headerRow || 0) + 1; r2 <= ws.rowCount; r2++) {
          var dataRow = ws.getRow(r2);
          var name = colMap.name ? String(dataRow.getCell(colMap.name).value || '').trim() : '';
          
          // Skip section header rows (all caps, no value, no unit)
          var rawVal = colMap.value ? String(dataRow.getCell(colMap.value).value || '') : '';
          var value = parseFloat(String(rawVal).replace(/[^0-9.\-]/g, ''));
          
          // If no total rate, try to compute from labour + materials
          if ((isNaN(value) || value <= 0) && colMap.labour && colMap.materials) {
            var lab = parseFloat(String(dataRow.getCell(colMap.labour).value || '').replace(/[^0-9.\-]/g, '')) || 0;
            var mat = parseFloat(String(dataRow.getCell(colMap.materials).value || '').replace(/[^0-9.\-]/g, '')) || 0;
            if (lab + mat > 0) value = lab + mat;
          }

          var unit = colMap.unit ? String(dataRow.getCell(colMap.unit).value || '').trim() || 'unit' : 'unit';
          var category = colMap.category ? String(dataRow.getCell(colMap.category).value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || sheetCategory : sheetCategory;
          var note = colMap.note ? String(dataRow.getCell(colMap.note).value || '').trim() : null;

          if (!name || isNaN(value) || value <= 0) { if (name && name.length > 2) skipped.push(name); continue; }

          var item_key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 100);
          var existing = db.prepare('SELECT id FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ? AND is_active = 1').get(userId, category, item_key);

          if (existing) {
            db.prepare('UPDATE client_rate_library SET value = ?, unit = ?, confidence = 0.85, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, unit, existing.id);
            imported.push({ name: name, value: value, unit: unit, category: category, action: 'updated' });
          } else {
            db.prepare('INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, client_note, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0.85, ?, 1)')
              .run('rl_' + uuidv4().slice(0, 8), userId, category, item_key, name, value, unit, note);
            imported.push({ name: name, value: value, unit: unit, category: category, action: 'created' });
          }
        }
      }
    });
    tx();

    try { fs.unlinkSync(req.file.path); } catch(e) {}
    console.log('[Import] ' + imported.length + ' rates from ' + sheetsProcessed.length + ' sheets imported for ' + req.user.email);
    res.json({ success: true, imported: imported.length, skipped: skipped.length, sheets: sheetsProcessed, skipped_items: skipped.slice(0, 10), rates: imported.slice(0, 20) });
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

    var imported = [];
    var skipped = [];
    var sheetsProcessed = [];
    var skipSheets = ['index', 'summary', 'contents', 'cover', 'location factors'];

    function detectColumnsAdmin(ws) {
      var colMap = {};
      var headerRow = null;
      for (var r = 1; r <= Math.min(5, ws.rowCount); r++) {
        var row = ws.getRow(r);
        var vals = [];
        row.eachCell({ includeEmpty: true }, function(cell, col) {
          vals.push({ col: col, val: String(cell.value || '').toLowerCase().trim() });
        });
        var hasRate = vals.some(function(v) { return /\b(rate|value|price|cost|amount|total)\b/i.test(v.val); });
        var hasDesc = vals.some(function(v) { return /\b(desc|name|item|trade|element)\b/i.test(v.val); });
        if (hasRate || hasDesc) {
          headerRow = r;
          for (var i = 0; i < vals.length; i++) {
            var v = vals[i];
            if (/total\s*rate|total\s*cost|all[\-\s]*in|combined/i.test(v.val) && !colMap.value) colMap.value = v.col;
            else if (/^(desc|name|trade|element|display)/i.test(v.val) && !colMap.name) colMap.name = v.col;
            else if (/categor|section|group/i.test(v.val) && !colMap.category) colMap.category = v.col;
            else if (/\b(rate|value|price|cost|amount)\b/i.test(v.val) && !colMap.value) colMap.value = v.col;
            else if (/\b(unit|uom|measure)\b/i.test(v.val) && !colMap.unit) colMap.unit = v.col;
            else if (/\b(note|comment|remark)\b/i.test(v.val) && !colMap.note) colMap.note = v.col;
            else if (/\blabour\b/i.test(v.val) && !colMap.labour) colMap.labour = v.col;
            else if (/\bmateria/i.test(v.val) && !colMap.materials) colMap.materials = v.col;
          }
          if (!colMap.name) {
            for (var i2 = 0; i2 < vals.length; i2++) {
              if (/\bitem\b/i.test(vals[i2].val)) colMap.item_code = vals[i2].col;
              if (/\bdesc/i.test(vals[i2].val)) colMap.name = vals[i2].col;
            }
            if (!colMap.name && colMap.item_code) colMap.name = colMap.item_code;
          }
          break;
        }
      }
      if (!headerRow) {
        headerRow = 0;
        var cc = ws.getRow(1).cellCount;
        if (cc >= 2) { colMap.name = 1; colMap.value = 2; if (cc >= 3) colMap.unit = 3; }
      }
      return { headerRow: headerRow, colMap: colMap };
    }

    var tx = db.transaction(function() {
      for (var si = 0; si < wb.worksheets.length; si++) {
        var ws = wb.worksheets[si];
        var sheetName = ws.name || 'Sheet ' + (si + 1);
        if (skipSheets.indexOf(sheetName.toLowerCase().trim()) >= 0) continue;
        if (ws.rowCount < 2) continue;

        var detected = detectColumnsAdmin(ws);
        var headerRow = detected.headerRow;
        var colMap = detected.colMap;
        if (!colMap.name && !colMap.value) continue;

        var sheetCategory = sheetName.toLowerCase().replace(/&/g, '_and_').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 50) || 'general';
        sheetsProcessed.push(sheetName);

        for (var r2 = (headerRow || 0) + 1; r2 <= ws.rowCount; r2++) {
          var dataRow = ws.getRow(r2);
          var name = colMap.name ? String(dataRow.getCell(colMap.name).value || '').trim() : '';
          var rawVal = colMap.value ? String(dataRow.getCell(colMap.value).value || '') : '';
          var value = parseFloat(String(rawVal).replace(/[^0-9.\-]/g, ''));

          if ((isNaN(value) || value <= 0) && colMap.labour && colMap.materials) {
            var lab = parseFloat(String(dataRow.getCell(colMap.labour).value || '').replace(/[^0-9.\-]/g, '')) || 0;
            var mat = parseFloat(String(dataRow.getCell(colMap.materials).value || '').replace(/[^0-9.\-]/g, '')) || 0;
            if (lab + mat > 0) value = lab + mat;
          }

          var unit = colMap.unit ? String(dataRow.getCell(colMap.unit).value || '').trim() || 'unit' : 'unit';
          var category = colMap.category ? String(dataRow.getCell(colMap.category).value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || sheetCategory : sheetCategory;
          var note = colMap.note ? String(dataRow.getCell(colMap.note).value || '').trim() : null;

          if (!name || isNaN(value) || value <= 0) { if (name && name.length > 2) skipped.push(name); continue; }

          var ik = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 100);
          var ex = db.prepare('SELECT id FROM client_rate_library WHERE user_id=? AND category=? AND item_key=? AND is_active=1').get(targetUserId, category, ik);
          if (ex) {
            db.prepare('UPDATE client_rate_library SET value=?,unit=?,confidence=0.85,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(value, unit, ex.id);
            imported.push({ name: name, value: value, action: 'updated' });
          } else {
            db.prepare('INSERT INTO client_rate_library(id,user_id,category,item_key,display_name,value,unit,confidence,client_note,is_active)VALUES(?,?,?,?,?,?,?,0.85,?,1)')
              .run('rl_' + uuidv4().slice(0, 8), targetUserId, category, ik, name, value, unit, note);
            imported.push({ name: name, value: value, action: 'created' });
          }
        }
      }
    });
    tx();

    try { fs.unlinkSync(req.file.path); } catch(e) {}
    console.log('[AdminImport] ' + imported.length + ' rates from ' + sheetsProcessed.length + ' sheets for ' + targetUser.email);
    res.json({ success: true, client: targetUser.full_name || targetUser.email, imported: imported.length, skipped: skipped.length, sheets: sheetsProcessed, rates: imported.slice(0, 20) });
  } catch(e) { console.error('[AdminImport]',e); res.status(500).json({error:'Import failed: '+e.message}); }
});

// Admin: get clients list for dropdown
router.get('/admin/clients-list', authMiddleware, function(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({error:'Admin only'});
  res.json({clients: db.prepare("SELECT id,email,full_name,company FROM users WHERE role!='admin' ORDER BY full_name").all()});
});

module.exports = router;
