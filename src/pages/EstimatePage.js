import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch, authedFetch, portalOrigin } from '../utils/api';
import { saveBlob } from '../native/saveFile';
import { SendingFromNote } from '../components/EmailSenderCard';
import useIsMobile from '../utils/useIsMobile';
import useDataChanged from '../hooks/useDataChanged';
import { openMax, fmtMoney2, fmtMoney0 } from '../utils/max';
import { Button, Card, Badge, PageHeader, Field, Input, Textarea, Modal, SkeletonRows, useToast } from '../ui';
import { AlertTriangleIcon, UploadIcon, DownloadIcon, FileSpreadsheetIcon, SendIcon, SparklesIcon, CopyIcon, TrashIcon, PlusIcon, LockIcon, CheckCircleIcon, LinkIcon } from '../components/Icons';

// ═══ One estimate — MAX's draft, editable line by line ══════════════════════
// Every quantity, rate and assumption MAX used is on this page. The builder
// edits lines and percentages, saves, downloads the branded PDF or Excel, and
// sends the acceptance link to their customer. The small-job verdict is worked
// out live from the edited lines, so an estimate that grows past the limit
// says so before it is sent.

const STATUS_TONE = { draft: 'neutral', sent: 'info', accepted: 'success', won: 'success', lost: 'danger', declined: 'danger', expired: 'warning' };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(num(n) * 100) / 100;

// The same cascade as server/lib/money.js: OH&P and contingency off the net,
// VAT on the lot.
function cascade(lines, header) {
  const net = lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  const ohp = net * num(header.ohp_pct) / 100;
  const cont = net * num(header.contingency_pct) / 100;
  const exVat = net + ohp + cont;
  const vat = exVat * num(header.vat_pct) / 100;
  return { net: round2(net), ohp: round2(ohp), cont: round2(cont), exVat: round2(exVat), vat: round2(vat), grand: round2(exVat + vat) };
}

function verdictFor(exVat, limits) {
  if (!limits) return null;
  if (exVat >= limits.limitGbp) return 'over_limit';
  if (exVat >= limits.noticeGbp) return 'notice';
  return 'ok';
}

const SOURCE_LABEL = { client_verified: ['Your rate', 'own'], override: ['Your rate', 'own'], base_library: ['Library rate', 'lib'], stated_sum: ['Stated sum', 'own'], ai_estimated: ['Estimated rate', 'est'], fallback_estimated: ['Estimated rate', 'est'], fallback_corrected: ['Estimated rate', 'est'], ceiling_clipped: ['Estimated rate', 'est'] };

export default function EstimatePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const isMobile = useIsMobile(760);
  const [quote, setQuote] = useState(null);
  const [lines, setLines] = useState([]);
  const [header, setHeader] = useState({});
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  const load = useCallback(() => {
    return apiFetch('/estimator/quotes/' + id)
      .then((r) => {
        const q = r.quote;
        setQuote(q);
        setLines((r.lines || []).map((l) => ({ ...l })));
        setHeader({ project_name: q.project_name || '', client_name: q.client_name || '', client_email: q.client_email || '', location: q.location || '', notes: q.notes || '', ohp_pct: num(q.ohp_pct), contingency_pct: num(q.contingency_pct), vat_pct: num(q.vat_pct) });
        let m = null; try { m = q.max_meta ? JSON.parse(q.max_meta) : null; } catch (e) { m = null; }
        setMeta(m);
        setSendEmail(q.client_email || '');
        setShareUrl(q.public_token ? portalOrigin() + '/q/' + q.public_token : '');
        setDirty(false);
        setError('');
      })
      .catch((e) => setError(e.message || 'Could not load the estimate.'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useDataChanged(() => { if (!dirty) load(); }, ['estimates']);

  const totals = useMemo(() => cascade(lines, header), [lines, header]);
  const verdict = verdictFor(totals.exVat, user && user.maxLimits);
  const locked = !!(quote && quote.locked);
  const currency = quote && quote.currency;

  const sourceFor = (line) => {
    const rs = meta && Array.isArray(meta.rate_sources) ? meta.rate_sources.find((r) => r.item === line.item) : null;
    const key = rs ? rs.rate_source : (line.est_rate ? 'ai_estimated' : null);
    return key ? SOURCE_LABEL[key] || null : null;
  };

  const setLine = (i, patch) => { setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); setDirty(true); };
  const removeLine = (i) => { setLines((prev) => prev.filter((_, idx) => idx !== i)); setDirty(true); };
  const addLine = (section) => { setLines((prev) => [...prev, { section: section || 'General', item: '', description: '', unit: 'item', qty: 1, rate: 0, labour: 0, materials: 0, est_rate: 0 }]); setDirty(true); };
  const setH = (patch) => { setHeader((h) => ({ ...h, ...patch })); setDirty(true); };

  const save = async () => {
    if (locked) return;
    if (lines.length === 0) { toast.error('An estimate needs at least one line.'); return; }
    setSaving(true);
    try {
      const vd = { status: verdict || 'ok', price_ex_vat: totals.exVat, notice_gbp: user && user.maxLimits ? user.maxLimits.noticeGbp : null, limit_gbp: user && user.maxLimits ? user.maxLimits.limitGbp : null };
      await apiFetch('/estimator/quotes/' + id, { method: 'PATCH', body: JSON.stringify({ ...header, ohp_pct: num(header.ohp_pct), contingency_pct: num(header.contingency_pct), vat_pct: num(header.vat_pct), max_meta: meta ? { ...meta, verdict: { ...(meta.verdict || {}), ...vd }, edited_at: new Date().toISOString() } : undefined }) });
      await apiFetch('/estimator/quotes/' + id + '/lines', { method: 'PUT', body: JSON.stringify({ lines: lines.map((l, i) => ({ ...l, qty: num(l.qty), rate: num(l.rate), labour: num(l.labour), materials: num(l.materials), line_total: round2(num(l.qty) * num(l.rate)), sort_order: i })) }) });
      toast.success('Saved');
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not save.');
    } finally { setSaving(false); }
  };

  const download = async (kind) => {
    try {
      const r = await authedFetch('/api/estimator/quotes/' + id + '/' + kind);
      if (!r.ok) throw new Error('Could not build the ' + (kind === 'pdf' ? 'PDF' : 'spreadsheet') + '.');
      await saveBlob(await r.blob(), (quote.quote_number || 'estimate') + '.' + kind);
    } catch (e) { toast.error(e.message || 'Download failed.'); }
  };

  const send = async () => {
    setSending(true);
    try {
      const r = await apiFetch('/estimator/quotes/' + id + '/send', { method: 'POST', body: JSON.stringify({ client_email: sendEmail.trim() || undefined }) });
      setShareUrl(portalOrigin() + r.path);
      toast.success(r.emailed_to ? 'Sent to ' + r.emailed_to : 'Marked as sent — share the link below');
      await load();
    } catch (e) { toast.error(e.message || 'Could not send.'); }
    finally { setSending(false); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); toast.success('Link copied'); } catch (e) { window.prompt('Copy this link', shareUrl); }
  };

  const duplicate = async () => {
    try { const r = await apiFetch('/estimator/quotes/' + id + '/duplicate', { method: 'POST' }); navigate('/estimates/' + r.id); } catch (e) { toast.error(e.message || 'Could not duplicate.'); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this estimate? This cannot be undone.')) return;
    try { await apiFetch('/estimator/quotes/' + id, { method: 'DELETE' }); toast.success('Estimate deleted'); navigate('/estimates'); } catch (e) { toast.error(e.message || 'Could not delete.'); }
  };

  const sendToTeam = () => {
    const p = new URLSearchParams();
    p.set('from', 'max'); p.set('estimate', id);
    if (quote.project_type) p.set('type', quote.project_type);
    if (header.location) p.set('address', header.location);
    p.set('brief', String(quote.input_text || header.project_name || '').slice(0, 2500));
    navigate('/submit-drawings?' + p.toString());
  };

  if (loading) return <div className="page"><SkeletonRows rows={6} /></div>;
  if (error || !quote) return <div className="page"><Card><Card.Body>{error || 'Not found.'} <Button variant="secondary" size="sm" to="/estimates">Back to estimates</Button></Card.Body></Card></div>;

  // Lines grouped by section, in order of first appearance.
  const sections = [];
  lines.forEach((l, i) => {
    const name = l.section || 'General';
    let s = sections.find((x) => x.name === name);
    if (!s) { s = { name, rows: [] }; sections.push(s); }
    s.rows.push({ line: l, i });
  });
  const estimatedCount = lines.filter((l) => l.est_rate).length;
  const limits = user && user.maxLimits;

  return (
    <div className="page" style={{ paddingBottom: 90 }}>
      <PageHeader
        back={{ to: '/estimates', label: 'Estimates' }}
        kicker={quote.quote_number + (quote.source === 'max' ? ' · Priced by MAX' : '')}
        title={header.project_name || 'Estimate'}
        titleExtra={<Badge tone={STATUS_TONE[quote.status] || 'neutral'} style={{ marginLeft: 10, verticalAlign: 'middle' }}>{quote.status === 'won' ? 'accepted' : quote.status}</Badge>}
        subtitle={[header.client_name, header.location].filter(Boolean).join(' · ') || undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={() => openMax({ prompt: 'On this estimate, ', keyboard: true })}><SparklesIcon size={14} color="currentColor" /> Ask MAX to change it</Button>
            <Button variant="secondary" onClick={() => download('pdf')}><DownloadIcon size={14} color="currentColor" /> PDF</Button>
            <Button variant="secondary" onClick={() => download('xlsx')}><FileSpreadsheetIcon size={14} color="currentColor" /> Excel</Button>
          </>
        )}
      />

      {locked && (
        <div className="est-verdict est-verdict--locked">
          <LockIcon size={18} color="var(--success)" />
          <div className="est-verdict__text"><strong>Accepted by {quote.acceptance_name || 'the customer'}{quote.accepted_at ? ' on ' + new Date(quote.accepted_at).toLocaleDateString('en-GB') : ''} — locked.</strong>This is the version they agreed to. Duplicate it to make a revised estimate.</div>
          <Button variant="secondary" size="sm" onClick={duplicate}><CopyIcon size={13} color="currentColor" /> Duplicate</Button>
        </div>
      )}
      {!locked && verdict === 'over_limit' && (
        <div className="est-verdict est-verdict--over">
          <AlertTriangleIcon size={18} color="var(--danger)" />
          <div className="est-verdict__text"><strong>Over the small-job limit — {fmtMoney0(totals.exVat, currency)} ex VAT is at or above {fmtMoney0(limits.limitGbp)}.</strong>MAX's figures are a rough guide at this size. Send the job to the AI QS team for a full take-off before quoting your customer.</div>
          <Button size="sm" onClick={sendToTeam}><UploadIcon size={13} color="currentColor" /> Send to the AI QS team</Button>
        </div>
      )}
      {!locked && verdict === 'notice' && (
        <div className="est-verdict">
          <AlertTriangleIcon size={18} color="var(--warning)" />
          <div className="est-verdict__text"><strong>Worth a full take-off: {fmtMoney0(totals.exVat, currency)} ex VAT is above {fmtMoney0(limits.noticeGbp)}.</strong>The estimate stands, but on a job this size the AI QS team's take-off from your drawings is the safer figure to quote from.</div>
          <Button variant="secondary" size="sm" onClick={sendToTeam}><UploadIcon size={13} color="currentColor" /> Send to the AI QS team</Button>
        </div>
      )}
      {!locked && estimatedCount > 0 && verdict !== 'over_limit' && (
        <div className="est-verdict" style={{ borderColor: 'var(--border-accent)', background: 'var(--accent-glow)' }}>
          <SparklesIcon size={18} color="var(--accent)" />
          <div className="est-verdict__text"><strong>{estimatedCount} line{estimatedCount === 1 ? '' : 's'} rest{estimatedCount === 1 ? 's' : ''} on an estimated rate.</strong>Neither your rates nor the library had a price for that work, so MAX used a typical UK rate. Check the lines marked "Estimated rate" — or tell MAX your price and it will remember it.</div>
        </div>
      )}

      <Card style={{ marginBottom: 16 }}>
        <Card.Header title="Job and customer" />
        <Card.Body>
          <div className="est-head">
            <Field label="Job name"><Input value={header.project_name} onChange={(e) => setH({ project_name: e.target.value })} disabled={locked} /></Field>
            <Field label="Site address"><Input value={header.location} onChange={(e) => setH({ location: e.target.value })} placeholder="Sets the regional rates" disabled={locked} /></Field>
            <Field label="Customer"><Input value={header.client_name} onChange={(e) => setH({ client_name: e.target.value })} disabled={locked} /></Field>
            <Field label="Customer email"><Input type="email" value={header.client_email} onChange={(e) => setH({ client_email: e.target.value })} placeholder="For the acceptance link" disabled={locked} /></Field>
            <Field label="Notes, assumptions and exclusions (shown on the estimate)" className="est-head__full"><Textarea rows={3} value={header.notes} onChange={(e) => setH({ notes: e.target.value })} disabled={locked} /></Field>
          </div>
        </Card.Body>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Card.Header title="Lines" extra={lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' · rates ex VAT'} />
        <Card.Body flush={!isMobile}>
          {isMobile ? (
            <div className="est-cards">
              {sections.map((s) => (
                <React.Fragment key={s.name}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginTop: 6 }}>{s.name}</div>
                  {s.rows.map(({ line, i }) => {
                    const src = sourceFor(line);
                    return (
                      <div key={line.id || i} className="est-card">
                        <input className="est-in" style={{ font: 'inherit', fontWeight: 700, border: 'none', background: 'transparent', color: 'var(--text-primary)', padding: 0 }} value={line.item} onChange={(e) => setLine(i, { item: e.target.value })} placeholder="Item" disabled={locked} />
                        <textarea rows={2} style={{ font: 'inherit', fontSize: '0.82rem', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, background: 'var(--bg-input)' }} value={line.description || ''} onChange={(e) => setLine(i, { description: e.target.value })} disabled={locked} />
                        <div className="est-card__grid">
                          <div><label>Qty</label><input inputMode="decimal" value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} disabled={locked} /></div>
                          <div><label>Unit</label><input value={line.unit || ''} onChange={(e) => setLine(i, { unit: e.target.value })} disabled={locked} /></div>
                          <div><label>Rate £</label><input inputMode="decimal" value={line.rate} onChange={(e) => setLine(i, { rate: e.target.value, est_rate: 0 })} disabled={locked} /></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{src && <span className={'est-src est-src--' + src[1]}>{src[0]}</span>}</span>
                          <strong style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney2(num(line.qty) * num(line.rate), currency)}</strong>
                          {!locked && <button type="button" className="ui-icon-btn ui-icon-btn--danger" onClick={() => removeLine(i)} aria-label="Remove line"><TrashIcon size={14} /></button>}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <table className="est-table">
              <thead><tr><th style={{ width: '46%' }}>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate £</th><th className="num">Total £</th>{!locked && <th />}</tr></thead>
              <tbody>
                {sections.map((s) => (
                  <React.Fragment key={s.name}>
                    <tr className="est-section"><td colSpan={locked ? 5 : 6}>{s.name}</td></tr>
                    {s.rows.map(({ line, i }) => {
                      const src = sourceFor(line);
                      return (
                        <tr key={line.id || i}>
                          <td>
                            <input className="est-in" value={line.item || ''} onChange={(e) => setLine(i, { item: e.target.value })} placeholder="Item" disabled={locked} style={{ fontWeight: 700, marginBottom: 4 }} />
                            <input className="est-in" value={line.description || ''} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" disabled={locked} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }} />
                            {src && <span className={'est-src est-src--' + src[1]} title={src[1] === 'est' ? 'Not from your rates or the library — check it' : src[1] === 'own' ? 'Your own saved rate' : 'AI QS rate library, adjusted for the site'}>{src[0]}</span>}
                          </td>
                          <td className="num"><input className="est-in num" inputMode="decimal" value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} disabled={locked} /></td>
                          <td><input className="est-in" value={line.unit || ''} onChange={(e) => setLine(i, { unit: e.target.value })} disabled={locked} style={{ minWidth: 50 }} /></td>
                          <td className="num"><input className="est-in num" inputMode="decimal" value={line.rate} onChange={(e) => setLine(i, { rate: e.target.value, est_rate: 0 })} disabled={locked} /></td>
                          <td className="num">{fmtMoney2(num(line.qty) * num(line.rate), currency)}</td>
                          {!locked && <td><button type="button" className="ui-icon-btn ui-icon-btn--danger" onClick={() => removeLine(i)} aria-label="Remove line" title="Remove line"><TrashIcon size={14} /></button></td>}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
          {!locked && (
            <div style={{ padding: isMobile ? '12px 0 0' : 12 }}>
              <Button variant="secondary" size="sm" onClick={() => addLine(sections.length ? sections[sections.length - 1].name : 'General')}><PlusIcon size={13} color="currentColor" /> Add a line</Button>
            </div>
          )}
        </Card.Body>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Card.Body>
          <div className="est-totals">
            <div className="est-totals__k">Net (construction total)</div><div className="est-totals__v">{fmtMoney2(totals.net, currency)}</div>
            <div className="est-totals__k">Overheads &amp; profit <input inputMode="decimal" value={header.ohp_pct} onChange={(e) => setH({ ohp_pct: e.target.value })} disabled={locked} aria-label="OH&P %" />%</div><div className="est-totals__v">{fmtMoney2(totals.ohp, currency)}</div>
            <div className="est-totals__k">Contingency <input inputMode="decimal" value={header.contingency_pct} onChange={(e) => setH({ contingency_pct: e.target.value })} disabled={locked} aria-label="Contingency %" />%</div><div className="est-totals__v">{fmtMoney2(totals.cont, currency)}</div>
            <div className="est-totals__k est-totals__hero">Price ex VAT</div><div className="est-totals__v est-totals__hero">{fmtMoney2(totals.exVat, currency)}</div>
            <div className="est-totals__k">VAT <input inputMode="decimal" value={header.vat_pct} onChange={(e) => setH({ vat_pct: e.target.value })} disabled={locked} aria-label="VAT %" />%</div><div className="est-totals__v">{fmtMoney2(totals.vat, currency)}</div>
            <div className="est-totals__k" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Total inc VAT (what the customer pays)</div><div className="est-totals__v" style={{ fontWeight: 800 }}>{fmtMoney2(totals.grand, currency)}</div>
          </div>
        </Card.Body>
      </Card>

      {meta && (meta.assumptions?.length || meta.exclusions?.length || meta.missing_info?.length || meta.flags) ? (
        <Card style={{ marginBottom: 16 }}>
          <Card.Header title="How MAX priced this" extra={meta.location && meta.location.label ? 'Rates adjusted for ' + meta.location.label : null} />
          <Card.Body>
            <div className="est-meta">
              {meta.assumptions && meta.assumptions.length > 0 && <div><h4>Assumptions</h4><ul>{meta.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              {meta.exclusions && meta.exclusions.length > 0 && <div><h4>Excluded</h4><ul>{meta.exclusions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              {meta.missing_info && meta.missing_info.length > 0 && <div><h4>Worth confirming</h4><ul>{meta.missing_info.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              {meta.flags && (
                <div>
                  <h4>Where the rates came from</h4>
                  <ul>
                    <li>{meta.flags.own_rate_lines || 0} line{meta.flags.own_rate_lines === 1 ? '' : 's'} from your own rates</li>
                    <li>{meta.flags.library_lines || 0} line{meta.flags.library_lines === 1 ? '' : 's'} from the AI QS rate library</li>
                    <li>{meta.flags.estimated_lines || 0} line{meta.flags.estimated_lines === 1 ? '' : 's'} on an estimated rate{meta.flags.estimated_value ? ' (' + fmtMoney2(meta.flags.estimated_value, currency) + ')' : ''}</li>
                    {meta.confidence && <li>MAX's confidence in the quantities: {meta.confidence}</li>}
                  </ul>
                </div>
              )}
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {shareUrl && (
        <Card style={{ marginBottom: 16 }}>
          <Card.Body style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <LinkIcon size={16} color="var(--accent)" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Customer acceptance link</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{shareUrl}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={copyLink}><CopyIcon size={13} color="currentColor" /> Copy link</Button>
          </Card.Body>
        </Card>
      )}

      <div className="est-sticky">
        <div className="est-sticky__total">Price ex VAT <strong>{fmtMoney2(totals.exVat, currency)}</strong> · inc VAT <strong>{fmtMoney2(totals.grand, currency)}</strong>{dirty && <span style={{ color: 'var(--warning)', marginLeft: 8 }}>unsaved changes</span>}</div>
        {!locked && <Button variant="ghost" size="sm" onClick={remove}><TrashIcon size={13} color="currentColor" /> Delete</Button>}
        <Button variant="secondary" size="sm" onClick={duplicate}><CopyIcon size={13} color="currentColor" /> Duplicate</Button>
        {!locked && <Button variant="secondary" onClick={save} disabled={!dirty || saving} busyLabel="Saving…">{saving ? 'Saving…' : 'Save'}</Button>}
        {!locked && <Button onClick={() => { if (dirty) { toast.error('Save your changes first.'); return; } setSendOpen(true); }} disabled={verdict === 'over_limit'} title={verdict === 'over_limit' ? 'Over the small-job limit — send it to the AI QS team instead' : undefined}><SendIcon size={14} color="currentColor" /> {quote.status === 'draft' ? 'Send to customer' : 'Resend'}</Button>}
      </div>

      {sendOpen && (
        <Modal title="Send to your customer" onClose={() => setSendOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setSendOpen(false)}>Cancel</Button><Button onClick={send} disabled={sending} busyLabel="Sending…">{sending ? 'Sending…' : (sendEmail.trim() ? 'Send email' : 'Create link')}</Button></>}>
          <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            Your customer gets a branded page with the price breakdown you chose to show, the PDF, and an Accept button. Internal costs and your rates are never shown. {fmtMoney2(totals.grand, currency)} inc VAT.
          </p>
          <Field label="Customer email" hint="Leave blank to get a link to share by WhatsApp or text instead."><Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="customer@example.com" /></Field>
          {sendEmail.trim() && <SendingFromNote style={{ marginTop: -4, marginBottom: 10 }} />}
          {quote.status !== 'draft' && <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}><CheckCircleIcon size={13} color="var(--success)" /> Already sent{quote.sent_at ? ' on ' + new Date(quote.sent_at).toLocaleDateString('en-GB') : ''} — this resends the same link.</div>}
        </Modal>
      )}
    </div>
  );
}
