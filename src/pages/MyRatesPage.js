import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import {
  Button, IconButton, Card, Banner, Badge, Stat,
  Input, Select, Field, PageHeader, EmptyState, Skeleton, SkeletonRows, useToast,
} from '../ui';
import { BuildingIcon, BoltIcon, ClipboardIcon, PickaxeIcon, BrickIcon, PlankIcon, HomeIcon, BucketIcon, CubeIcon, ZapIcon, WrenchIcon, ThermometerIcon, PaletteIcon, FryingPanIcon, DropletIcon, BurstIcon, PackageIcon, FileTextIcon, XIcon, CheckCircleIcon, XCircleIcon, RulerIcon, LightbulbIcon } from '../components/Icons';

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

const CAT_ICONS = { structural_steel:BuildingIcon, architectural_metalwork:BoltIcon, preliminaries:ClipboardIcon, groundworks:PickaxeIcon, masonry:BrickIcon, carpentry:PlankIcon, roofing:HomeIcon, plastering:BucketIcon, flooring:CubeIcon, electrical:ZapIcon, plumbing:WrenchIcon, mechanical:ThermometerIcon, decorating:PaletteIcon, kitchen:FryingPanIcon, bathroom:DropletIcon, demolition:BurstIcon, partitions:BrickIcon, general:PackageIcon };

function getCatLabel(cat) { const f = CATEGORY_OPTIONS.find(c => c.value === cat); return f ? f.label : cat.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
function getCatIcon(cat) { return CAT_ICONS[cat] || PackageIcon; }

// Confidence chips map onto the kit's semantic Badge tones.
function confidenceBadge(conf) {
  if (conf >= 0.85) return { text: 'Verified', tone: 'success' };
  if (conf >= 0.7) return { text: 'Emerging', tone: 'warning' };
  return { text: 'New', tone: 'neutral' };
}

export default function MyRatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();

  const [rates, setRates] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editUnit, setEditUnit] = useState('');
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
      for (const r of (data.rates || [])) cats[r.category] = false;
      setExpandedCats(cats);
    } catch (e) { console.error('Failed to load rates:', e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  const handleSave = async (rate) => {
    const newVal = parseFloat(editValue);
    const newUnit = (editUnit || '').trim() || rate.unit;
    const valueChanged = !isNaN(newVal) && newVal !== rate.value;
    const unitChanged = newUnit !== rate.unit;
    if (!valueChanged && !unitChanged) { setEditingId(null); return; }
    const finalVal = valueChanged ? newVal : rate.value;
    try {
      await apiFetch('/my-rates/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrections: [{
            category: rate.category,
            item_key: rate.item_key,
            display_name: rate.display_name,
            value: finalVal,
            unit: newUnit,
            original_value: rate.value,
            note: 'Manual edit',
          }],
          raw_message: 'Edit: ' + rate.display_name + ' ' + rate.value + ' ' + rate.unit + ' -> ' + finalVal + ' ' + newUnit,
        }),
      });
      setEditingId(null);
      loadRates();
    } catch (e) { toast.error('Failed to save.'); }
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
    try { await apiFetch('/my-rates/'+rate.id, { method:'DELETE' }); loadRates(); } catch(e) { toast.error('Failed to delete.'); }
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

  if (loading) {
    return (
      <div className="page">
        <Skeleton width={220} height={24} style={{ marginBottom: 8 }} />
        <Skeleton width={320} height={12} style={{ marginBottom: 24 }} />
        <Card><SkeletonRows rows={6} /></Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="My Rate Library"
        subtitle={isAdmin ? 'Master rate library — defaults for all projects.' : 'Your trained rates — used automatically by the AI QS.'}
        actions={stats && stats.total > 0 ? (
          <>
            <Stat value={stats.total} label="Trained Rates" accent />
            <Stat value={`${Math.round((stats.avg_confidence || 0) * 100)}%`} label="Avg Confidence" />
          </>
        ) : null}
      />

      {/* Actions row */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input
          type="text" placeholder="Search rates..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 260, flex: '1 1 200px', width: 'auto' }}
        />
        <Button onClick={() => { setShowAddForm(!showAddForm); setAddError(''); }}>+ Add Rate</Button>
        <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleImport} style={{ display: 'none' }} />
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? 'Importing...' : <><FileTextIcon size={14} /> Import from Excel</>}
        </Button>
      </div>

      {/* Import result */}
      {importResult && (
        <Banner tone={importResult.error ? 'danger' : 'success'}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{
              fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: 6,
              color: importResult.error ? 'var(--danger)' : 'var(--success)',
            }}>
              {importResult.error
                ? <><XCircleIcon size={16} /> {importResult.error}</>
                : <><CheckCircleIcon size={16} /> Imported {importResult.imported} rates{importResult.skipped > 0 ? ' (' + importResult.skipped + ' skipped)' : ''}</>}
            </div>
            <IconButton onClick={() => setImportResult(null)} title="Dismiss" aria-label="Dismiss"><XIcon size={16} /></IconButton>
          </div>
        </Banner>
      )}

      {/* Add form */}
      {showAddForm && (
        <Card style={{ marginBottom: 16 }}>
          <Card.Header title="Add New Rate" />
          <Card.Body>
            <div className="ui-grid" style={{ '--grid-min': '200px' }}>
              <Field label="Category">
                <Select value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Rate Name">
                <Input placeholder="e.g. Labour Rate" value={addForm.display_name} onChange={e => setAddForm(f => ({ ...f, display_name: e.target.value }))} />
              </Field>
              <Field label="Value">
                <Input type="number" inputMode="decimal" placeholder="e.g. 52" value={addForm.value} onChange={e => setAddForm(f => ({ ...f, value: e.target.value }))} />
              </Field>
              <Field label="Unit">
                <Input placeholder="e.g. /hr, /T, /m2, /day" value={addForm.unit} onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))} />
              </Field>
              <Field label="Note (optional)" style={{ gridColumn: '1/-1' }}>
                <Input placeholder="Any notes..." value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))} />
              </Field>
            </div>
            {addError && <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--danger)' }}>{addError}</div>}
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <Button onClick={handleAdd} busyLabel="Saving…">Save Rate</Button>
              <Button variant="secondary" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* Empty state */}
      {rates.length === 0 && !showAddForm && (
        <Card>
          <EmptyState
            icon={RulerIcon}
            title="No rates yet"
            body="Add rates manually, import from Excel, or correct rates in chat."
            action={
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button onClick={() => setShowAddForm(true)}>+ Add Your First Rate</Button>
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  <FileTextIcon size={14} /> Import from Excel
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {/* Rate categories */}
      {categories.map(cat => {
        const catRates = grouped[cat];
        const isExpanded = expandedCats[cat];
        const avgConf = catRates.reduce((s,r)=>s+(r.confidence||0),0)/catRates.length;
        const CatIcon = getCatIcon(cat);
        const avgBadge = confidenceBadge(avgConf);
        return (
          <Card key={cat} style={{ marginBottom: 12 }}>
            <div
              onClick={() => toggleCat(cat)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '13px 20px', cursor: 'pointer',
                background: 'var(--surface-hover)',
                borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <CatIcon size={18} />
                <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{getCatLabel(cat)}</span>
                <Badge tone="neutral" pill>{catRates.length} rate{catRates.length !== 1 ? 's' : ''}</Badge>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <Badge tone={avgBadge.tone} pill>{avgBadge.text}</Badge>
                <span style={{
                  fontSize: '1rem', color: 'var(--text-muted)', display: 'inline-block',
                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s',
                }}>▼</span>
              </div>
            </div>
            {isExpanded && (
              <Card.Body flush>
                {catRates.map(rate => {
                  const isEditing = editingId === rate.id;
                  const badge = confidenceBadge(rate.confidence);
                  return (
                    <div key={rate.id} className="ui-row">
                      <div className="ui-row__main">
                        <div className="ui-row__title" style={{ fontSize: '0.84rem', fontWeight: 500 }}>{rate.display_name}</div>
                        {rate.client_note && <div className="ui-row__meta">{rate.client_note}</div>}
                      </div>
                      <div className="ui-row__side">
                        {isEditing ? (
                          <>
                            <Input
                              type="number" inputMode="decimal" value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSave(rate); if (e.key === 'Escape') setEditingId(null); }}
                              autoFocus
                              style={{ width: 90, textAlign: 'right' }}
                            />
                            <Input
                              type="text" value={editUnit}
                              onChange={e => setEditUnit(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSave(rate); if (e.key === 'Escape') setEditingId(null); }}
                              placeholder="£/m2"
                              style={{ width: 72, textAlign: 'center' }}
                            />
                            <Button size="sm" onClick={() => handleSave(rate)} busyLabel="Saving…">Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                              {typeof rate.value === 'number' ? rate.value.toLocaleString('en-GB') : rate.value}
                            </span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: 36 }}>{rate.unit}</span>
                            <Badge tone={badge.tone}>{badge.text}</Badge>
                            <Button size="sm" variant="secondary" onClick={() => { setEditingId(rate.id); setEditValue(String(rate.value)); setEditUnit(rate.unit || ''); }}>Edit</Button>
                            <IconButton danger onClick={() => handleDelete(rate)} title="Delete rate" aria-label="Delete rate"><XIcon size={14} /></IconButton>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Card.Body>
            )}
          </Card>
        );
      })}

      {rates.length > 0 && (
        <Banner tone="info" style={{ marginTop: 20 }}>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 6 }}>
            <LightbulbIcon size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />How rate training works
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>The AI QS uses your trained rates instead of generic UK averages. Add rates manually, import from Excel, or correct rates in chat. The more you use it, the higher the confidence.</div>
        </Banner>
      )}
      <div style={{ marginTop: 12, padding: '12px 16px', background: 'var(--surface-hover)', borderRadius: 8 }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text-secondary)' }}>Excel import format:</strong> Columns: Description/Name, Rate/Value, Unit (optional), Category (optional). Headers auto-detected.</div>
      </div>
    </div>
  );
}
