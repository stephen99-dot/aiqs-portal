import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import {
  RulerIcon, CoinsIcon, ShopIcon, ClipboardIcon, MapPinIcon, WrenchIcon,
  ChatIcon, SettingsIcon, BanIcon, ClientsIcon, BuildingIcon, BarChartIcon,
  EditIcon, BrainIcon, PoundIcon, CheckIcon, XIcon,
} from '../components/Icons';

const CATEGORY_LABELS = {
  spec_preference: { label: 'Spec Preferences', emoji: RulerIcon, desc: 'Material and specification choices' },
  markup: { label: 'Markups & Margins', emoji: CoinsIcon, desc: 'Pricing and margin preferences' },
  supplier: { label: 'Suppliers', emoji: ShopIcon, desc: 'Preferred suppliers and merchants' },
  scope: { label: 'Scope Patterns', emoji: ClipboardIcon, desc: 'Items you always include or exclude' },
  geography: { label: 'Location', emoji: MapPinIcon, desc: 'Where you operate' },
  trade: { label: 'Trades & Subcontractors', emoji: WrenchIcon, desc: 'How you manage trades' },
  standard: { label: 'Standards', emoji: RulerIcon, desc: 'Measurement and compliance standards' },
  feedback: { label: 'Preferences', emoji: ChatIcon, desc: 'How you like your BOQs and reports' },
  workflow: { label: 'Workflow', emoji: SettingsIcon, desc: 'How you work and order projects' },
  exclusion: { label: 'Standard Exclusions', emoji: BanIcon, desc: 'Items always excluded from estimates' },
  team: { label: 'Team & Roles', emoji: ClientsIcon, desc: 'Your team structure and day rates' },
  project_type: { label: 'Project Types', emoji: BuildingIcon, desc: 'Types of work you typically do' },
  commercial: { label: 'Commercial Terms', emoji: BarChartIcon, desc: 'Payment, contract, and commercial info' },
};

export default function AIMemoryPage() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';
  const [insights, setInsights] = useState([]);
  const [memories, setMemories] = useState([]);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [rateStats, setRateStats] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addingMemory, setAddingMemory] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [editingText, setEditingText] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [insightData, rateData, memData, onbData] = await Promise.all([
        apiFetch('/my-insights').catch(() => ({ insights: [], stats: null })),
        apiFetch('/my-rates').catch(() => ({ stats: null })),
        apiFetch('/memories').catch(() => ({ memories: [] })),
        apiFetch('/onboarding').catch(() => null),
      ]);
      setInsights(insightData.insights || []);
      setStats(insightData.stats || { total: 0, categories: 0 });
      setRateStats(rateData.stats || { total: 0, avg_confidence: 0 });
      setMemories(memData.memories || []);
      setOnboardingStatus(onbData);
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

  async function handleDeleteMemory(id) {
    if (!window.confirm('Forget this memory?')) return;
    try {
      await apiFetch('/memories/' + id, { method: 'DELETE' });
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (err) { alert('Failed to delete'); }
  }

  async function handleAddMemory() {
    const content = newMemoryText.trim();
    if (content.length < 5) { alert('Memory text is too short.'); return; }
    try {
      const res = await apiFetch('/memories', { method: 'POST', body: JSON.stringify({ content }) });
      if (res.skipped) {
        alert('A similar memory already exists.');
      } else if (res.memory) {
        setMemories(p => [res.memory, ...p]);
        setNewMemoryText('');
        setAddingMemory(false);
      }
    } catch (err) { alert(err.message || 'Failed to save memory'); }
  }

  async function handleSaveEdit(id) {
    const content = editingText.trim();
    if (content.length < 5) { alert('Memory text is too short.'); return; }
    try {
      const res = await apiFetch('/memories/' + id, { method: 'PUT', body: JSON.stringify({ content }) });
      if (res.memory) {
        setMemories(p => p.map(m => m.id === id ? res.memory : m));
      }
      setEditingMemoryId(null);
      setEditingText('');
    } catch (err) { alert(err.message || 'Failed to update'); }
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

  const totalLearnings = (stats?.total || 0) + (rateStats?.total || 0) + (memories?.length || 0);

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

      {/* Onboarding CTA — only shown when not completed */}
      {onboardingStatus && !onboardingStatus.completed_at && (
        <div style={{
          padding: '16px 20px', borderRadius: 10, marginBottom: 16,
          background: colors.accentBg, border: '1px solid ' + colors.accentBorder,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.accent, marginBottom: 4 }}>
              Teach the AI how you work — 2 minutes
            </div>
            <div style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 1.55 }}>
              Answer a handful of fundamentals (contingency %, typical project types, regions, standard exclusions) and every estimate after this will be grounded in your actual preferences.
            </div>
          </div>
          <Link to="/onboarding" style={{
            padding: '9px 16px', borderRadius: 8,
            background: 'linear-gradient(135deg,#F59E0B,#D97706)',
            color: '#0A0F1C', textDecoration: 'none',
            fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
            Start onboarding
          </Link>
        </div>
      )}
      {onboardingStatus && onboardingStatus.completed_at && (
        <div style={{ marginBottom: 16, textAlign: 'right' }}>
          <Link to="/onboarding" style={{ fontSize: 12, color: colors.accent, textDecoration: 'none', fontWeight: 600 }}>
            Update your profile →
          </Link>
        </div>
      )}

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

      {/* User memories section */}
      <div style={{
        padding: '18px 20px', borderRadius: 10, marginBottom: 20,
        background: colors.card, border: '1px solid ' + colors.cardBorder,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <BrainIcon size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Memories</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              Facts and preferences you've confirmed, plus anything the AI has remembered from your chats.
            </div>
          </div>
          <div style={{
            fontSize: 11, fontWeight: 600,
            padding: '2px 8px', borderRadius: 10,
            background: colors.accentBg, color: colors.accent,
          }}>
            {memories.length}
          </div>
          <button
            onClick={() => setAddingMemory(v => !v)}
            style={{
              padding: '6px 12px', borderRadius: 7,
              background: addingMemory ? 'transparent' : colors.accentBg,
              border: '1px solid ' + colors.accentBorder,
              color: colors.accent, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {addingMemory ? 'Cancel' : '+ Add memory'}
          </button>
        </div>

        {addingMemory && (
          <div style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
            <textarea
              value={newMemoryText}
              onChange={e => setNewMemoryText(e.target.value)}
              placeholder="e.g. I always exclude asbestos surveys from refurb quotes."
              rows={2}
              style={{
                flex: 1, padding: '8px 11px', borderRadius: 7,
                background: isDark ? '#0F1520' : '#F8FAFC',
                border: '1px solid ' + colors.cardBorder,
                color: colors.text, fontSize: 13, outline: 'none', resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleAddMemory}
              style={{
                padding: '8px 14px', borderRadius: 7,
                background: 'linear-gradient(135deg,#F59E0B,#D97706)',
                border: 'none', color: '#0A0F1C', fontSize: 12.5, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              Save
            </button>
          </div>
        )}

        {memories.length === 0 ? (
          <div style={{ padding: '18px 8px', fontSize: 12.5, color: colors.textMuted, textAlign: 'center' }}>
            No memories yet. Complete onboarding or chat with the AI — durable preferences will appear here automatically.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {memories.map(m => {
              const isEditing = editingMemoryId === m.id;
              const sourceLabel = m.source === 'onboarding' ? 'Onboarding' :
                m.source === 'user' ? 'Added by you' :
                m.source === 'chat' ? 'From chat' : m.source;
              return (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 14px', borderRadius: 8,
                  background: m.source === 'onboarding' ? colors.strong : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
                  border: '1px solid ' + (m.source === 'onboarding' ? colors.strongBorder : 'transparent'),
                }}>
                  <div style={{ flex: 1 }}>
                    {isEditing ? (
                      <textarea
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        rows={2}
                        style={{
                          width: '100%', padding: '6px 9px', borderRadius: 6,
                          background: isDark ? '#0F1520' : '#FFFFFF',
                          border: '1px solid ' + colors.cardBorder,
                          color: colors.text, fontSize: 13, resize: 'vertical',
                          fontFamily: 'inherit',
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.5 }}>{m.content}</div>
                    )}
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {m.category && <span>{m.category.replace(/_/g, ' ')}</span>}
                      <span>· {sourceLabel}</span>
                      {m.use_count > 0 && <span>· used {m.use_count}×</span>}
                      <span>· {new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(m.id)}
                          title="Save"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.accent, padding: '2px 6px', fontWeight: 700 }}
                        ><CheckIcon size={14} /></button>
                        <button
                          onClick={() => { setEditingMemoryId(null); setEditingText(''); }}
                          title="Cancel"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 16, padding: '2px 6px' }}
                        >×</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditingMemoryId(m.id); setEditingText(m.content); }}
                          title="Edit"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 13, padding: '2px 6px', opacity: 0.6 }}
                          onMouseEnter={e => { e.target.style.opacity = '1'; e.target.style.color = colors.accent; }}
                          onMouseLeave={e => { e.target.style.opacity = '0.6'; e.target.style.color = colors.textMuted; }}
                        ><EditIcon size={13} /></button>
                        <button
                          onClick={() => handleDeleteMemory(m.id)}
                          title="Forget"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 16, padding: '2px 6px', opacity: 0.5 }}
                          onMouseEnter={e => { e.target.style.opacity = '1'; e.target.style.color = '#EF4444'; }}
                          onMouseLeave={e => { e.target.style.opacity = '0.5'; e.target.style.color = colors.textMuted; }}
                        >×</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Insights by category */}
      {Object.keys(grouped).length === 0 && (rateStats?.total || 0) === 0 && (memories?.length || 0) === 0 ? (
        <div style={{
          padding: '48px 24px', borderRadius: 12, textAlign: 'center',
          background: colors.card, border: '1px solid ' + colors.cardBorder,
        }}>
          <div style={{ marginBottom: 12 }}><BrainIcon size={36} /></div>
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
                <PoundIcon size={18} />
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
            const catInfo = CATEGORY_LABELS[category] || { label: category, emoji: EditIcon, desc: '' };
            const CatIcon = catInfo.emoji;
            return (
              <div key={category} style={{
                padding: '18px 20px', borderRadius: 10,
                background: colors.card, border: '1px solid ' + colors.cardBorder,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  {CatIcon && <CatIcon size={18} />}
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
