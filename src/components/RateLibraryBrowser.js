import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api';
import { Card, Banner, Badge, Input, Select, SkeletonRows } from '../ui';

// The rate library the signed-in user's jobs are priced from, in full.
// South Africa: the SA-RL library — every unit rate opens into its build-up
// (gang x hours, each material x quantity, sundries, plant, margin), plus the
// labour grades, gangs, plant, materials and R/m2 benchmarks behind it, all
// adjusted to the chosen region. Other countries: the UK base library.

const mono = { fontFamily: 'var(--font-mono, monospace)' };
const th = { textAlign: 'left', padding: '8px 10px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: '0.82rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const num = { ...td, ...mono, textAlign: 'right', whiteSpace: 'nowrap' };

function money(sym, n, dp = 2) {
  if (n == null || isNaN(n)) return '—';
  return sym + Number(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Tables scroll inside their card on phones — never the page.
function Scroll({ children }) {
  return <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>;
}

function BuildUp({ r, lib }) {
  const s = lib.symbol;
  const b = r.buildUp || {};
  const m = 1 + (lib.marginPct || 0) / 100;
  const rows = [];
  if (b.gang) rows.push([`Labour — ${b.gang.description} (${b.gang.composition})`, `${b.gang.hoursPerUnit} hrs × ${money(s, b.gang.ratePerHour)}/hr`, b.gang.hoursPerUnit * b.gang.ratePerHour]);
  for (const x of b.materials || []) rows.push([`${x.description}`, `${x.qty} ${x.unit} × ${money(s, x.price)}`, x.cost]);
  if (b.sundries) rows.push(['Sundries', '', b.sundries]);
  if (b.plant) rows.push([`Plant — ${b.plant.description}`, `${b.plant.qty} ${b.plant.unit} × ${money(s, b.plant.rate)}`, b.plant.cost]);
  return (
    <div style={{ padding: '10px 12px', background: 'var(--surface-hover)', borderRadius: 8 }}>
      <Scroll>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td style={{ ...td, borderBottom: 'none', paddingLeft: 0 }}>{row[0]}</td>
                <td style={{ ...td, borderBottom: 'none', color: 'var(--text-secondary)', ...mono, whiteSpace: 'nowrap' }}>{row[1]}</td>
                <td style={{ ...num, borderBottom: 'none' }}>{money(s, row[2])}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, paddingLeft: 0, fontWeight: 600 }}>Net cost</td><td style={td} />
              <td style={{ ...num, fontWeight: 600 }}>{money(s, r.net)}</td>
            </tr>
            <tr>
              <td style={{ ...td, borderBottom: 'none', paddingLeft: 0 }}>Contractor margin {lib.marginPct}%</td><td style={{ ...td, borderBottom: 'none' }} />
              <td style={{ ...num, borderBottom: 'none' }}>{money(s, r.net * (m - 1))}</td>
            </tr>
            <tr>
              <td style={{ ...td, borderBottom: 'none', paddingLeft: 0, fontWeight: 700 }}>Rate per {r.unit}, ex VAT</td><td style={{ ...td, borderBottom: 'none' }} />
              <td style={{ ...num, borderBottom: 'none', fontWeight: 700 }}>{money(s, r.sell)}</td>
            </tr>
          </tbody>
        </table>
      </Scroll>
    </div>
  );
}

function UnitRates({ lib, search }) {
  const s = lib.symbol;
  const [open, setOpen] = useState({});
  const [openRate, setOpenRate] = useState(null);
  const q = search.trim().toLowerCase();
  const sections = useMemo(() => lib.sections.map((sec) => ({
    ...sec,
    rates: q ? sec.rates.filter((r) => (r.code + ' ' + r.description).toLowerCase().includes(q)) : sec.rates,
  })).filter((sec) => sec.rates.length), [lib, q]);
  const hasBuildUps = lib.country === 'ZA';

  return sections.map((sec) => {
    const expanded = q || open[sec.name] || sections.length === 1;
    return (
      <Card key={sec.name} style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => setOpen((o) => ({ ...o, [sec.name]: !o[sec.name] }))}
          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', textAlign: 'left' }}>{sec.name}</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sec.rates.length} rates {expanded ? '▴' : '▾'}</span>
        </button>
        {expanded && (
          <Scroll>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Code</th><th style={th}>Description</th><th style={th}>Unit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Labour</th>
                  <th style={{ ...th, textAlign: 'right' }}>Materials</th>
                  {hasBuildUps && <th style={{ ...th, textAlign: 'right' }}>Plant</th>}
                  <th style={{ ...th, textAlign: 'right' }}>Rate ex VAT</th>
                </tr>
              </thead>
              <tbody>
                {sec.rates.map((r) => (
                  <React.Fragment key={r.code}>
                    <tr onClick={hasBuildUps ? () => setOpenRate(openRate === r.code ? null : r.code) : undefined}
                      style={{ cursor: hasBuildUps ? 'pointer' : 'default', background: openRate === r.code ? 'var(--surface-hover)' : undefined }}
                      title={hasBuildUps ? 'Show the build-up' : undefined}>
                      <td style={{ ...td, ...mono, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{r.code}</td>
                      <td style={td}>{r.description}{hasBuildUps && <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}> {openRate === r.code ? '▴' : '▾'}</span>}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.unit}</td>
                      <td style={num}>{money(s, r.labour)}</td>
                      <td style={num}>{money(s, r.materials)}</td>
                      {hasBuildUps && <td style={num}>{r.plant ? money(s, r.plant) : '—'}</td>}
                      <td style={{ ...num, fontWeight: 600 }}>{money(s, r.sell)}</td>
                    </tr>
                    {openRate === r.code && (
                      <tr><td colSpan={hasBuildUps ? 7 : 6} style={{ ...td, padding: '6px 10px 12px' }}><BuildUp r={r} lib={lib} /></td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Card>
    );
  });
}

function SimpleTable({ cols, rows }) {
  return (
    <Card>
      <Scroll>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr>{cols.map((c) => <th key={c.label} style={{ ...th, textAlign: c.right ? 'right' : 'left' }}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c.label} style={c.right ? num : td}>{c.get(r)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </Card>
  );
}

const TABS = [
  { id: 'rates', label: 'Unit rates' },
  { id: 'labour', label: 'Labour & gangs' },
  { id: 'plant', label: 'Plant' },
  { id: 'materials', label: 'Materials' },
  { id: 'benchmarks', label: 'Cost per m²' },
];

export default function RateLibraryBrowser({ user }) {
  const [lib, setLib] = useState(null);
  const [error, setError] = useState('');
  const [region, setRegion] = useState(user?.region || '');
  const [tab, setTab] = useState('rates');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setError('');
    apiFetch('/rates/library' + (region ? '?region=' + encodeURIComponent(region) : ''))
      .then(setLib).catch((e) => setError(e.message || 'Could not load the rate library'));
  }, [region]);

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!lib) return <Card><SkeletonRows rows={8} /></Card>;

  const s = lib.symbol;
  const za = lib.country === 'ZA';
  const q = search.trim().toLowerCase();
  const match = (...parts) => !q || parts.join(' ').toLowerCase().includes(q);

  return (
    <div>
      <Banner tone="info" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
          {za ? (
            <>
              <strong>AI QS South Africa Rates Library {lib.ref}</strong> · base date {lib.baseDate} · priced for <strong>{lib.region.name}</strong> (factor {lib.region.factor.toFixed(2)}).
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                Rates are ex VAT and include a {lib.marginPct}% contractor margin. VAT at {lib.vatPct}% is added once at the foot of the BOQ.
                Labour is all-in: basic wage + {lib.labourOnCostPct}% on-costs (UIF, SDL, COIDA, leave, non-productive time). Forward escalation {lib.escalationPctPa}% p.a.
                Your own rates on the My rates tab always take priority over these.
              </div>
            </>
          ) : (
            <><strong>{lib.ref}</strong><div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{lib.note} Your own rates on the My rates tab always take priority.</div></>
          )}
        </div>
      </Banner>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <Input type="text" placeholder="Search the library…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260, flex: '1 1 200px', width: 'auto' }} />
        {za && (
          <Select value={lib.region.name} onChange={(e) => setRegion(e.target.value)} style={{ maxWidth: 320, flex: '1 1 220px', width: 'auto' }} aria-label="Region">
            {lib.regions.map((r) => <option key={r.name} value={r.name}>{r.name} ({r.factor.toFixed(2)})</option>)}
          </Select>
        )}
      </div>

      {za && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid ' + (tab === t.id ? 'var(--accent)' : 'var(--border)'), background: tab === t.id ? 'var(--accent-glow, rgba(245,158,11,0.12))' : 'transparent', color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {(!za || tab === 'rates') && <UnitRates lib={lib} search={search} />}

      {za && tab === 'labour' && (
        <>
          <SimpleTable
            cols={[
              { label: 'Code', get: (r) => r.code },
              { label: 'Grade / trade', get: (r) => r.grade },
              { label: 'Basic wage / hr', right: true, get: (r) => money(s, r.basicHr) },
              { label: 'All-in / hr', right: true, get: (r) => money(s, r.allInHr) },
              { label: 'All-in / day (9 h)', right: true, get: (r) => money(s, r.allInDay) },
            ]}
            rows={lib.labour.filter((r) => match(r.code, r.grade))}
          />
          <div style={{ height: 12 }} />
          <SimpleTable
            cols={[
              { label: 'Gang', get: (r) => r.code },
              { label: 'Description', get: (r) => r.description },
              { label: 'Composition', get: (r) => r.composition },
              { label: 'Per gang-hour', right: true, get: (r) => money(s, r.ratePerHour) },
            ]}
            rows={lib.gangs.filter((r) => match(r.code, r.description, r.composition))}
          />
        </>
      )}

      {za && tab === 'plant' && (
        <SimpleTable
          cols={[
            { label: 'Code', get: (r) => r.code },
            { label: 'Plant', get: (r) => r.description },
            { label: 'Unit', get: (r) => r.unit },
            { label: 'Rate ex VAT', right: true, get: (r) => money(s, r.rate) },
          ]}
          rows={lib.plant.filter((r) => match(r.code, r.description))}
        />
      )}

      {za && tab === 'materials' && (
        <SimpleTable
          cols={[
            { label: 'Code', get: (r) => r.code },
            { label: 'Material', get: (r) => r.description },
            { label: 'Category', get: (r) => r.category },
            { label: 'Unit', get: (r) => r.unit },
            { label: 'Delivered price ex VAT', right: true, get: (r) => money(s, r.price) },
            { label: 'Basis', get: (r) => r.basis ? <Badge tone={r.basis === 'MARKET' ? 'success' : 'neutral'}>{r.basis}</Badge> : '' },
          ]}
          rows={lib.materials.filter((r) => match(r.code, r.description, r.category))}
        />
      )}

      {za && tab === 'benchmarks' && (
        <>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            Construction cost per m² by building type (AECOM Africa Property &amp; Construction Cost Guide 2025/26), escalated to the library base date and adjusted to {lib.region.name}. Ex VAT; excludes site infrastructure, professional fees and escalation beyond the base date. Use these to sanity-check a BOQ total.
          </div>
          <SimpleTable
            cols={[
              { label: 'Group', get: (r) => r.section },
              { label: 'Building type', get: (r) => r.type },
              { label: 'Low / m²', right: true, get: (r) => money(s, r.low, 0) },
              { label: 'Mid / m²', right: true, get: (r) => money(s, r.mid, 0) },
              { label: 'High / m²', right: true, get: (r) => money(s, r.high, 0) },
            ]}
            rows={lib.elemental.filter((r) => match(r.section, r.type))}
          />
        </>
      )}
    </div>
  );
}
