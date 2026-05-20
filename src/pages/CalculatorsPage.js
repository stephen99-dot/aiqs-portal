import React, { useState, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import EstimatorGate from '../components/EstimatorGate';

// Five client-side, stateless calculators for common material quantities.
// All maths is local — no API calls, no DB writes.

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function round(n, dp) { const m = Math.pow(10, dp); return Math.round(n * m) / m; }

const TABS = [
  { id: 'brick-block', label: 'Brick / block' },
  { id: 'concrete', label: 'Concrete volume' },
  { id: 'plaster', label: 'Plaster / drylining' },
  { id: 'roof', label: 'Roof area' },
  { id: 'paint', label: 'Paint' },
];

export default function CalculatorsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const [tab, setTab] = useState('brick-block');

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontSize: 26 }}>Calculators</h1>
      <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4, marginBottom: 16 }}>
        Quick material-quantity tools. Coverage values are editable — defaults are typical UK figures.
      </div>

      <div style={{ display: 'inline-flex', flexWrap: 'wrap', background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, padding: 4, marginBottom: 16 }}>
        {TABS.map(x => (
          <button key={x.id} onClick={() => setTab(x.id)} style={{
            background: tab === x.id ? t.accent : 'transparent',
            color: tab === x.id ? '#fff' : t.text,
            border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
          }}>{x.label}</button>
        ))}
      </div>

      {tab === 'brick-block' && <BrickBlock t={t} />}
      {tab === 'concrete' && <Concrete t={t} />}
      {tab === 'plaster' && <Plaster t={t} />}
      {tab === 'roof' && <Roof t={t} />}
      {tab === 'paint' && <Paint t={t} />}

      <div style={{ marginTop: 24, padding: 12, background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, fontSize: 12, color: t.textMuted }}>
        These are quick estimates. Always cross-check against your supplier's coverage figures for the specific product.
      </div>
    </div>
  );
}

// ─── Brick / Block ───────────────────────────────────────────────────────────

function BrickBlock({ t }) {
  const [length, setLength] = useState(10);
  const [height, setHeight] = useState(2.4);
  const [bricksPerM2, setBricksPerM2] = useState(60);
  const [blocksPerM2, setBlocksPerM2] = useState(10);
  const [waste, setWaste] = useState(10);
  const [mode, setMode] = useState('brick'); // brick | block

  const out = useMemo(() => {
    const area = num(length) * num(height);
    const perM2 = mode === 'brick' ? num(bricksPerM2) : num(blocksPerM2);
    const baseQty = area * perM2;
    const withWaste = baseQty * (1 + num(waste) / 100);
    return { area: round(area, 2), baseQty: round(baseQty, 0), withWaste: Math.ceil(withWaste) };
  }, [length, height, bricksPerM2, blocksPerM2, waste, mode]);

  return (
    <Card t={t} title="Wall — bricks or blocks">
      <ModeToggle t={t} value={mode} onChange={setMode} options={[{ id: 'brick', label: 'Bricks' }, { id: 'block', label: 'Blocks' }]} />
      <Row t={t}>
        <Field t={t} label="Wall length (m)" value={length} onChange={setLength} />
        <Field t={t} label="Wall height (m)" value={height} onChange={setHeight} />
      </Row>
      <Row t={t}>
        {mode === 'brick' ? (
          <Field t={t} label="Bricks per m² (standard 215×65mm = 60)" value={bricksPerM2} onChange={setBricksPerM2} />
        ) : (
          <Field t={t} label="Blocks per m² (standard 440×215mm = 10)" value={blocksPerM2} onChange={setBlocksPerM2} />
        )}
        <Field t={t} label="Waste %" value={waste} onChange={setWaste} />
      </Row>
      <ResultGrid t={t} items={[
        { k: 'Wall area', v: out.area + ' m²' },
        { k: 'Base quantity', v: out.baseQty.toLocaleString('en-GB') + ' ' + (mode === 'brick' ? 'bricks' : 'blocks') },
        { k: 'With waste (' + waste + '%)', v: out.withWaste.toLocaleString('en-GB') + ' ' + (mode === 'brick' ? 'bricks' : 'blocks'), accent: true },
      ]} />
    </Card>
  );
}

// ─── Concrete ────────────────────────────────────────────────────────────────

function Concrete({ t }) {
  const [length, setLength] = useState(10);
  const [width, setWidth] = useState(0.6);
  const [depth, setDepth] = useState(0.3);
  const [waste, setWaste] = useState(5);

  const out = useMemo(() => {
    const base = num(length) * num(width) * num(depth);
    const withWaste = base * (1 + num(waste) / 100);
    return { base: round(base, 3), withWaste: round(withWaste, 2) };
  }, [length, width, depth, waste]);

  return (
    <Card t={t} title="Concrete volume — strip or pad">
      <Row t={t}>
        <Field t={t} label="Length (m)" value={length} onChange={setLength} />
        <Field t={t} label="Width (m)" value={width} onChange={setWidth} />
      </Row>
      <Row t={t}>
        <Field t={t} label="Depth (m)" value={depth} onChange={setDepth} />
        <Field t={t} label="Waste %" value={waste} onChange={setWaste} />
      </Row>
      <ResultGrid t={t} items={[
        { k: 'Net volume', v: out.base + ' m³' },
        { k: 'Order quantity', v: out.withWaste + ' m³', accent: true },
      ]} />
    </Card>
  );
}

// ─── Plaster / drylining ─────────────────────────────────────────────────────

function Plaster({ t }) {
  const [wallArea, setWallArea] = useState(50);
  const [ceilingArea, setCeilingArea] = useState(15);
  const [coverageSkim, setCoverageSkim] = useState(10);    // m² per 25kg bag
  const [coverageBonding, setCoverageBonding] = useState(4);
  const [waste, setWaste] = useState(10);

  const out = useMemo(() => {
    const total = num(wallArea) + num(ceilingArea);
    const skimBags = Math.ceil(total / Math.max(1, num(coverageSkim)) * (1 + num(waste) / 100));
    const bondingBags = Math.ceil(total / Math.max(1, num(coverageBonding)) * (1 + num(waste) / 100));
    return { total: round(total, 2), skimBags, bondingBags };
  }, [wallArea, ceilingArea, coverageSkim, coverageBonding, waste]);

  return (
    <Card t={t} title="Plaster / drylining — coverage">
      <Row t={t}>
        <Field t={t} label="Wall area (m²)" value={wallArea} onChange={setWallArea} />
        <Field t={t} label="Ceiling area (m²)" value={ceilingArea} onChange={setCeilingArea} />
      </Row>
      <Row t={t}>
        <Field t={t} label="Skim coverage (m² per 25kg bag)" value={coverageSkim} onChange={setCoverageSkim} />
        <Field t={t} label="Bonding coverage (m² per 25kg bag)" value={coverageBonding} onChange={setCoverageBonding} />
      </Row>
      <Row t={t}>
        <Field t={t} label="Waste %" value={waste} onChange={setWaste} />
        <div />
      </Row>
      <ResultGrid t={t} items={[
        { k: 'Total area', v: out.total + ' m²' },
        { k: 'Skim coat (25kg bags)', v: out.skimBags + ' bags', accent: true },
        { k: 'Bonding coat (25kg bags)', v: out.bondingBags + ' bags', accent: true },
      ]} />
    </Card>
  );
}

// ─── Roof area ───────────────────────────────────────────────────────────────

function Roof({ t }) {
  const [length, setLength] = useState(8);
  const [width, setWidth] = useState(6);
  const [pitch, setPitch] = useState(1.15);
  const [tilesPerM2, setTilesPerM2] = useState(10);
  const [waste, setWaste] = useState(10);

  const out = useMemo(() => {
    const plan = num(length) * num(width);
    const sloped = plan * num(pitch);
    const tiles = Math.ceil(sloped * num(tilesPerM2) * (1 + num(waste) / 100));
    return { plan: round(plan, 2), sloped: round(sloped, 2), tiles };
  }, [length, width, pitch, tilesPerM2, waste]);

  return (
    <Card t={t} title="Roof — area & tile count">
      <Row t={t}>
        <Field t={t} label="Plan length (m)" value={length} onChange={setLength} />
        <Field t={t} label="Plan width (m)" value={width} onChange={setWidth} />
      </Row>
      <Row t={t}>
        <Field t={t} label="Pitch factor (1.0 flat, 1.15 typical, 1.22 steep)" value={pitch} onChange={setPitch} />
        <Field t={t} label="Tiles per m² (depends on tile)" value={tilesPerM2} onChange={setTilesPerM2} />
      </Row>
      <Row t={t}>
        <Field t={t} label="Waste %" value={waste} onChange={setWaste} />
        <div />
      </Row>
      <ResultGrid t={t} items={[
        { k: 'Plan area', v: out.plan + ' m²' },
        { k: 'Sloped area', v: out.sloped + ' m²' },
        { k: 'Tiles', v: out.tiles.toLocaleString('en-GB') + ' tiles', accent: true },
      ]} />
    </Card>
  );
}

// ─── Paint ───────────────────────────────────────────────────────────────────

function Paint({ t }) {
  const [area, setArea] = useState(50);
  const [coats, setCoats] = useState(2);
  const [spreadRate, setSpreadRate] = useState(12);
  const [waste, setWaste] = useState(5);

  const out = useMemo(() => {
    const litres = Math.max(0, (num(area) * num(coats)) / Math.max(1, num(spreadRate))) * (1 + num(waste) / 100);
    return { litres: round(litres, 1), fiveLitreTins: Math.ceil(litres / 5), twoLitreTins: Math.ceil(litres / 2.5) };
  }, [area, coats, spreadRate, waste]);

  return (
    <Card t={t} title="Paint — litres required">
      <Row t={t}>
        <Field t={t} label="Area to be painted (m²)" value={area} onChange={setArea} />
        <Field t={t} label="Coats" value={coats} onChange={setCoats} />
      </Row>
      <Row t={t}>
        <Field t={t} label="Spread rate (m² per litre)" value={spreadRate} onChange={setSpreadRate} />
        <Field t={t} label="Waste %" value={waste} onChange={setWaste} />
      </Row>
      <ResultGrid t={t} items={[
        { k: 'Litres needed', v: out.litres + ' L', accent: true },
        { k: '5 L tins', v: out.fiveLitreTins + ' tins' },
        { k: '2.5 L tins', v: out.twoLitreTins + ' tins' },
      ]} />
    </Card>
  );
}

// ─── small components ──────────────────────────────────────────────────────

function Card({ t, title, children }) {
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
      <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function ModeToggle({ t, value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, padding: 4, marginBottom: 14 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          background: value === o.id ? t.accent : 'transparent',
          color: value === o.id ? '#fff' : t.text,
          border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Row({ t, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>{children}</div>;
}

function Field({ t, label, value, onChange }) {
  return (
    <div>
      <label style={{ display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</label>
      <input type="number" step="any" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }} />
    </div>
  );
}

function ResultGrid({ t, items }) {
  return (
    <div style={{ marginTop: 4, borderTop: '1px solid ' + t.border, paddingTop: 12 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
          <div style={{ color: t.textSecondary, fontSize: 13 }}>{item.k}</div>
          <div style={{ color: item.accent ? t.accent : t.text, fontWeight: item.accent ? 700 : 500, fontSize: item.accent ? 18 : 14, fontVariantNumeric: 'tabular-nums' }}>{item.v}</div>
        </div>
      ))}
    </div>
  );
}
