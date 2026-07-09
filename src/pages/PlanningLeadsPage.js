import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { canUsePlanningLeads } from '../utils/featureFlags';
import {
  SearchIcon, MapPinIcon, BuildingIcon, MailIcon, ExternalLinkIcon,
  ClockIcon, CheckCircleIcon, AlertTriangleIcon, ArrowRightIcon,
} from '../components/Icons';
import HelpTip from '../components/HelpTip';

const AMBER = '#F59E0B';

const CAT_LABELS = {
  extensions_lofts: 'Extension / loft',
  new_dwellings: 'New dwelling',
  renovation: 'Renovation',
};

export default function PlanningLeadsPage() {
  const { user } = useAuth();
  // Belt-and-braces client guard — the router should already keep others out,
  // and the API returns 404 for anyone not on the allowlist.
  if (!canUsePlanningLeads(user)) {
    return <Navigate />;
  }
  return <Inner />;
}

function Navigate() {
  const nav = useNavigate();
  useEffect(() => { nav('/office', { replace: true }); }, [nav]);
  return null;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();

  const [postcode, setPostcode] = useState('');
  const [radiusKm, setRadiusKm] = useState(8);
  const [categories, setCategories] = useState(['extensions_lofts']);
  const [state, setState] = useState('granted');
  const [monthsBack, setMonthsBack] = useState(6);

  const [config, setConfig] = useState({ categories: [], states: [] });
  const [leads, setLeads] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [diag, setDiag] = useState(null);
  const [draftingRef, setDraftingRef] = useState(null);

  useEffect(() => {
    apiFetch('/planning-leads/config')
      .then(setConfig)
      .catch(() => setConfig({
        categories: [
          { id: 'extensions_lofts', label: 'Extensions, lofts & conversions' },
          { id: 'new_dwellings', label: 'New dwellings' },
          { id: 'renovation', label: 'Renovations & alterations' },
        ],
        states: [
          { id: 'granted', label: 'Recently granted (ready to build)' },
          { id: 'submitted', label: 'Just submitted (get in early)' },
          { id: 'all', label: 'All applications' },
        ],
      }));
  }, []);

  const toggleCat = (id) => setCategories(cs => cs.includes(id) ? cs.filter(c => c !== id) : [...cs, id]);

  const scan = useCallback(async (demo = false) => {
    if (loading) return;
    setLoading(true); setError(''); setNotice(''); setDiag(null);
    try {
      const body = demo
        ? { demo: true }
        : { postcode: postcode.trim(), radiusKm, categories, state, monthsBack };
      const out = await apiFetch('/planning-leads/search', { method: 'POST', body: JSON.stringify(body) });
      setLeads(out.leads || []);
      setMeta({ source: out.source, area: out.area, radiusKm: out.radiusKm });
      if (out.source === 'sample') setNotice('Showing sample data so you can see how it works.');
      else if (out.stale || out.source === 'planit-cached') setNotice('The live service is busy, so these are cached results from a recent scan of this area.');
    } catch (e) {
      const code = e.data?.code;
      setError(e.message || 'Scan failed.');
      if (code === 'RATE_LIMITED' || e.status === 429) {
        // PlanIt is throttling us. Nothing to diagnose — just tell them the wait.
        setNotice('You can preview the tool with sample data while the planning service cools down.');
      } else if (/unreachable|temporarily|502/i.test(e.message || '') || e.status === 502) {
        // If the live service is unreachable, offer the sample so the screen
        // isn't dead, and pull the connectivity probe so the cause is visible.
        setNotice('The live planning service didn’t answer. You can preview the tool with sample data.');
        apiFetch('/planning-leads/diag').then(setDiag).catch(() => {});
      }
    } finally { setLoading(false); }
  }, [loading, postcode, radiusKm, categories, state, monthsBack]);

  const draft = async (lead) => {
    if (draftingRef) return;
    setDraftingRef(lead.ref || lead.address); setError('');
    try {
      const r = await apiFetch('/planning-leads/draft', { method: 'POST', body: JSON.stringify({ lead }) });
      nav('/documents/' + r.id);
    } catch (e) { setError(e.message || 'Could not draft the letter.'); setDraftingRef(null); }
  };

  const canScan = postcode.trim().length >= 2 && categories.length > 0 && !loading;

  return (
    <div style={{ padding: '20px 16px 40px', color: t.text, maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: AMBER, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Office in a Box · Preview
        </div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, letterSpacing: -0.4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <MapPinIcon size={24} color={AMBER} /> Planning Leads
          <HelpTip t={t} title="Planning Leads" text={"Scans local councils for domestic planning applications near you — extensions, lofts, new builds — and turns the recently-approved ones into leads. One tap drafts a branded intro letter you can review, print and post. Posting is the compliant way to reach homeowners directly."} />
        </h1>
        <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4, maxWidth: 620 }}>
          Find homeowners who’ve just had building work approved near you, and draft a headed letter offering them a quote — ready to review, print and post.
        </div>
      </div>

      {/* Scan form */}
      <div style={{ background: t.card, border: '1px solid ' + AMBER + '55', boxShadow: t.shadowSm, borderRadius: 14, padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 180px', minWidth: 150 }}>
            <span style={fieldLabel(t)}>Your postcode</span>
            <input
              value={postcode}
              onChange={e => setPostcode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canScan) scan(false); }}
              placeholder="e.g. SW1A 1AA"
              style={input(t)}
            />
          </label>
          <label style={{ flex: '0 1 130px', minWidth: 110 }}>
            <span style={fieldLabel(t)}>Within</span>
            <select value={radiusKm} onChange={e => setRadiusKm(Number(e.target.value))} style={input(t)}>
              {[3, 5, 8, 12, 16, 24, 40].map(km => <option key={km} value={km}>{Math.round(km * 0.62)} miles</option>)}
            </select>
          </label>
          <label style={{ flex: '1 1 200px', minWidth: 160 }}>
            <span style={fieldLabel(t)}>Status</span>
            <select value={state} onChange={e => setState(e.target.value)} style={input(t)}>
              {config.states.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label style={{ flex: '0 1 130px', minWidth: 110 }}>
            <span style={fieldLabel(t)}>Last</span>
            <select value={monthsBack} onChange={e => setMonthsBack(Number(e.target.value))} style={input(t)}>
              {[1, 3, 6, 12, 24].map(m => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
            </select>
          </label>
        </div>

        {/* Categories */}
        <div style={{ marginTop: 14 }}>
          <span style={fieldLabel(t)}>What work are you after?</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {config.categories.map(c => {
              const on = categories.includes(c.id);
              return (
                <button key={c.id} type="button" onClick={() => toggleCat(c.id)} style={{
                  padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  border: '1px solid ' + (on ? AMBER : t.border),
                  background: on ? AMBER + '22' : t.bg,
                  color: on ? (t.text) : t.textSecondary,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  {on && <CheckCircleIcon size={14} color={AMBER} />}{c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={() => scan(false)} disabled={!canScan} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 46, padding: '0 22px',
            borderRadius: 11, border: 'none', background: AMBER, color: '#0A0F1C',
            fontSize: 15, fontWeight: 800, cursor: canScan ? 'pointer' : 'not-allowed', opacity: canScan ? 1 : 0.5,
          }}>
            <SearchIcon size={17} color="#0A0F1C" /> {loading ? 'Scanning councils…' : 'Scan councils'}
          </button>
          <button onClick={() => scan(true)} disabled={loading} style={{
            minHeight: 46, padding: '0 18px', borderRadius: 11,
            border: '1.5px solid ' + t.border, background: 'transparent', color: t.text,
            fontSize: 14, fontWeight: 700, cursor: loading ? 'progress' : 'pointer',
          }}>
            Try with sample data
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 13.5 }}>
          <AlertTriangleIcon size={16} color={t.danger} /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div style={{ background: AMBER + '18', color: t.text, border: '1px solid ' + AMBER + '55', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
          {notice}
        </div>
      )}
      {diag && (
        <details style={{ marginBottom: 12, fontSize: 12, color: t.textSecondary }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Connection diagnostics (why the scan couldn’t run)</summary>
          <div style={{ marginTop: 8, background: t.bg, border: '1px solid ' + t.border, borderRadius: 8, padding: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {diag.postcodes && (
              <div style={{ marginBottom: 6 }}>
                {diag.postcodes.ok
                  ? `✅ ${diag.postcodes.label} — reachable (HTTP ${diag.postcodes.status}, ${diag.postcodes.ms}ms)`
                  : `❌ ${diag.postcodes.label} — ${diag.postcodes.status ? 'HTTP ' + diag.postcodes.status : ''} ${diag.postcodes.error || ''}${diag.postcodes.bodyStart ? '\n     ' + diag.postcodes.bodyStart : ''}`}
              </div>
            )}
            {Array.isArray(diag.planit) && diag.planit.map((d, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                {d.ok
                  ? `✅ planit.org.uk [${d.shape}] — HTTP ${d.status}, ${d.records} records, ${d.ms}ms`
                  : `❌ planit.org.uk [${d.shape}] — ${d.status ? 'HTTP ' + d.status : ''}${d.note ? ' ' + d.note : ''} ${d.error || ''}${d.bodyStart ? '\n     ' + d.bodyStart : ''}`}
              </div>
            ))}
            <div style={{ color: t.textMuted, marginTop: 4 }}>node {diag.node}</div>
          </div>
        </details>
      )}

      {/* Results */}
      {leads !== null && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {leads.length} lead{leads.length === 1 ? '' : 's'}
              {meta?.area ? <span style={{ color: t.textSecondary, fontWeight: 400 }}> · around {meta.area}</span> : null}
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <MailIcon size={13} /> A posted letter is the compliant way to reach homeowners.
            </div>
          </div>

          {leads.length === 0 ? (
            <div style={{ background: t.card, border: '1px dashed ' + t.border, borderRadius: 12, padding: 36, textAlign: 'center', color: t.textSecondary }}>
              No matching applications in that area and window. Try a wider radius, a longer window, or add more work types.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leads.map((lead, i) => {
                const busy = draftingRef === (lead.ref || lead.address);
                const isGranted = /permit|condition|grant|referr/i.test(lead.state || '');
                return (
                  <div key={(lead.ref || '') + i} style={{ background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm, borderRadius: 14, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: '1 1 380px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontSize: 15, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <MapPinIcon size={15} color={AMBER} /> {lead.address || 'Address not listed'}
                          </span>
                          {lead.category && (
                            <span style={pill(t, AMBER)}>{CAT_LABELS[lead.category] || lead.category}</span>
                          )}
                          {lead.state && (
                            <span style={pill(t, isGranted ? t.success : t.textMuted)}>{lead.state}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13.5, color: t.textSecondary, lineHeight: 1.45 }}>{lead.description}</div>
                        <div style={{ fontSize: 12, color: t.textMuted, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {lead.council && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><BuildingIcon size={12} /> {lead.council}</span>}
                          {(lead.decided_date || lead.submitted_date) && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <ClockIcon size={12} /> {lead.decided_date ? 'Approved ' + lead.decided_date : 'Submitted ' + lead.submitted_date}
                            </span>
                          )}
                          {lead.ref && <span>Ref {lead.ref}</span>}
                          {lead.url && (
                            <a href={lead.url} target="_blank" rel="noreferrer" style={{ color: t.accent, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              Council record <ExternalLinkIcon size={11} color={t.accent} />
                            </a>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                        <button onClick={() => draft(lead)} disabled={busy} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 42, padding: '0 16px',
                          borderRadius: 10, border: 'none', background: AMBER, color: '#0A0F1C',
                          fontSize: 13.5, fontWeight: 800, cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap',
                        }}>
                          <MailIcon size={15} color="#0A0F1C" /> {busy ? 'Drafting…' : 'Draft letter'} {!busy && <ArrowRightIcon size={14} color="#0A0F1C" />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {leads === null && !loading && (
        <div style={{ background: t.card, border: '1px dashed ' + t.border, borderRadius: 12, padding: 36, textAlign: 'center', color: t.textSecondary, fontSize: 14 }}>
          Enter your postcode and hit <strong style={{ color: t.text }}>Scan councils</strong> to find local homeowners with approved building work.
        </div>
      )}
    </div>
  );
}

// ── small style helpers ──
function fieldLabel(t) { return { display: 'block', fontSize: 12, fontWeight: 600, color: t.textSecondary, marginBottom: 4 }; }
function input(t) {
  return {
    width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px',
    background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 10, fontSize: 14.5, outline: 'none',
  };
}
function pill(t, colour) {
  return {
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
    background: colour + '22', color: colour, border: '1px solid ' + colour + '55',
  };
}
