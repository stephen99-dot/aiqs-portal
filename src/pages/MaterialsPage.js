import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import MaterialThumb from '../components/MaterialThumb';
import { CheckIcon, XIcon, EditIcon } from '../components/Icons';

// ─── UK Materials Pricing — standalone search / compare page ────────────────────
// Fuzzy search across canonical_name + aliases; pick a material to see every
// supplier price sorted cheapest→dearest with cheapest/dearest highlighted,
// last-verified date, stock flag, a Verify link, and a STALE badge (>30 days).
// Manual entry, CSV import and public-URL scraping all flow through here.

export default function MaterialsPage() {
  return <EstimatorGate><MaterialsPageInner /></EstimatorGate>;
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}
function money(n) {
  return n == null ? '—' : '£' + Number(n).toFixed(2);
}

function MaterialsPageInner() {
  const { t } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [browseAll, setBrowseAll] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { material, prices, stale_days }
  const [sort, setSort] = useState('asc');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [suppliers, setSuppliers] = useState([]);
  const [feasOpen, setFeasOpen] = useState(false);
  const [feasibility, setFeasibility] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showNewMaterial, setShowNewMaterial] = useState(false);
  const [showBulkScrape, setShowBulkScrape] = useState(false);
  const debounceRef = useRef(null);

  const loadMeta = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        apiFetch('/materials/meta/suppliers'),
        apiFetch('/materials/meta/feasibility'),
      ]);
      setSuppliers(s.suppliers || []);
      setFeasibility(f || null);
    } catch (e) { /* non-fatal */ }
  }, []);

  const loadBrowse = useCallback(async () => {
    try {
      const data = await apiFetch('/materials');
      setBrowseAll(data.materials || []);
    } catch (e) { setError(e.message || 'Failed to load materials'); }
  }, []);

  useEffect(() => { loadMeta(); loadBrowse(); }, [loadMeta, loadBrowse]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.trim().length < 2) { setResults([]); setSearching(false); return undefined; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiFetch('/materials/search?q=' + encodeURIComponent(query.trim()));
        setResults(data.results || []);
      } catch (e) { setResults([]); }
      finally { setSearching(false); }
    }, 220);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query]);

  const loadDetail = useCallback(async (id, sortDir) => {
    if (!id) return;
    setLoadingDetail(true);
    setError('');
    try {
      const data = await apiFetch('/materials/' + id + '?sort=' + (sortDir || sort));
      setDetail(data);
    } catch (e) { setError(e.message || 'Failed to load material'); }
    finally { setLoadingDetail(false); }
  }, [sort]);

  const selectMaterial = (id) => { setSelectedId(id); loadDetail(id, sort); };
  const toggleSort = () => {
    const next = sort === 'asc' ? 'desc' : 'asc';
    setSort(next);
    if (selectedId) loadDetail(selectedId, next);
  };

  const afterMutation = () => {
    if (selectedId) loadDetail(selectedId, sort);
    loadBrowse();
  };

  const listToShow = query.trim().length >= 2 ? results : browseAll;
  // Catalogue can run to 1000+ items — cap what we render so the list stays
  // snappy; the search bar is the way to reach the rest.
  const RENDER_CAP = 400;
  const shownList = listToShow.slice(0, RENDER_CAP);

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: t.text }}>Materials prices</h1>
          <p style={{ color: t.textSecondary, fontSize: 14, marginTop: 6, maxWidth: 640 }}>
            Search the catalogue, compare supplier prices, and drop a chosen variant
            straight into a quote. Every price links back to its source and shows
            when it was last verified.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowNewMaterial(true)} style={btn(t, 'ghost')}>+ New material</button>
          <button onClick={() => setShowImport(true)} style={btn(t, 'ghost')}>Import CSV</button>
          <button onClick={() => setShowBulkScrape(true)} style={btn(t, 'ghost')}>Bulk scrape</button>
          <button onClick={() => setFeasOpen(o => !o)} style={btn(t, 'ghost')}>Supplier feasibility</button>
        </div>
      </div>

      {feasOpen && feasibility && <FeasibilityPanel t={t} f={feasibility} />}

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: '10px 14px', borderRadius: 8, marginTop: 14, fontSize: 14 }}>{error}</div>}

      {/* Search bar */}
      <div style={{ marginTop: 18, position: 'relative' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Search materials — e.g. "4x2 wood", "4 by 2", "47x100", "plasterboard"'
          style={{
            width: '100%', boxSizing: 'border-box', background: t.inputBg,
            border: '1px solid ' + t.border, color: t.text, borderRadius: 10,
            padding: '12px 16px', fontSize: 15, outline: 'none',
          }}
        />
        {searching && <div style={{ position: 'absolute', right: 14, top: 13, fontSize: 12, color: t.textMuted }}>searching…</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        {/* Results / catalogue list */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + t.border, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, color: t.textSecondary }}>
            {query.trim().length >= 2 ? `Matches (${listToShow.length})` : `Catalogue (${listToShow.length})`}
            {listToShow.length > shownList.length && <span style={{ textTransform: 'none', letterSpacing: 0, color: t.textMuted }}> · showing first {shownList.length}, search to narrow</span>}
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {listToShow.length === 0 && (
              <div style={{ padding: 16, color: t.textMuted, fontSize: 13 }}>
                {query.trim().length >= 2 ? 'No matches. Try a different term or add a new material.' : 'No materials yet.'}
              </div>
            )}
            {shownList.map(m => {
              const active = m.id === selectedId;
              return (
                <button key={m.id} onClick={() => selectMaterial(m.id)} style={{
                  display: 'flex', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', alignItems: 'flex-start',
                  background: active ? t.surface : 'transparent', color: t.text,
                  border: 'none', borderBottom: '1px solid ' + t.border, padding: '10px 14px',
                  borderLeft: active ? '3px solid ' + t.accent : '3px solid transparent',
                }}>
                  <MaterialThumb src={m.image_url} alt={m.canonical_name} size={40} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{m.canonical_name}</div>
                    <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span>{m.category || 'Uncategorised'}</span>
                      {(m.price_count ?? m.count) > 0
                        ? <span>· {money(m.min_price)}{m.min_price !== m.max_price ? '–' + money(m.max_price) : ''}</span>
                        : <span>· no prices</span>}
                      {(m.stale_count) > 0 && <span style={{ color: t.warning }}>· {m.stale_count} stale</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail / comparison */}
        <div>
          {!detail && <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 40, textAlign: 'center', color: t.textMuted }}>
            Select a material to compare supplier prices.
          </div>}
          {detail && (
            <MaterialDetail
              t={t}
              detail={detail}
              sort={sort}
              loading={loadingDetail}
              suppliers={suppliers}
              onToggleSort={toggleSort}
              onChanged={afterMutation}
              onSupplierAdded={loadMeta}
              onDeletedMaterial={() => { setDetail(null); setSelectedId(null); loadBrowse(); }}
            />
          )}
        </div>
      </div>

      {showImport && <ImportModal t={t} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); afterMutation(); }} />}
      {showNewMaterial && <NewMaterialModal t={t} onClose={() => setShowNewMaterial(false)} onCreated={(id) => { setShowNewMaterial(false); loadBrowse(); if (id) selectMaterial(id); }} />}
      {showBulkScrape && <BulkScrapeModal t={t} onClose={() => setShowBulkScrape(false)} onDone={() => { afterMutation(); }} />}
    </div>
  );
}

// ─── Material detail + price comparison table ──────────────────────────────────
function MaterialDetail({ t, detail, sort, loading, suppliers, onToggleSort, onChanged, onSupplierAdded, onDeletedMaterial }) {
  const { material, prices, stale_days } = detail;
  const [adding, setAdding] = useState(false);
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeBusy, setScrapeBusy] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState('');

  const runScrape = async () => {
    if (!scrapeUrl.trim()) return;
    setScrapeBusy(true); setScrapeMsg('');
    try {
      const r = await apiFetch('/materials/scrape', { method: 'POST', body: JSON.stringify({ url: scrapeUrl.trim(), material_id: material.id }) });
      setScrapeMsg('Captured ' + money(r.scraped.price) + ' from ' + r.scraped.supplier + '.');
      setScrapeUrl('');
      onChanged();
    } catch (e) {
      setScrapeMsg(e.message || 'Scrape failed.');
    } finally { setScrapeBusy(false); }
  };

  const delMaterial = async () => {
    if (!window.confirm('Delete "' + material.canonical_name + '" and all its price entries?')) return;
    try { await apiFetch('/materials/' + material.id, { method: 'DELETE' }); onDeletedMaterial(); }
    catch (e) { window.alert(e.message || 'Delete failed'); }
  };

  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid ' + t.border }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{material.canonical_name}</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}>
              {material.category || 'Uncategorised'} · default unit: {material.default_unit || '—'}
            </div>
          </div>
          <button onClick={delMaterial} style={{ background: 'transparent', border: '1px solid ' + t.border, color: t.danger, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Delete</button>
        </div>
        {material.spec_notes && <div style={{ fontSize: 13, color: t.textSecondary, marginTop: 8 }}>{material.spec_notes}</div>}
        {material.search_aliases && <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6 }}>aliases: {material.search_aliases}</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid ' + t.border }}>
        <div style={{ fontSize: 12, color: t.textSecondary }}>{prices.length} supplier price{prices.length === 1 ? '' : 's'}</div>
        <button onClick={onToggleSort} style={btn(t, 'ghost')}>Price {sort === 'asc' ? '↑ low→high' : '↓ high→low'}</button>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: t.textMuted }}>Loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: t.surface, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: t.textSecondary }}>
              <th style={thc}></th>
              <th style={thc}>Supplier</th>
              <th style={{ ...thc, textAlign: 'right' }}>Price</th>
              <th style={thc}>Unit</th>
              <th style={thc}>Verified</th>
              <th style={thc}>Stock</th>
              <th style={thc}></th>
              <th style={thc}></th>
            </tr>
          </thead>
          <tbody>
            {prices.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: t.textMuted, fontSize: 13 }}>No prices yet — add one below, scrape a public URL, or import CSV.</td></tr>
            )}
            {prices.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid ' + t.border, background: p.is_cheapest ? t.successBg : p.is_most_expensive ? t.dangerBg : 'transparent' }}>
                <td style={tdc}>
                  <MaterialThumb src={p.image_url || material.image_url} alt={material.canonical_name} size={40} showLabel={!(p.image_url || material.image_url)} />
                </td>
                <td style={tdc}>
                  <span style={{ fontWeight: 600 }}>{p.supplier_name}</span>
                  {p.is_cheapest && <span style={badge(t.success)}>cheapest</span>}
                  {p.is_most_expensive && <span style={badge(t.danger)}>dearest</span>}
                  <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>{p.captured_via}{p.supplier_account_type ? ' · ' + p.supplier_account_type : ''}</div>
                </td>
                <td style={{ ...tdc, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{money(p.price)}</td>
                <td style={tdc}>{p.unit || material.default_unit || '—'}</td>
                <td style={tdc}>
                  {fmtDate(p.captured_at)}
                  {p.is_stale && <span style={{ ...badge(t.warning), background: t.warningBg, color: t.warning }}>STALE &gt;{stale_days}d</span>}
                </td>
                <td style={tdc}>{p.in_stock ? <span style={{ color: t.success }}>in stock</span> : <span style={{ color: t.danger }}>out</span>}</td>
                <td style={tdc}>
                  {p.source_url
                    ? <a href={p.source_url} target="_blank" rel="noopener noreferrer" style={{ color: t.accent, fontSize: 13 }}>Verify ↗</a>
                    : <span style={{ color: t.textMuted, fontSize: 12 }}>no link</span>}
                </td>
                <td style={tdc}>
                  <PriceRowActions t={t} entry={p} materialUnit={material.default_unit} onChanged={onChanged} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add / scrape */}
      <div style={{ borderTop: '1px solid ' + t.border, padding: 14 }}>
        {!adding
          ? <button onClick={() => setAdding(true)} style={btn(t, 'primary')}>+ Add price entry</button>
          : <AddPriceForm t={t} material={material} suppliers={suppliers} onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged(); }} onSupplierAdded={onSupplierAdded} />}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed ' + t.border }}>
          <div style={{ fontSize: 12, color: t.textSecondary, marginBottom: 6 }}>Capture from a public product URL (Screwfix, Toolstation, Wickes, B&Q, Selco)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={scrapeUrl} onChange={e => setScrapeUrl(e.target.value)} placeholder="https://www.screwfix.com/p/…"
              style={{ flex: 1, background: t.inputBg, border: '1px solid ' + t.border, color: t.text, borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none' }} />
            <button onClick={runScrape} disabled={scrapeBusy || !scrapeUrl.trim()} style={btn(t, 'primary')}>{scrapeBusy ? 'Scraping…' : 'Scrape'}</button>
          </div>
          {scrapeMsg && <div style={{ fontSize: 12, color: scrapeMsg.startsWith('Captured') ? t.success : t.danger, marginTop: 6 }}>{scrapeMsg}</div>}
        </div>
      </div>
    </div>
  );
}

function PriceRowActions({ t, entry, materialUnit, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(entry.price);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try { await apiFetch('/materials/price-entries/' + entry.id, { method: 'PATCH', body: JSON.stringify({ price: parseFloat(price), reverify: true }) }); setEditing(false); onChanged(); }
    catch (e) { window.alert(e.message || 'Update failed'); } finally { setBusy(false); }
  };
  const reverify = async () => {
    setBusy(true);
    try { await apiFetch('/materials/price-entries/' + entry.id, { method: 'PATCH', body: JSON.stringify({ reverify: true }) }); onChanged(); }
    catch (e) { window.alert(e.message || 'Failed'); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm('Delete this price entry?')) return;
    try { await apiFetch('/materials/price-entries/' + entry.id, { method: 'DELETE' }); onChanged(); }
    catch (e) { window.alert(e.message || 'Delete failed'); }
  };

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} style={{ width: 70, background: t.inputBg, border: '1px solid ' + t.border, color: t.text, borderRadius: 4, padding: '3px 5px', fontSize: 12 }} />
        <button onClick={save} disabled={busy} style={miniBtn(t, t.accent)}><CheckIcon size={12} /></button>
        <button onClick={() => setEditing(false)} style={miniBtn(t, t.textMuted)}><XIcon size={12} /></button>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, fontSize: 12 }}>
      <button onClick={() => setEditing(true)} title="Edit price" style={linkBtn(t, t.accent)}>edit</button>
      <button onClick={reverify} title="Mark verified today" style={linkBtn(t, t.success)}>re-verify</button>
      <button onClick={del} title="Delete entry" style={linkBtn(t, t.danger)}>del</button>
    </span>
  );
}

function AddPriceForm({ t, material, suppliers, onCancel, onAdded, onSupplierAdded }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [newSupplier, setNewSupplier] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState(material.default_unit || '');
  const [sourceUrl, setSourceUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [inStock, setInStock] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!price || isNaN(parseFloat(price))) { setErr('Enter a numeric price.'); return; }
    if (!supplierId && !newSupplier.trim()) { setErr('Choose or name a supplier.'); return; }
    setBusy(true); setErr('');
    try {
      const body = {
        material_id: material.id, price: parseFloat(price), unit, source_url: sourceUrl || null,
        image_url: imageUrl || null, in_stock: inStock, notes, captured_via: 'manual',
      };
      if (newSupplier.trim()) body.supplier_name = newSupplier.trim();
      else body.supplier_id = supplierId;
      await apiFetch('/materials/price-entries', { method: 'POST', body: JSON.stringify(body) });
      if (newSupplier.trim()) onSupplierAdded();
      onAdded();
    } catch (e) { setErr(e.message || 'Failed to add'); } finally { setBusy(false); }
  };

  return (
    <div style={{ background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={lbl(t)}>Supplier
          <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={inp(t)}>
            <option value="">— choose —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label style={lbl(t)}>…or new supplier
          <input value={newSupplier} onChange={e => setNewSupplier(e.target.value)} placeholder="e.g. MKM" style={inp(t)} />
        </label>
        <label style={lbl(t)}>Price (£)
          <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} style={inp(t)} />
        </label>
        <label style={lbl(t)}>Unit
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder={material.default_unit || 'each'} style={inp(t)} />
        </label>
        <label style={{ ...lbl(t), gridColumn: '1 / -1' }}>Source URL (for audit)
          <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…" style={inp(t)} />
        </label>
        <label style={{ ...lbl(t), gridColumn: '1 / -1' }}>Image URL (optional)
          <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…/product.jpg" style={inp(t)} />
        </label>
        <label style={{ ...lbl(t), flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={inStock} onChange={e => setInStock(e.target.checked)} /> In stock
        </label>
        <label style={lbl(t)}>Notes
          <input value={notes} onChange={e => setNotes(e.target.value)} style={inp(t)} />
        </label>
      </div>
      {err && <div style={{ color: t.danger, fontSize: 12, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={submit} disabled={busy} style={btn(t, 'primary')}>{busy ? 'Saving…' : 'Save price'}</button>
        <button onClick={onCancel} style={btn(t, 'ghost')}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Feasibility panel ──────────────────────────────────────────────────────
function FeasibilityPanel({ t, f }) {
  const Col = ({ title, items, colour }) => (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: colour, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
      {items.map((s, i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
          <div style={{ fontSize: 12, color: t.textMuted }}>{s.note}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Col title={<><CheckIcon size={12} style={{ verticalAlign: 'middle' }} /> Automatable (public prices)</>} items={f.automatable} colour={t.success} />
        <Col title={<><EditIcon size={12} style={{ verticalAlign: 'middle' }} /> Manual / CSV only</>} items={f.manual_only} colour={t.warning} />
      </div>
      <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 12, borderTop: '1px solid ' + t.border, paddingTop: 10 }}>{f.caveats}</div>
    </div>
  );
}

// ─── New material modal ──────────────────────────────────────────────────────
function NewMaterialModal({ t, onClose, onCreated }) {
  const [f, setF] = useState({ canonical_name: '', category: '', default_unit: '', search_aliases: '', spec_notes: '', image_url: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const submit = async () => {
    if (!f.canonical_name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try { const r = await apiFetch('/materials', { method: 'POST', body: JSON.stringify(f) }); onCreated(r.id); }
    catch (e) { setErr(e.message || 'Failed'); } finally { setBusy(false); }
  };
  return (
    <Modal t={t} title="New material" onClose={onClose}>
      <label style={lbl(t)}>Canonical name
        <input value={f.canonical_name} onChange={e => set('canonical_name', e.target.value)} placeholder="e.g. Sawn Timber 47x100mm (4x2) C16 Treated" style={inp(t)} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={lbl(t)}>Category<input value={f.category} onChange={e => set('category', e.target.value)} placeholder="Timber" style={inp(t)} /></label>
        <label style={lbl(t)}>Default unit<input value={f.default_unit} onChange={e => set('default_unit', e.target.value)} placeholder="m" style={inp(t)} /></label>
      </div>
      <label style={lbl(t)}>Search aliases (comma-separated)
        <input value={f.search_aliases} onChange={e => set('search_aliases', e.target.value)} placeholder="4x2, 4 by 2, 47x100, two by four, wood" style={inp(t)} /></label>
      <label style={lbl(t)}>Spec notes
        <input value={f.spec_notes} onChange={e => set('spec_notes', e.target.value)} style={inp(t)} /></label>
      <label style={lbl(t)}>Image URL (optional)
        <input value={f.image_url} onChange={e => set('image_url', e.target.value)} placeholder="https://…/product.jpg" style={inp(t)} /></label>
      {err && <div style={{ color: t.danger, fontSize: 12, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={submit} disabled={busy} style={btn(t, 'primary')}>{busy ? 'Creating…' : 'Create'}</button>
        <button onClick={onClose} style={btn(t, 'ghost')}>Cancel</button>
      </div>
    </Modal>
  );
}

// ─── CSV import modal (parse + column mapping + validation) ─────────────────────
const TARGET_FIELDS = [
  { key: 'canonical_name', label: 'Material name *', required: true },
  { key: 'supplier_name', label: 'Supplier *', required: true },
  { key: 'price', label: 'Price *', required: true },
  { key: 'unit', label: 'Unit' },
  { key: 'category', label: 'Category' },
  { key: 'default_unit', label: 'Default unit' },
  { key: 'search_aliases', label: 'Search aliases' },
  { key: 'source_url', label: 'Source URL' },
  { key: 'image_url', label: 'Image URL' },
  { key: 'in_stock', label: 'In stock' },
  { key: 'notes', label: 'Notes' },
];

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row); }
  return rows;
}

function autoGuess(header) {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (/(material|product|item|name)/.test(h) && !/supplier/.test(h)) return 'canonical_name';
  if (/(supplier|merchant|vendor|store)/.test(h)) return 'supplier_name';
  if (/price|cost|rate/.test(h)) return 'price';
  if (/unit/.test(h)) return 'unit';
  if (/categor/.test(h)) return 'category';
  if (/alias|synonym/.test(h)) return 'search_aliases';
  if (/image|img|photo|thumb/.test(h)) return 'image_url';
  if (/url|link|source/.test(h)) return 'source_url';
  if (/stock|avail/.test(h)) return 'in_stock';
  if (/note/.test(h)) return 'notes';
  return '';
}

function ImportModal({ t, onClose, onDone }) {
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [mapping, setMapping] = useState({}); // colIndex -> field key
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result || ''));
      if (rows.length < 2) { setErr('CSV needs a header row and at least one data row.'); return; }
      const hdr = rows[0];
      setHeaders(hdr);
      setDataRows(rows.slice(1));
      const guess = {};
      hdr.forEach((h, i) => { const g = autoGuess(h); if (g) guess[i] = g; });
      setMapping(guess);
      setErr('');
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    const fieldByCol = mapping;
    const cols = Object.entries(fieldByCol);
    const have = new Set(cols.map(([, f]) => f));
    for (const f of TARGET_FIELDS.filter(f => f.required)) {
      if (!have.has(f.key)) { setErr('Map a column to "' + f.label + '".'); return; }
    }
    const rows = dataRows.map(r => {
      const obj = {};
      cols.forEach(([ci, f]) => { obj[f] = r[ci] != null ? r[ci].trim() : ''; });
      return obj;
    });
    setBusy(true); setErr('');
    try {
      const res = await apiFetch('/materials/import-csv', { method: 'POST', body: JSON.stringify({ rows }) });
      setResult(res);
    } catch (e) { setErr(e.message || 'Import failed'); } finally { setBusy(false); }
  };

  return (
    <Modal t={t} title="Import prices from CSV" onClose={onClose} wide>
      {!headers.length && (
        <div>
          <p style={{ color: t.textSecondary, fontSize: 13 }}>
            Upload a CSV. You'll map its columns to material fields. Required: material name, supplier, price.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ color: t.text }} />
        </div>
      )}
      {headers.length > 0 && !result && (
        <div>
          <div style={{ fontSize: 13, color: t.textSecondary, marginBottom: 10 }}>{dataRows.length} data row{dataRows.length === 1 ? '' : 's'}. Map columns:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
            {headers.map((h, i) => (
              <label key={i} style={lbl(t)}>
                <span style={{ fontSize: 12 }}>{h || '(column ' + (i + 1) + ')'} <span style={{ color: t.textMuted }}>→</span></span>
                <select value={mapping[i] || ''} onChange={e => setMapping(m => ({ ...m, [i]: e.target.value }))} style={inp(t)}>
                  <option value="">— ignore —</option>
                  {TARGET_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          {err && <div style={{ color: t.danger, fontSize: 12, marginTop: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={doImport} disabled={busy} style={btn(t, 'primary')}>{busy ? 'Importing…' : 'Import ' + dataRows.length + ' rows'}</button>
            <button onClick={onClose} style={btn(t, 'ghost')}>Cancel</button>
          </div>
        </div>
      )}
      {result && (
        <div>
          <div style={{ fontSize: 14, color: t.success, marginBottom: 8 }}>
            Imported {result.prices_added} price{result.prices_added === 1 ? '' : 's'} · {result.materials_created} new material{result.materials_created === 1 ? '' : 's'}.
          </div>
          {result.errors?.length > 0 && (
            <div style={{ fontSize: 12, color: t.warning }}>
              {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped:
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {result.errors.slice(0, 8).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
              </ul>
            </div>
          )}
          <button onClick={onDone} style={btn(t, 'primary')}>Done</button>
        </div>
      )}
    </Modal>
  );
}

// ─── Bulk scrape modal ──────────────────────────────────────────────────────
const BULK_SAMPLE = JSON.stringify([
  { material: 'Portland Cement 25kg', category: 'Cement & Aggregates', unit: 'bag', urls: ['https://www.screwfix.com/p/your-product-code'] },
], null, 2);

function BulkScrapeModal({ t, onClose, onDone }) {
  const [text, setText] = useState(BULK_SAMPLE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const run = async () => {
    let items;
    try { items = JSON.parse(text); } catch (e) { setErr('That is not valid JSON.'); return; }
    if (!Array.isArray(items) || items.length === 0) { setErr('Provide a non-empty JSON array of items.'); return; }
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await apiFetch('/materials/scrape-batch', { method: 'POST', body: JSON.stringify({ items }) });
      setResult(res);
      onDone();
    } catch (e) { setErr(e.message || 'Bulk scrape failed.'); } finally { setBusy(false); }
  };

  return (
    <Modal t={t} title="Bulk scrape from product URLs" onClose={onClose} wide>
      <p style={{ color: t.textSecondary, fontSize: 13, marginTop: 0 }}>
        Runs on the server. Each public product URL (Screwfix, Toolstation, Wickes, B&Q, Selco) is
        fetched live and stored with its real source link. Paste a JSON array of items — one per
        material, each with a <code>urls</code> list. Non-public suppliers are skipped automatically.
      </p>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
        Note: this only works where the server can reach those sites (your live deployment), not inside a network-restricted sandbox.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
        style={{ width: '100%', boxSizing: 'border-box', minHeight: 200, fontFamily: 'monospace', fontSize: 12,
          background: t.inputBg, border: '1px solid ' + t.border, color: t.text, borderRadius: 8, padding: 10, outline: 'none' }}
      />
      {err && <div style={{ color: t.danger, fontSize: 12, marginTop: 8 }}>{err}</div>}
      {result && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ color: t.success }}>
            Captured {result.captured} price{result.captured === 1 ? '' : 's'} across {result.materials} material{result.materials === 1 ? '' : 's'}.
            {result.skipped ? ' Skipped ' + result.skipped + '.' : ''}{result.failed ? ' Failed ' + result.failed + '.' : ''}
          </div>
          {result.failed > 0 && (
            <ul style={{ margin: '6px 0', paddingLeft: 18, color: t.warning, fontSize: 12 }}>
              {result.details.filter(d => d.status === 'failed').slice(0, 8).map((d, i) => <li key={i}>{d.material}: {d.error}</li>)}
            </ul>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={run} disabled={busy} style={btn(t, 'primary')}>{busy ? 'Scraping…' : 'Run bulk scrape'}</button>
        <button onClick={onClose} style={btn(t, 'ghost')}>Close</button>
      </div>
    </Modal>
  );
}

function Modal({ t, title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 40, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 22, width: wide ? 640 : 460, maxWidth: '100%', color: t.text }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.textMuted, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Style helpers ──────────────────────────────────────────────────────────
const thc = { padding: '8px 12px', textAlign: 'left' };
const tdc = { padding: '8px 12px', fontSize: 13, verticalAlign: 'top' };
function badge(c) { return { marginLeft: 6, fontSize: 10, color: '#fff', background: c, borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }; }
function btn(t, kind) {
  const base = { borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + t.border };
  if (kind === 'primary') return { ...base, background: t.accent, color: '#fff', border: 'none' };
  return { ...base, background: 'transparent', color: t.text };
}
function miniBtn(t, c) { return { background: 'transparent', border: '1px solid ' + t.border, color: c, borderRadius: 4, padding: '2px 6px', fontSize: 12, cursor: 'pointer' }; }
function linkBtn(t, c) { return { background: 'transparent', border: 'none', color: c, cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }; }
function lbl(t) { return { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: t.textSecondary, marginTop: 8 }; }
function inp(t) { return { background: t.inputBg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '7px 9px', fontSize: 13, outline: 'none' }; }
