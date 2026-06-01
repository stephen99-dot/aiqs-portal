import React, { useState, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import EstimatorGate from '../components/EstimatorGate';
import { BrickIcon, CubeIcon, PaletteIcon, HomeIcon, BucketIcon, AlertTriangleIcon } from '../components/Icons';

// Five client-side, stateless calculators for common material quantities.
// All maths is local — no API calls, no DB writes.

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function round(n, dp) { const m = Math.pow(10, dp); return Math.round(n * m) / m; }

const TABS = [
  { id: 'brick-block',  label: 'Brick / Block',     icon: BrickIcon, blurb: 'Wall area to brick or block count' },
  { id: 'concrete',     label: 'Concrete',          icon: CubeIcon, blurb: 'Volume for footings and pads' },
  { id: 'plaster',      label: 'Plaster',           icon: PaletteIcon, blurb: 'Bag count for skim and bonding' },
  { id: 'roof',         label: 'Roof',              icon: HomeIcon, blurb: 'Sloped area and tile count' },
  { id: 'paint',        label: 'Paint',             icon: BucketIcon, blurb: 'Litres at any spread rate' },
];

export default function CalculatorsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const [tab, setTab] = useState('brick-block');
  const active = TABS.find(x => x.id === tab) || TABS[0];

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>Calculators</h1>
        <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 6 }}>
          Quick material-quantity tools. Coverage defaults are typical UK values — override for your supplier's product.
        </div>
      </div>

      {/* Tab strip — full-width cards instead of pill toggles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 8,
        marginBottom: 20,
      }}>
        {TABS.map(x => {
          const isActive = tab === x.id;
          const Ico = x.icon;
          return (
            <button key={x.id} onClick={() => setTab(x.id)} style={{
              background: isActive ? t.accent : t.card,
              color: isActive ? '#fff' : t.text,
              border: '1px solid ' + (isActive ? t.accent : t.border),
              borderRadius: 12,
              padding: '14px 12px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'transform 0.08s ease, box-shadow 0.12s ease',
              boxShadow: isActive ? '0 4px 14px rgba(0,0,0,0.18)' : 'none',
              transform: isActive ? 'translateY(-1px)' : 'none',
            }}>
              <div style={{ marginBottom: 6 }}>{Ico && <Ico size={22} />}</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{x.label}</div>
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{x.blurb}</div>
            </button>
          );
        })}
      </div>

      {/* Active panel header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: t.accent + '22', color: t.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{(() => { const Ico = active.icon; return Ico && <Ico size={22} />; })()}</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{active.label}</div>
          <div style={{ color: t.textSecondary, fontSize: 13 }}>{active.blurb}</div>
        </div>
      </div>

      {tab === 'brick-block' && <BrickBlock t={t} />}
      {tab === 'concrete' && <Concrete t={t} />}
      {tab === 'plaster' && <Plaster t={t} />}
      {tab === 'roof' && <Roof t={t} />}
      {tab === 'paint' && <Paint t={t} />}

      <div style={{
        marginTop: 24, padding: '12px 14px',
        background: t.warningBg, border: '1px solid ' + (t.warning || '#F59E0B') + '44',
        borderRadius: 8, fontSize: 12, color: t.warning,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <AlertTriangleIcon size={16} />
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
  const [mode, setMode] = useState('brick');

  const out = useMemo(() => {
    const area = num(length) * num(height);
    const perM2 = mode === 'brick' ? num(bricksPerM2) : num(blocksPerM2);
    const baseQty = area * perM2;
    const withWaste = baseQty * (1 + num(waste) / 100);
    return { area: round(area, 2), baseQty: Math.round(baseQty), withWaste: Math.ceil(withWaste) };
  }, [length, height, bricksPerM2, blocksPerM2, waste, mode]);

  const unitLabel = mode === 'brick' ? 'bricks' : 'blocks';

  return (
    <Layout
      t={t}
      inputs={
        <>
          <SegmentedToggle t={t} value={mode} onChange={setMode} options={[
            { id: 'brick', label: 'Bricks', sub: '60 per m²' },
            { id: 'block', label: 'Blocks', sub: '10 per m²' },
          ]} />
          <FieldPair t={t}>
            <Field t={t} label="Wall length" suffix="m" value={length} onChange={setLength} />
            <Field t={t} label="Wall height" suffix="m" value={height} onChange={setHeight} />
          </FieldPair>
          <FieldPair t={t}>
            {mode === 'brick' ? (
              <Field t={t} label="Bricks per m²" value={bricksPerM2} onChange={setBricksPerM2} hint="60 = standard 215×65mm" />
            ) : (
              <Field t={t} label="Blocks per m²" value={blocksPerM2} onChange={setBlocksPerM2} hint="10 = standard 440×215mm" />
            )}
            <Field t={t} label="Waste" suffix="%" value={waste} onChange={setWaste} />
          </FieldPair>
        </>
      }
      results={
        <>
          <BigResult t={t} label={'With waste (' + waste + '%)'} value={out.withWaste.toLocaleString('en-GB')} unit={unitLabel} />
          <ResultRow t={t} label="Wall area" value={out.area + ' m²'} />
          <ResultRow t={t} label="Base quantity" value={out.baseQty.toLocaleString('en-GB') + ' ' + unitLabel} />
        </>
      }
    />
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
    <Layout
      t={t}
      inputs={
        <>
          <FieldPair t={t}>
            <Field t={t} label="Length" suffix="m" value={length} onChange={setLength} />
            <Field t={t} label="Width" suffix="m" value={width} onChange={setWidth} />
          </FieldPair>
          <FieldPair t={t}>
            <Field t={t} label="Depth" suffix="m" value={depth} onChange={setDepth} />
            <Field t={t} label="Waste" suffix="%" value={waste} onChange={setWaste} />
          </FieldPair>
        </>
      }
      results={
        <>
          <BigResult t={t} label="Order quantity" value={out.withWaste} unit="m³" />
          <ResultRow t={t} label="Net volume" value={out.base + ' m³'} />
        </>
      }
    />
  );
}

// ─── Plaster / drylining ─────────────────────────────────────────────────────

function Plaster({ t }) {
  const [wallArea, setWallArea] = useState(50);
  const [ceilingArea, setCeilingArea] = useState(15);
  const [coverageSkim, setCoverageSkim] = useState(10);
  const [coverageBonding, setCoverageBonding] = useState(4);
  const [waste, setWaste] = useState(10);

  const out = useMemo(() => {
    const total = num(wallArea) + num(ceilingArea);
    const skim = Math.ceil(total / Math.max(1, num(coverageSkim)) * (1 + num(waste) / 100));
    const bonding = Math.ceil(total / Math.max(1, num(coverageBonding)) * (1 + num(waste) / 100));
    return { total: round(total, 2), skim, bonding };
  }, [wallArea, ceilingArea, coverageSkim, coverageBonding, waste]);

  return (
    <Layout
      t={t}
      inputs={
        <>
          <FieldPair t={t}>
            <Field t={t} label="Wall area" suffix="m²" value={wallArea} onChange={setWallArea} />
            <Field t={t} label="Ceiling area" suffix="m²" value={ceilingArea} onChange={setCeilingArea} />
          </FieldPair>
          <FieldPair t={t}>
            <Field t={t} label="Skim coverage" suffix="m²/bag" value={coverageSkim} onChange={setCoverageSkim} hint="Per 25kg bag" />
            <Field t={t} label="Bonding coverage" suffix="m²/bag" value={coverageBonding} onChange={setCoverageBonding} hint="Per 25kg bag" />
          </FieldPair>
          <FieldPair t={t}>
            <Field t={t} label="Waste" suffix="%" value={waste} onChange={setWaste} />
            <div />
          </FieldPair>
        </>
      }
      results={
        <>
          <ResultRow t={t} label="Total area" value={out.total + ' m²'} />
          <BigResult t={t} label="Skim coat" value={out.skim} unit="× 25kg bag" />
          <BigResult t={t} label="Bonding coat" value={out.bonding} unit="× 25kg bag" tone="muted" />
        </>
      }
    />
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
    <Layout
      t={t}
      inputs={
        <>
          <FieldPair t={t}>
            <Field t={t} label="Plan length" suffix="m" value={length} onChange={setLength} />
            <Field t={t} label="Plan width" suffix="m" value={width} onChange={setWidth} />
          </FieldPair>
          <FieldPair t={t}>
            <Field t={t} label="Pitch factor" value={pitch} onChange={setPitch} hint="1.0 flat · 1.15 typical · 1.22 steep" />
            <Field t={t} label="Tiles per m²" value={tilesPerM2} onChange={setTilesPerM2} hint="Depends on tile type" />
          </FieldPair>
          <FieldPair t={t}>
            <Field t={t} label="Waste" suffix="%" value={waste} onChange={setWaste} />
            <div />
          </FieldPair>
        </>
      }
      results={
        <>
          <BigResult t={t} label="Tiles required" value={out.tiles.toLocaleString('en-GB')} unit="tiles" />
          <ResultRow t={t} label="Plan area" value={out.plan + ' m²'} />
          <ResultRow t={t} label="Sloped area" value={out.sloped + ' m²'} />
        </>
      }
    />
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
    return { litres: round(litres, 1), fiveLitre: Math.ceil(litres / 5), twoAndHalf: Math.ceil(litres / 2.5) };
  }, [area, coats, spreadRate, waste]);

  return (
    <Layout
      t={t}
      inputs={
        <>
          <FieldPair t={t}>
            <Field t={t} label="Area to paint" suffix="m²" value={area} onChange={setArea} />
            <Field t={t} label="Coats" value={coats} onChange={setCoats} />
          </FieldPair>
          <FieldPair t={t}>
            <Field t={t} label="Spread rate" suffix="m²/L" value={spreadRate} onChange={setSpreadRate} hint="12 m²/L is typical emulsion" />
            <Field t={t} label="Waste" suffix="%" value={waste} onChange={setWaste} />
          </FieldPair>
        </>
      }
      results={
        <>
          <BigResult t={t} label="Litres needed" value={out.litres} unit="L" />
          <ResultRow t={t} label="5 L tins" value={out.fiveLitre + ' tins'} />
          <ResultRow t={t} label="2.5 L tins" value={out.twoAndHalf + ' tins'} />
        </>
      }
    />
  );
}

// ─── Layout primitives ───────────────────────────────────────────────────────

function Layout({ t, inputs, results }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)',
      gap: 16,
      alignItems: 'start',
    }}>
      <div style={card(t)}>
        <SectionTitle t={t}>Inputs</SectionTitle>
        {inputs}
      </div>
      <div style={{
        ...card(t),
        background: 'linear-gradient(180deg, ' + t.card + ' 0%, ' + t.surface + ' 100%)',
        position: 'sticky',
        top: 16,
      }}>
        <SectionTitle t={t}>Result</SectionTitle>
        {results}
      </div>
    </div>
  );
}

function card(t) {
  return {
    background: t.card,
    border: '1px solid ' + t.border,
    borderRadius: 14,
    padding: 22,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  };
}

function SectionTitle({ t, children }) {
  return (
    <div style={{
      color: t.textSecondary, fontSize: 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 16,
    }}>{children}</div>
  );
}

function SegmentedToggle({ t, value, onChange, options }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(' + options.length + ', 1fr)',
      gap: 6,
      background: t.bg,
      border: '1px solid ' + t.border,
      borderRadius: 10,
      padding: 4,
      marginBottom: 16,
    }}>
      {options.map(o => {
        const isActive = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            background: isActive ? t.accent : 'transparent',
            color: isActive ? '#fff' : t.text,
            border: 'none',
            borderRadius: 7,
            padding: '10px 12px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'background 0.15s ease',
          }}>
            <div>{o.label}</div>
            {o.sub && <div style={{ fontSize: 10, fontWeight: 400, opacity: isActive ? 0.85 : 0.55, marginTop: 2 }}>{o.sub}</div>}
          </button>
        );
      })}
    </div>
  );
}

function FieldPair({ t, children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      marginBottom: 14,
    }}>{children}</div>
  );
}

function Field({ t, label, value, onChange, suffix, hint }) {
  return (
    <div>
      <label style={{
        display: 'block', color: t.textSecondary,
        fontSize: 12, fontWeight: 500, marginBottom: 6,
      }}>{label}</label>
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        background: t.bg,
        border: '1px solid ' + t.border,
        borderRadius: 8,
        overflow: 'hidden',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}>
        <input
          type="number" step="any"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={e => { e.target.parentElement.style.borderColor = t.accent; e.target.parentElement.style.boxShadow = '0 0 0 3px ' + t.accent + '22'; }}
          onBlur={e => { e.target.parentElement.style.borderColor = t.border; e.target.parentElement.style.boxShadow = 'none'; }}
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', outline: 'none',
            color: t.text,
            padding: '10px 12px',
            fontSize: 16, fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        {suffix && (
          <div style={{
            color: t.textSecondary,
            background: t.surface,
            padding: '0 12px',
            display: 'flex', alignItems: 'center',
            fontSize: 12, fontWeight: 600,
            borderLeft: '1px solid ' + t.border,
          }}>{suffix}</div>
        )}
      </div>
      {hint && <div style={{ color: t.textMuted, fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function BigResult({ t, label, value, unit, tone }) {
  const muted = tone === 'muted';
  return (
    <div style={{
      padding: '14px 16px',
      background: muted ? 'transparent' : t.accent + '14',
      border: '1px solid ' + (muted ? t.border : t.accent + '44'),
      borderRadius: 10,
      marginBottom: 10,
    }}>
      <div style={{
        color: t.textSecondary,
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6,
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <div style={{
          color: muted ? t.text : t.accent,
          fontSize: 32, fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: -0.5,
        }}>{value}</div>
        {unit && <div style={{ color: t.textSecondary, fontSize: 14, fontWeight: 500 }}>{unit}</div>}
      </div>
    </div>
  );
}

function ResultRow({ t, label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 4px',
      borderTop: '1px solid ' + t.border,
      fontSize: 13,
    }}>
      <div style={{ color: t.textSecondary }}>{label}</div>
      <div style={{ color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
