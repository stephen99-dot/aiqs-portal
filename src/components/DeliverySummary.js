import React, { useState } from 'react';
import { Card, Badge, Button } from '../ui';
import { AlertTriangleIcon, CheckCircleIcon } from './Icons';

// What the chat shows once a bill has been priced.
//
// Replaces the old behaviour of concatenating every pricer warning onto the
// reply text ("Notes: AUTO-CORRECTED: … | No base rate for 'skips_waste_removal'
// — used ai_estimated rate £17250/Item | …"), which put raw item keys and
// internal rate ceilings in front of the customer and buried the handful of
// lines that actually need a decision.
//
// The server (server/deliverySummary.js) does the classifying. This renders it:
//   - the headline, ONLY when the numbers reconcile to the spreadsheet
//   - sections, largest first
//   - the short "needs your check" list
//   - diagnostics behind a toggle, closed by default
export default function DeliverySummary({ delivery }) {
  const [showInternal, setShowInternal] = useState(false);
  if (!delivery) return null;

  const { reconciled, reconciliation, headline, sections, needsCheck, internal, statusLine, qs } = delivery;

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Reconciliation failure: the numbers do not match the document.
          This is the state that used to ship silently as a confident total. ── */}
      {!reconciled && (
        <Card style={{ borderColor: 'var(--danger)' }}>
          <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }}>
              <AlertTriangleIcon size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>
                These figures don't reconcile to the spreadsheet
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {statusLine}
              </div>
              {reconciliation && reconciliation.documentTotal != null && (
                <div style={{
                  display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10,
                  fontSize: '0.8rem', fontFamily: 'var(--font-mono)',
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    spreadsheet <strong style={{ color: 'var(--text-primary)' }}>
                      £{Math.round(reconciliation.documentTotal).toLocaleString('en-GB')}
                    </strong>
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    priced <strong style={{ color: 'var(--text-primary)' }}>
                      £{Math.round(reconciliation.pricerTotal).toLocaleString('en-GB')}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Headline. Only ever rendered when it matches the file. ── */}
      {reconciled && headline && (
        <Card>
          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Construction cost
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', lineHeight: 1, color: 'var(--text-primary)' }}>
                  {headline.formatted.construction}
                </div>
              </div>
              {headline.formatted.perM2 && (
                <Badge tone="neutral">{headline.formatted.perM2}
                  {headline.floorAreaM2 ? ` · ${headline.floorAreaM2} m²` : ''}
                </Badge>
              )}
            </div>
            <div style={{
              display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12, paddingTop: 12,
              borderTop: '1px solid var(--border)', fontSize: '0.84rem',
            }}>
              <span style={{ color: 'var(--text-muted)' }}>
                VAT ({headline.vatRate}%) <strong style={{ color: 'var(--text-primary)' }}>{headline.formatted.vat}</strong>
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                Total <strong style={{ color: 'var(--text-primary)' }}>{headline.formatted.total}</strong>
              </span>
            </div>
          </div>

          {/* Sections, largest first */}
          {sections && sections.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {sections.slice(0, 6).map((s) => (
                <div key={s.title} className="ui-row" style={{ padding: '9px 18px' }}>
                  <div className="ui-row__main">
                    <div style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>{s.title}</div>
                  </div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {s.formatted}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── The short list a QS must settle. ── */}
      {needsCheck && needsCheck.length > 0 && (
        <Card style={{ borderColor: 'var(--border-accent)' }}>
          <Card.Header
            title={`Needs your check`}
            extra={`${needsCheck.length} item${needsCheck.length === 1 ? '' : 's'}`}
          />
          <div>
            {needsCheck.map((n, i) => (
              <div key={i} className="ui-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}>
                  <AlertTriangleIcon size={15} />
                </div>
                <div className="ui-row__main">
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'normal' }}>
                    {n.detail}
                  </div>
                  {n.why && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 3 }}>
                      {n.why}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── All clear. ── */}
      {reconciled && (!needsCheck || needsCheck.length === 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--success)' }}>
          <CheckCircleIcon size={15} />
          {statusLine}
        </div>
      )}

      {/* ── VAT determination (§9). Stated with its reasoning, never inherited
              from the last job. ── */}
      {qs && qs.vat && (
        <Card>
          <Card.Header title="VAT" extra={`${qs.vat.rate}%`} />
          <Card.Body>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              {qs.vat.basis}
              {qs.vat.confidence === 'low' && (
                <Badge tone="warning" size="sm" style={{ marginLeft: 8 }}>needs confirming</Badge>
              )}
            </div>
            {qs.vat.reasoning.map((r, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 5 }}>{r}</div>
            ))}
            {qs.vat.queries.map((q, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: 'var(--warning)', lineHeight: 1.6, marginTop: 6 }}>{q}</div>
            ))}
            {qs.vat.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 6 }}>{w}</div>
            ))}
          </Card.Body>
        </Card>
      )}

      {/* ── Programme (§8), derived from the priced labour. ── */}
      {qs && qs.programme && qs.programme.weeks > 0 && (
        <Card>
          <Card.Header title="Programme" extra={`${qs.programme.weeks} weeks`} />
          <Card.Body>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: '0.84rem', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Crew <strong style={{ color: 'var(--text-primary)' }}>{qs.programme.crew}</strong>
                {qs.programme.crewLimitedByAccess && (
                  <Badge tone="warning" size="sm" style={{ marginLeft: 6 }}>capped</Badge>
                )}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                Operative-days <strong style={{ color: 'var(--text-primary)' }}>{qs.programme.operativeDays}</strong>
              </span>
              {qs.programme.cdmNotifiable && <Badge tone="danger" size="sm">CDM notifiable</Badge>}
            </div>
            {qs.programme.notes.map((n, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 5 }}>{n}</div>
            ))}
          </Card.Body>
        </Card>
      )}

      {/* ── Deferral count (§5.2) — the argument for a provisional-sum schedule. ── */}
      {qs && qs.deferrals && (
        <Card>
          <Card.Header title="What the information defers" extra={`${qs.deferrals.total} deferrals`} />
          <Card.Body>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {qs.deferrals.argument}
            </div>
            {qs.deferrals.priceableAssumptions.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>
                  Assumptions that read as an instruction to price
                </div>
                {qs.deferrals.priceableAssumptions.slice(0, 5).map((a, i) => (
                  <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, paddingLeft: 10, borderLeft: '2px solid var(--border-accent)', marginBottom: 4 }}>{a}</div>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* ── Commonly-missed items this job needs and the takeoff does not have. ── */}
      {qs && qs.missed && qs.missed.length > 0 && (
        <Card>
          <Card.Header title="Commonly missed on this job type" extra={`${qs.missed.length}`} />
          <div>
            {qs.missed.map((m, i) => (
              <div key={i} className="ui-row" style={{ alignItems: 'flex-start' }}>
                <Badge tone="neutral" size="sm" style={{ flexShrink: 0, marginTop: 2 }}>{m.category}</Badge>
                <div className="ui-row__main">
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2, whiteSpace: 'normal' }}>{m.item}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55, whiteSpace: 'normal' }}>{m.why}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Diagnostics: engineering output, closed by default. ── */}
      {internal && internal.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowInternal((v) => !v)}>
            {showInternal ? 'Hide' : 'Show'} pricing diagnostics ({internal.length})
          </Button>
          {showInternal && (
            <div style={{
              marginTop: 6, padding: '10px 12px', borderRadius: 8,
              background: 'var(--surface-hover)', border: '1px solid var(--border)',
              maxHeight: 260, overflowY: 'auto',
            }}>
              {internal.map((line, i) => (
                <div key={i} style={{
                  fontSize: '0.76rem', fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)', lineHeight: 1.6,
                  paddingBottom: 4, marginBottom: 4,
                  borderBottom: i < internal.length - 1 ? '1px solid var(--border)' : 'none',
                }}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
