import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import {
  BrainIcon, RefreshIcon, ZapIcon, SparklesIcon, LayersIcon, ClockIcon,
  CheckCircleIcon, AlertCircleIcon, LinkIcon,
} from '../components/Icons';

// Admin-only view of everything the AI has learned, across every knowledge
// layer — plus the cross-app exchange that lets AI QS and AI Trades Pilot
// share anonymised knowledge with each other.

const LAYER_ICONS = {
  rates: ZapIcon,
  quantities: LayersIcon,
  projects: LayersIcon,
  corrections: SparklesIcon,
  patterns: LinkIcon,
  client_profiles: BrainIcon,
  user_memories: BrainIcon,
  playbooks: BrainIcon,
  flywheel: RefreshIcon,
  entities: BrainIcon,
  price_evidence: LayersIcon,
};

function timeAgo(iso) {
  if (!iso) return 'never';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SuperBrainPage() {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null); // { ok, text }

  const colors = {
    bg: isDark ? '#0A0F1C' : '#F8FAFC',
    card: isDark ? '#111827' : '#FFFFFF',
    cardBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    text: isDark ? '#E2E8F0' : '#1E293B',
    textMuted: isDark ? '#94A3B8' : '#64748B',
    accent: '#F59E0B',
    accentBg: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
    accentBorder: isDark ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.12)',
    good: '#10B981',
    goodBg: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.08)',
    bad: '#EF4444',
    badBg: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
  };

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    apiFetch('/super-brain/snapshot')
      .then(setSnap)
      .catch(e => setError(e.message || 'Failed to load the Super Brain'))
      .finally(() => setLoading(false));
  }

  async function syncNow() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await apiFetch('/super-brain/sync', { method: 'POST' });
      setSyncMsg({
        ok: true,
        text: `Pulled from ${r.peer || r.source}: ${r.imported.rates} rates, ${r.imported.quantities} quantity benchmarks, ${r.imported.patterns} patterns.`,
      });
      load();
    } catch (e) {
      setSyncMsg({ ok: false, text: e.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>Waking the Super Brain…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
        <AlertCircleIcon size={28} style={{ color: colors.bad }} />
        <div style={{ marginTop: 10 }}>{error}</div>
        <div style={{ marginTop: 6, fontSize: 13 }}>The Super Brain is admin-only.</div>
      </div>
    );
  }

  const layers = snap?.layers || [];
  const shared = snap?.shared || [];
  const peerLabel = shared[0]
    ? (shared[0].source_app === 'aitradespilot' ? 'AI Trades Pilot' : shared[0].source_app === 'aiqs-portal' ? 'AI QS Portal' : shared[0].source_app)
    : null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: colors.accentBg, border: '1px solid ' + colors.accentBorder, color: colors.accent, flexShrink: 0,
        }}>
          <BrainIcon size={26} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0, letterSpacing: '-0.02em' }}>
            Super Brain
          </h1>
          <p style={{ fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 1.5, maxWidth: 640 }}>
            Everything {snap.appLabel} has learned, across every knowledge layer — and what it has picked up
            from its sibling app. Knowledge shared between apps is anonymised aggregates only: rates, quantity
            benchmarks and scope patterns. Never names, clients or memories.
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.accent }}>{(snap.totalKnowledge || 0).toLocaleString()}</div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>pieces of knowledge</div>
        </div>
      </div>

      {/* Cross-app exchange panel */}
      <div style={{
        padding: '18px 20px', borderRadius: 12, marginBottom: 24,
        background: colors.accentBg, border: '1px solid ' + colors.accentBorder,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, display: 'flex', alignItems: 'center', gap: 8 }}>
              <RefreshIcon size={16} style={{ color: colors.accent }} />
              Cross-app knowledge exchange
            </div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 1.5 }}>
              {shared.length > 0 ? (
                <>Learned from <strong>{peerLabel}</strong>: {shared[0].rates} rates, {shared[0].quantities} quantity
                benchmarks, {shared[0].patterns} patterns · last sync {timeAgo(shared[0].imported_at)}</>
              ) : snap.peerConfigured ? (
                <>No knowledge imported yet — run the first sync to pull what the sibling app has learned.</>
              ) : (
                <>Not connected. Set <code>SUPER_BRAIN_PEER_URL</code> and <code>SUPER_BRAIN_KEY</code> (same key on
                both apps) to link the two brains.</>
              )}
            </div>
          </div>
          <button
            onClick={syncNow}
            disabled={syncing || !snap.peerConfigured}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none', cursor: snap.peerConfigured ? 'pointer' : 'not-allowed',
              background: snap.peerConfigured ? colors.accent : colors.cardBorder,
              color: snap.peerConfigured ? '#1A1206' : colors.textMuted,
              fontSize: 14, fontWeight: 600, opacity: syncing ? 0.7 : 1,
            }}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        {syncMsg && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8,
            background: syncMsg.ok ? colors.goodBg : colors.badBg,
            color: syncMsg.ok ? colors.good : colors.bad,
          }}>
            {syncMsg.ok ? <CheckCircleIcon size={15} /> : <AlertCircleIcon size={15} />}
            {syncMsg.text}
          </div>
        )}
      </div>

      {/* Knowledge layers */}
      <h2 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: '0 0 12px' }}>Knowledge layers</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 28 }}>
        {layers.map(l => {
          const Icon = LAYER_ICONS[l.key] || BrainIcon;
          return (
            <div key={l.key} style={{
              padding: '16px 18px', borderRadius: 10,
              background: colors.card, border: '1px solid ' + colors.cardBorder,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.text, fontSize: 14, fontWeight: 600 }}>
                  <Icon size={15} style={{ color: colors.accent }} />
                  {l.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: colors.accent }}>{(l.count || 0).toLocaleString()}</div>
              </div>
              <div style={{ fontSize: 12.5, color: colors.textMuted, marginTop: 6, lineHeight: 1.5 }}>{l.description}</div>
              <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {l.samples != null && <span>{l.samples} samples</span>}
                {l.avg_confidence != null && <span>confidence {Math.round(l.avg_confidence * 100)}%</span>}
                {l.users != null && <span>{l.users} users</span>}
                {l.facts != null && <span>{l.facts} facts</span>}
                {l.sources != null && <span>{l.sources} sources</span>}
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ClockIcon size={11} /> {timeAgo(l.last_activity)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent learnings */}
      <h2 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: '0 0 12px' }}>Recent learnings</h2>
      <div style={{ background: colors.card, border: '1px solid ' + colors.cardBorder, borderRadius: 10, marginBottom: 28 }}>
        {(snap.recentLearnings || []).length === 0 && (
          <div style={{ padding: 20, fontSize: 13, color: colors.textMuted }}>
            Nothing yet — the brain learns from confirmed BOQs, corrections and conversations.
          </div>
        )}
        {(snap.recentLearnings || []).map((r, i) => (
          <div key={i} style={{
            padding: '11px 16px', fontSize: 13, color: colors.text, lineHeight: 1.5,
            borderTop: i > 0 ? '1px solid ' + colors.cardBorder : 'none',
            display: 'flex', gap: 10, alignItems: 'baseline',
          }}>
            <span style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: r.kind === 'correction' ? colors.good : colors.accent, flexShrink: 0,
            }}>
              {r.kind}
            </span>
            <span style={{ flex: 1 }}>{r.text}</span>
            <span style={{ fontSize: 11.5, color: colors.textMuted, flexShrink: 0 }}>{timeAgo(r.at)}</span>
          </div>
        ))}
      </div>

      {/* Sync history */}
      {(snap.syncHistory || []).length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: '0 0 12px' }}>Sync history</h2>
          <div style={{ background: colors.card, border: '1px solid ' + colors.cardBorder, borderRadius: 10 }}>
            {snap.syncHistory.map((s, i) => (
              <div key={i} style={{
                padding: '10px 16px', fontSize: 13, color: colors.textMuted,
                borderTop: i > 0 ? '1px solid ' + colors.cardBorder : 'none',
                display: 'flex', gap: 10, alignItems: 'center',
              }}>
                <span style={{ color: s.direction === 'in' ? colors.good : colors.accent, fontWeight: 600 }}>
                  {s.direction === 'in' ? '↓ imported' : '↑ served'}
                </span>
                <span style={{ flex: 1 }}>
                  {s.peer_app || 'peer'}{s.direction === 'in' ? ` — ${s.rates_count} rates, ${s.quantities_count} quantities, ${s.patterns_count} patterns` : ''}
                </span>
                <span style={{ fontSize: 11.5 }}>{timeAgo(s.created_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
