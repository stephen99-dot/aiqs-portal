import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

const CATEGORY_OPTIONS = [
  { value: 'structural_steel', label: 'Structural Steel' },
  { value: 'architectural_metalwork', label: 'Architectural Metalwork' },
  { value: 'preliminaries', label: 'Preliminaries' },
  { value: 'groundworks', label: 'Groundworks' },
  { value: 'masonry', label: 'Masonry' },
  { value: 'carpentry', label: 'Carpentry' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'plastering', label: 'Plastering' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'decorating', label: 'Decorating' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'demolition', label: 'Demolition' },
  { value: 'partitions', label: 'Partitions' },
  { value: 'general', label: 'General' },
];

const CAT_ICONS = { structural_steel:'🏗️', architectural_metalwork:'🔩', preliminaries:'📋', groundworks:'⛏️', masonry:'🧱', carpentry:'🪵', roofing:'🏠', plastering:'🪣', flooring:'🪨', electrical:'⚡', plumbing:'🔧', mechanical:'🌡️', decorating:'🎨', kitchen:'🍳', bathroom:'🚿', demolition:'💥', partitions:'🧱', general:'📦' };

function getCatLabel(cat) { const f = CATEGORY_OPTIONS.find(c => c.value === cat); return f ? f.label : cat.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
function getCatIcon(cat) { return CAT_ICONS[cat] || '📦'; }

function confidenceBadge(conf, isDark) {
  if (conf >= 0.85) return { text:'Verified', bg:isDark?'rgba(16,185,129,0.15)':'rgba(16,185,129,0.1)', color:isDark?'#34D399':'#059669', border:isDark?'rgba(16,185,129,0.3)':'rgba(16,185,129,0.2)' };
  if (conf >= 0.7) return { text:'Emerging', bg:isDark?'rgba(245,158,11,0.15)':'rgba(245,158,11,0.1)', color:isDark?'#FBBF24':'#D97706', border:isDark?'rgba(245,158,11,0.3)':'rgba(245,158,11,0.2)' };
  return { text:'New', bg:isDark?'rgba(148,163,184,0.15)':'rgba(148,163,184,0.1)', color:isDark?'#94A3B8':'#64748B', border:isDark?'rgba(148,163,184,0.3)':'rgba(148,163,184,0.2)' };
}

export default function MyRatesPage() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [rates, setRates] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ category:'general', display_name:'', value:'', unit:'', note:'' });
  const [addError, setAddError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  const loadRates = useCallback(async () => {
    try {
      const data = await apiFetch('/my-rates');
      setRates(data.rates || []);
      setStats(data.stats || null);
      const cats = {};
      for (const r of (data.rates || [])) cats[r.category] = true;
      setExpandedCats(cats);
    } catch (e) { console.error('Failed to load rates:', e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  const handleSave = async (rate) => {
    const newVal = parseFloat(editValue);
    if (isNaN(newVal) || newVal === rate.value) { setEditingId(null); return; }
    try {
      await apiFetch('/my-rates/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrections: [{ category:rate.category, item_key:rate.item_key, display_name:rate.display_name, value:newVal, unit:rate.unit, original_value:rate.value, note:'Manual edit' }], raw_message:'Edit: '+rate.display_name+' '+rate.value+' -> '+newVal })
      });
      setEditingId(null);
      loadRates();
    } catch (e) { alert('Failed to save.'); }
  };

  const handleAdd = async () => {
    setAddError('');
    if (!addForm.display_name.trim()) { setAddError('Name is required'); return; }
    if (!addForm.value || isNaN(parseFloat(addForm.value))) { setAddError('Valid value is required'); return; }
    if (!addForm.unit.trim()) { setAddError('Unit is required'); return; }
    try {
      const resp = await apiFetch('/my-rates/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category:addForm.category, display_name:addForm.display_name.trim(), value:parseFloat(addForm.value), unit:addForm.unit.trim(), note:addForm.note.trim()||null })
      });
      if (resp.error) { setAddError(resp.error); return; }
      setShowAddForm(false);
      setAddForm({ category:'general', display_name:'', value:'', unit:'', note:'' });
      loadRates();
    } catch (e) { setAddError(e.message || 'Failed to add rate'); }
  };

  const handleDelete = async (rate) => {
    if (!window.confirm('Delete "'+rate.display_name+'"?')) return;
    try { await apiFetch('/my-rates/'+rate.id, { method:'DELETE' }); loadRates(); } catch(e) { alert('Failed to delete.'); }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('aiqs_token');
      const resp = await fetch((process.env.REACT_APP_API_URL||'')+'/api/my-rates/import', { method:'POST', headers:{'Authorization':'Bearer '+token}, body:formData });
      const data = await resp.json();
      if (data.error) setImportResult({ error:data.error }); else { setImportResult(data); loadRates(); }
    } catch(err) { setImportResult({ error:err.message||'Import failed' }); }
    finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value=''; }
  };

  const grouped = {};
  const filtered = search ? rates.filter(r => r.display_name.toLowerCase().includes(search.toLowerCase()) || r.category.toLowerCase().includes(search.toLowerCase())) : rates;
  for (const r of filtered) { if (!grouped[r.category]) grouped[r.category]=[]; grouped[r.category].push(r); }
  const categories = Object.keys(grouped).sort();
  const toggleCat = (cat) => setExpandedCats(prev => ({...prev, [cat]:!prev[cat]}));

  const c = {
    cardBg:isDark?'#0D1117':'#FFFFFF', cardBorder:isDark?'#1E293B':'#E2E8F0',
    rowHover:isDark?'rgba(37,99,235,0.06)':'rgba(37,99,235,0.03)',
    text:isDark?'#F1F5F9':'#1E293B', textSec:isDark?'#94A3B8':'#64748B',
    textMut:isDark?'#64748B':'#94A3B8', accent:'#2563EB',
    inputBg:isDark?'#0D1117':'#F8FAFC', inputBorder:isDark?'#1E293B':'#E2E8F0',
    catBg:isDark?'#111827':'#F1F5F9', catBorder:isDark?'#1E293B':'#E2E8F0', danger:'#EF4444',
  };
  const inputStyle = { padding:'8px 12px', background:c.inputBg, border:'1px solid '+c.inputBorder, borderRadius:'8px', color:c.text, fontSize:'13px', outline:'none', width:'100%' };

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:c.textSec}}><div style={{fontSize:'32px',marginBottom:'12px'}}>🧠</div>Loading your rate library...</div>;

  return (
    <div style={{padding:'24px',maxWidth:'1000px',margin:'0 auto'}}>
      <div style={{marginBottom:'24px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'12px'}}>
          <div>
            <h1 style={{fontSize:'22px',fontWeight:700,color:c.text,margin:0}}>🧠 My Rate Library</h1>
            <p style={{fontSize:'13px',color:c.textSec,margin:'4px 0 0'}}>{isAdmin?'Master rate library — defaults for all projects.':'Your trained rates — used automatically by the AI QS.'}</p>
          </div>
          {stats && stats.total > 0 && (
            <div style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
              <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'10px',padding:'10px 16px',textAlign:'center'}}>
                <div style={{fontSize:'20px',fontWeight:700,color:c.accent}}>{stats.total}</div>
                <div style={{fontSize:'11px',color:c.textMut,marginTop:'2px'}}>Trained Rates</div>
              </div>
              <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'10px',padding:'10px 16px',textAlign:'center'}}>
                <div style={{fontSize:'20px',fontWeight:700,color:stats.avg_confidence>=0.85?(isDark?'#34D399':'#059669'):(isDark?'#FBBF24':'#D97706')}}>{Math.round((stats.avg_confidence||0)*100)}%</div>
                <div style={{fontSize:'11px',color:c.textMut,marginTop:'2px'}}>Avg Confidence</div>
              </div>
            </div>
          )}
        </div>

        {/* Actions row */}
        <div style={{marginTop:'16px',display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center'}}>
          <input type="text" placeholder="Search rates..." value={search} onChange={e=>setSearch(e.target.value)} style={{...inputStyle,maxWidth:'260px',flex:'1 1 200px'}} />
          <button onClick={()=>{setShowAddForm(!showAddForm);setAddError('');}} style={{padding:'8px 16px',background:c.accent,color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>+ Add Rate</button>
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleImport} style={{display:'none'}} />
          <button onClick={()=>fileInputRef.current?.click()} disabled={importing} style={{padding:'8px 16px',background:'transparent',color:c.accent,border:'1px solid '+c.accent,borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:importing?'wait':'pointer',opacity:importing?0.6:1}}>
            {importing?'Importing...':'📄 Import from Excel'}
          </button>
        </div>

        {/* Import result */}
        {importResult && (
          <div style={{marginTop:'12px',padding:'12px 16px',borderRadius:'8px',background:importResult.error?(isDark?'rgba(239,68,68,0.1)':'rgba(239,68,68,0.05)'):(isDark?'rgba(16,185,129,0.1)':'rgba(16,185,129,0.05)'),border:'1px solid '+(importResult.error?(isDark?'rgba(239,68,68,0.3)':'rgba(239,68,68,0.2)'):(isDark?'rgba(16,185,129,0.3)':'rgba(16,185,129,0.2)')),display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:'13px',color:importResult.error?c.danger:(isDark?'#34D399':'#059669')}}>
              {importResult.error ? '❌ '+importResult.error : '✅ Imported '+importResult.imported+' rates'+(importResult.skipped>0?' ('+importResult.skipped+' skipped)':'')}
            </div>
            <button onClick={()=>setImportResult(null)} style={{background:'none',border:'none',color:c.textMut,cursor:'pointer',fontSize:'16px'}}>✕</button>
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <div style={{marginTop:'12px',padding:'16px 20px',background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'10px'}}>
            <div style={{fontSize:'14px',fontWeight:600,color:c.text,marginBottom:'12px'}}>Add New Rate</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
              <div>
                <label style={{fontSize:'11px',color:c.textMut,marginBottom:'4px',display:'block'}}>Category</label>
                <select value={addForm.category} onChange={e=>setAddForm(f=>({...f,category:e.target.value}))} style={{...inputStyle,cursor:'pointer'}}>
                  {CATEGORY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:'11px',color:c.textMut,marginBottom:'4px',display:'block'}}>Rate Name</label>
                <input placeholder="e.g. Labour Rate" value={addForm.display_name} onChange={e=>setAddForm(f=>({...f,display_name:e.target.value}))} style={inputStyle} />
              </div>
              <div>
                <label style={{fontSize:'11px',color:c.textMut,marginBottom:'4px',display:'block'}}>Value</label>
                <input type="number" placeholder="e.g. 52" value={addForm.value} onChange={e=>setAddForm(f=>({...f,value:e.target.value}))} style={inputStyle} />
              </div>
              <div>
                <label style={{fontSize:'11px',color:c.textMut,marginBottom:'4px',display:'block'}}>Unit</label>
                <input placeholder="e.g. /hr, /T, /m2, /day" value={addForm.unit} onChange={e=>setAddForm(f=>({...f,unit:e.target.value}))} style={inputStyle} />
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{fontSize:'11px',color:c.textMut,marginBottom:'4px',display:'block'}}>Note (optional)</label>
                <input placeholder="Any notes..." value={addForm.note} onChange={e=>setAddForm(f=>({...f,note:e.target.value}))} style={inputStyle} />
              </div>
            </div>
            {addError && <div style={{marginTop:'8px',fontSize:'12px',color:c.danger}}>{addError}</div>}
            <div style={{marginTop:'12px',display:'flex',gap:'8px'}}>
              <button onClick={handleAdd} style={{padding:'8px 20px',background:c.accent,color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Save Rate</button>
              <button onClick={()=>setShowAddForm(false)} style={{padding:'8px 16px',background:'transparent',color:c.textSec,border:'1px solid '+c.cardBorder,borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {rates.length === 0 && !showAddForm && (
        <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'12px',padding:'48px 24px',textAlign:'center'}}>
          <div style={{fontSize:'48px',marginBottom:'16px'}}>📐</div>
          <h3 style={{color:c.text,fontSize:'16px',fontWeight:600,margin:'0 0 8px'}}>No rates yet</h3>
          <p style={{color:c.textSec,fontSize:'13px',maxWidth:'420px',margin:'0 auto 20px'}}>Add rates manually, import from Excel, or correct rates in chat.</p>
          <div style={{display:'flex',gap:'10px',justifyContent:'center'}}>
            <button onClick={()=>setShowAddForm(true)} style={{padding:'10px 20px',background:c.accent,color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>+ Add Your First Rate</button>
            <button onClick={()=>fileInputRef.current?.click()} style={{padding:'10px 20px',background:'transparent',color:c.accent,border:'1px solid '+c.accent,borderRadius:'8px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>📄 Import from Excel</button>
          </div>
        </div>
      )}

      {/* Rate categories */}
      {categories.map(cat => {
        const catRates = grouped[cat];
        const isExpanded = expandedCats[cat];
        const avgConf = catRates.reduce((s,r)=>s+(r.confidence||0),0)/catRates.length;
        return (
          <div key={cat} style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'12px',marginBottom:'12px',overflow:'hidden'}}>
            <div onClick={()=>toggleCat(cat)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',cursor:'pointer',background:c.catBg,borderBottom:isExpanded?'1px solid '+c.catBorder:'none'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <span style={{fontSize:'18px'}}>{getCatIcon(cat)}</span>
                <span style={{fontSize:'14px',fontWeight:600,color:c.text}}>{getCatLabel(cat)}</span>
                <span style={{fontSize:'12px',color:c.textMut,background:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.04)',borderRadius:'10px',padding:'2px 8px'}}>{catRates.length} rate{catRates.length!==1?'s':''}</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                {(()=>{const b=confidenceBadge(avgConf,isDark);return <span style={{fontSize:'11px',fontWeight:600,color:b.color,background:b.bg,border:'1px solid '+b.border,borderRadius:'10px',padding:'2px 8px'}}>{b.text}</span>;})()}
                <span style={{fontSize:'16px',color:c.textMut,transform:isExpanded?'rotate(180deg)':'rotate(0)',transition:'transform 0.2s',display:'inline-block'}}>▼</span>
              </div>
            </div>
            {isExpanded && (
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 100px 80px 90px 100px',padding:'8px 20px',fontSize:'11px',fontWeight:600,color:c.textMut,textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:'1px solid '+c.catBorder}}>
                  <div>Rate</div><div style={{textAlign:'right'}}>Value</div><div style={{textAlign:'center'}}>Unit</div><div style={{textAlign:'center'}}>Confidence</div><div style={{textAlign:'center'}}>Actions</div>
                </div>
                {catRates.map(rate=>{
                  const isEditing = editingId===rate.id;
                  const badge = confidenceBadge(rate.confidence,isDark);
                  return (
                    <div key={rate.id} style={{display:'grid',gridTemplateColumns:'1fr 100px 80px 90px 100px',padding:'10px 20px',alignItems:'center',borderBottom:'1px solid '+(isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'),transition:'background 0.1s'}} onMouseEnter={e=>e.currentTarget.style.background=c.rowHover} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div>
                        <div style={{fontSize:'13px',fontWeight:500,color:c.text}}>{rate.display_name}</div>
                        {rate.client_note && <div style={{fontSize:'11px',color:c.textMut,marginTop:'2px'}}>{rate.client_note}</div>}
                      </div>
                      <div style={{textAlign:'right'}}>
                        {isEditing ? (
                          <input type="number" value={editValue} onChange={e=>setEditValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSave(rate);if(e.key==='Escape')setEditingId(null);}} autoFocus style={{width:'80px',padding:'4px 8px',textAlign:'right',background:c.inputBg,border:'1px solid '+c.accent,borderRadius:'6px',color:c.text,fontSize:'13px',outline:'none'}} />
                        ) : (
                          <span style={{fontSize:'13px',fontWeight:600,color:c.text,fontFamily:'monospace'}}>{typeof rate.value==='number'?rate.value.toLocaleString('en-GB'):rate.value}</span>
                        )}
                      </div>
                      <div style={{textAlign:'center',fontSize:'12px',color:c.textSec}}>{rate.unit}</div>
                      <div style={{textAlign:'center'}}><span style={{fontSize:'10px',fontWeight:600,color:badge.color,background:badge.bg,border:'1px solid '+badge.border,borderRadius:'8px',padding:'2px 6px'}}>{badge.text}</span></div>
                      <div style={{textAlign:'center',display:'flex',gap:'4px',justifyContent:'center'}}>
                        {isEditing ? (
                          <>
                            <button onClick={()=>handleSave(rate)} style={{background:isDark?'rgba(16,185,129,0.15)':'rgba(16,185,129,0.1)',border:'none',borderRadius:'6px',padding:'4px 8px',fontSize:'11px',color:isDark?'#34D399':'#059669',cursor:'pointer',fontWeight:600}}>Save</button>
                            <button onClick={()=>setEditingId(null)} style={{background:'transparent',border:'none',padding:'4px 8px',fontSize:'11px',color:c.textMut,cursor:'pointer'}}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={()=>{setEditingId(rate.id);setEditValue(String(rate.value));}} style={{background:'transparent',border:'1px solid '+c.cardBorder,borderRadius:'6px',padding:'4px 8px',fontSize:'11px',color:c.textSec,cursor:'pointer'}}>Edit</button>
                            <button onClick={()=>handleDelete(rate)} style={{background:'transparent',border:'1px solid '+(isDark?'rgba(239,68,68,0.3)':'rgba(239,68,68,0.2)'),borderRadius:'6px',padding:'4px 8px',fontSize:'11px',color:c.danger,cursor:'pointer'}}>✕</button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {rates.length > 0 && (
        <div style={{marginTop:'20px',padding:'16px 20px',background:isDark?'rgba(37,99,235,0.06)':'rgba(37,99,235,0.03)',border:'1px solid '+(isDark?'rgba(37,99,235,0.15)':'rgba(37,99,235,0.1)'),borderRadius:'10px'}}>
          <div style={{fontSize:'13px',color:c.text,fontWeight:500,marginBottom:'6px'}}>💡 How rate training works</div>
          <div style={{fontSize:'12px',color:c.textSec,lineHeight:'1.6'}}>The AI QS uses your trained rates instead of generic UK averages. Add rates manually, import from Excel, or correct rates in chat. The more you use it, the higher the confidence.</div>
        </div>
      )}
      <div style={{marginTop:'12px',padding:'12px 16px',background:isDark?'rgba(255,255,255,0.02)':'rgba(0,0,0,0.015)',borderRadius:'8px'}}>
        <div style={{fontSize:'12px',color:c.textMut}}><strong style={{color:c.textSec}}>Excel import format:</strong> Columns: Description/Name, Rate/Value, Unit (optional), Category (optional). Headers auto-detected.</div>
      </div>
    </div>
  );
}
