import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

const CATEGORY_LABELS = {
  spec_preference: { label: 'Spec Preferences', emoji: '📐', desc: 'Material and specification choices' },
  markup: { label: 'Markups & Margins', emoji: '💰', desc: 'Pricing and margin preferences' },
  supplier: { label: 'Suppliers', emoji: '🏪', desc: 'Preferred suppliers and merchants' },
  scope: { label: 'Scope Patterns', emoji: '📋', desc: 'Items you always include or exclude' },
  geography: { label: 'Location', emoji: '📍', desc: 'Where you operate' },
  trade: { label: 'Trades & Subcontractors', emoji: '🔧', desc: 'How you manage trades' },
  standard: { label: 'Standards', emoji: '📏', desc: 'Measurement and compliance standards' },
  feedback: { label: 'Preferences', emoji: '💬', desc: 'How you like your BOQs and reports' },
  workflow: { label: 'Workflow', emoji: '⚙️', desc: 'How you work and order projects' },
  exclusion: { label: 'Standard Exclusions', emoji: '🚫', desc: 'Items always excluded from estimates' },
  team: { label: 'Team & Roles', emoji: '👥', desc: 'Your team structure and day rates' },
  project_type: { label: 'Project Types', emoji: '🏗️', desc: 'Types of work you typically do' },
  commercial: { label: 'Commercial Terms', emoji: '📊', desc: 'Payment, contract, and commercial info' },
};

export default function AIMemoryPage() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';
  const [insights, setInsights] = useState([]);
  const [rateStats, setRateStats] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [insightData, rateData] = await Promise.all([
        apiFetch('/my-insights'),
        apiFetch('/my-rates'),
      ]);
      setInsights(insightData.insights || []);
      setStats(insightData.stats || { total: 0, categories: 0 });
      setRateStats(rateData.stats || { total: 0, avg_confidence: 0 });
    } catch (err) {
      console.error('Load error:', err);
    }
    setLoading(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this from AI memory?')) return;
    try {
      await apiFetch('/my-insights/' + id, { method: 'DELETE' });
      setInsights(prev => prev.filter(i => i.id !== id));
    } catch (err) { alert('Failed to delete'); }
  }

  // Group insights by category
  const grouped = {};
  for (const ins of insights) {
    if (!grouped[ins.category]) grouped[ins.category] = [];
    grouped[ins.category].push(ins);
  }

  const colors = {
    bg: isDark ? '#0A0F1C' : '#F8FAFC',
    card: isDark ? '#111827' : '#FFFFFF',
    cardBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    text: isDark ? '#E2E8F0' : '#1E293B',
    textMuted: isDark ? '#94A3B8' : '#64748B',
    accent: '#F59E0B',
    accentBg: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
    accentBorder: isDark ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.12)',
    strong: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.08)',
    strongBorder: isDark ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)',
    strongText: '#10B981',
    deleteHover: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)',
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
        Loading AI Memory...
      </div>
    );
  }

  const totalLearnings = (stats?.total || 0) + (rateStats?.total || 0);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0, letterSpacing: '-0.02em' }}>
          AI Memory
        </h1>
        <p style={{ fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 1.5 }}>
          Everything the AI QS has learned about how you work. This builds automatically from your conversations and makes every estimate more accurate over time.
        </p>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        <div style={{
          padding: '18px 20px', borderRadius: 10,
          background: colors.card, border: '1px solid ' + colors.cardBorder,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.accent, letterSpacing: '-0.02em' }}>
            {totalLearnings}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: 500 }}>
            Total Learnings
          </div>
        </div>
        <div style={{
          padding: '18px 20px', borderRadius: 10,
          background: colors.card, border: '1px solid ' + colors.cardBorder,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em' }}>
            {rateStats?.total || 0}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: 500 }}>
            Trained Rates
          </div>
        </div>
        <div style={{
          padding: '18px 20px', borderRadius: 10,
          background: colors.card, border: '1px solid ' + colors.cardBorder,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em' }}>
            {stats?.total || 0}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: 500 }}>
            Client Insights
          </div>
        </div>
      </div>

      {/* How it works */}
      <div style={{
        padding: '16px 20px', borderRadius: 10, marginBottom: 28,
        background: colors.accentBg, border: '1px solid ' + colors.accentBorder,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.accent, marginBottom: 6 }}>
          How AI Memory Works
        </div>
        <div style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6 }}>
          Every time you chat with the AI QS, it picks up on your preferences, rates, suppliers, and working patterns. 
          These get stored here and automatically applied to all your future projects. 
          The more you use it, the more tailored your estimates become. 
          You can remove anything here that you don't want the AI to remember.
        </div>
      </div>

      {/* Insights by category */}
      {Object.keys(grouped).length === 0 && (rateStats?.total || 0) === 0 ? (
        <div style={{
          padding: '48px 24px', borderRadius: 12, textAlign: 'center',
          background: colors.card, border: '1px solid ' + colors.cardBorder,
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🧠</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
            No memories yet
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, maxWidth: 400, margin: '0 auto', lineHeight: 1.5 }}>
            Start chatting with the AI QS about your projects. As you provide rates, preferences, and feedback, the system will learn and remember them here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Rates summary card */}
          {rateStats && rateStats.total > 0 && (
            <div style={{
              padding: '18px 20px', borderRadius: 10,
              background: colors.card, border: '1px solid ' + colors.cardBorder,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>💷</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Trained Rates</div>
                  <div style={{ fontSize: 12, color: colors.textMuted }}>
                    {rateStats.total} rates learned, avg confidence {Math.round((rateStats.avg_confidence || 0) * 100)}%
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                View and manage your rates on the My Rates page. These are automatically applied to every estimate.
              </div>
            </div>
          )}

          {/* Insight categories */}
          {Object.entries(grouped).map(([category, items]) => {
            const catInfo = CATEGORY_LABELS[category] || { label: category, emoji: '📝', desc: '' };
            return (
              <div key={category} style={{
                padding: '18px 20px', borderRadius: 10,
                background: colors.card, border: '1px solid ' + colors.cardBorder,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>{catInfo.emoji}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{catInfo.label}</div>
                    {catInfo.desc && <div style={{ fontSize: 12, color: colors.textMuted }}>{catInfo.desc}</div>}
                  </div>
                  <div style={{
                    marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                    padding: '2px 8px', borderRadius: 10,
                    background: colors.accentBg, color: colors.accent,
                  }}>
                    {items.length}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map(ins => (
                    <div key={ins.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 8,
                      background: ins.times_reinforced >= 3 ? colors.strong : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
                      border: '1px solid ' + (ins.times_reinforced >= 3 ? colors.strongBorder : 'transparent'),
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>
                          {ins.insight}
                        </div>
                        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, display: 'flex', gap: 12 }}>
                          {ins.times_reinforced >= 3 && (
                            <span style={{ color: colors.strongText, fontWeight: 600 }}>
                              Strong ({ins.times_reinforced}x confirmed)
                            </span>
                          )}
                          {ins.times_reinforced > 1 && ins.times_reinforced < 3 && (
                            <span>Mentioned {ins.times_reinforced}x</span>
                          )}
                          <span>{new Date(ins.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(ins.id)}
                        title="Remove from memory"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: colors.textMuted, fontSize: 16, padding: '4px 8px',
                          borderRadius: 6, transition: 'all 0.15s',
                          opacity: 0.5,
                        }}
                        onMouseEnter={e => { e.target.style.opacity = '1'; e.target.style.color = '#EF4444'; }}
                        onMouseLeave={e => { e.target.style.opacity = '0.5'; e.target.style.color = colors.textMuted; }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
