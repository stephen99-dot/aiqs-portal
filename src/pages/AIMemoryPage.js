import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import {
  Button, IconButton, Card, Banner, Badge, Stat,
  Input, Textarea, Field, PageHeader, EmptyState, Skeleton, SkeletonCard, useToast,
} from '../ui';
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

// Tinted row used for memories / facts / insights lists. `strong` rows (from
// onboarding, or reinforced insights) get the success tint.
const rowStyle = (strong) => ({
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: '10px 14px', borderRadius: 8,
  background: strong ? 'var(--success-bg)' : 'var(--surface-hover)',
  border: '1px solid ' + (strong ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'transparent'),
});

export default function AIMemoryPage() {
  const toast = useToast();
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
  // Entities — the people and firms on this builder's jobs. Personal data, so the whole
  // point of surfacing it here is that the builder can see it, correct it and delete it.
  const [entities, setEntities] = useState([]);
  const [expandedEntityId, setExpandedEntityId] = useState(null);
  const [newFactText, setNewFactText] = useState('');
  const [prefs, setPrefs] = useState(null);          // { ohp_pct, contingency_pct }
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [insightData, rateData, memData, onbData, prefData, entData] = await Promise.all([
        apiFetch('/my-insights').catch(() => ({ insights: [], stats: null })),
        apiFetch('/my-rates').catch(() => ({ stats: null })),
        apiFetch('/memories').catch(() => ({ memories: [] })),
        apiFetch('/onboarding').catch(() => null),
        apiFetch('/pricing-prefs').catch(() => null),
        apiFetch('/entities').catch(() => ({ entities: [] })),
      ]);
      setEntities(entData.entities || []);
      setInsights(insightData.insights || []);
      setStats(insightData.stats || { total: 0, categories: 0 });
      setRateStats(rateData.stats || { total: 0, avg_confidence: 0 });
      setMemories(memData.memories || []);
      setOnboardingStatus(onbData);
      if (prefData) setPrefs({ ohp_pct: prefData.ohp_pct ?? 0, contingency_pct: prefData.contingency_pct ?? 0 });
    } catch (err) {
      console.error('Load error:', err);
    }
    setLoading(false);
  }

  async function handleDeleteEntity(ent) {
    if (!window.confirm(
      `Delete "${ent.display_name}" and everything remembered about them?\n\nThis cannot be undone.`
    )) return;
    try {
      await apiFetch('/entities/' + ent.id, { method: 'DELETE' });
      setEntities(prev => prev.filter(e => e.id !== ent.id));
    } catch (err) { toast.error('Failed to delete'); }
  }

  async function handleRenameEntity(ent) {
    const name = window.prompt('Name', ent.display_name);
    if (!name || name.trim() === ent.display_name) return;
    try {
      const res = await apiFetch('/entities/' + ent.id, {
        method: 'PUT', body: JSON.stringify({ name: name.trim() }),
      });
      setEntities(prev => prev.map(e => (e.id === ent.id ? { ...e, ...res.entity } : e)));
    } catch (err) { toast.error('Failed to rename'); }
  }

  // Facts expire rather than delete, so what the system used to believe stays on record
  // while no longer reaching the model.
  async function handleForgetFact(entityId, factId) {
    try {
      await apiFetch('/entities/facts/' + factId, { method: 'DELETE' });
      setEntities(prev => prev.map(e =>
        e.id === entityId ? { ...e, facts: e.facts.filter(f => f.id !== factId) } : e
      ));
    } catch (err) { toast.error('Failed to remove'); }
  }

  async function handleAddFact(entityId) {
    const content = newFactText.trim();
    if (!content) return;
    try {
      const res = await apiFetch('/entities/' + entityId + '/facts', {
        method: 'POST', body: JSON.stringify({ content }),
      });
      setEntities(prev => prev.map(e =>
        e.id === entityId ? { ...e, facts: [res.fact, ...(e.facts || [])] } : e
      ));
      setNewFactText('');
    } catch (err) { toast.error('Failed to add'); }
  }

  async function handleMergeEntity(ent) {
    const others = entities.filter(e => e.id !== ent.id && e.kind === ent.kind);
    if (others.length === 0) { toast.show(`No other ${ent.kind.replace(/_/g, ' ')} records to merge into.`); return; }
    const choice = window.prompt(
      `Merge "${ent.display_name}" into which record?\n\n`
      + others.map((e, i) => `${i + 1}. ${e.display_name}`).join('\n')
      + '\n\nEnter a number:'
    );
    const idx = parseInt(choice, 10) - 1;
    if (!(idx >= 0 && idx < others.length)) return;
    try {
      await apiFetch('/entities/' + ent.id + '/merge', {
        method: 'POST', body: JSON.stringify({ into: others[idx].id }),
      });
      await loadData();
    } catch (err) { toast.error('Failed to merge'); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this from AI memory?')) return;
    try {
      await apiFetch('/my-insights/' + id, { method: 'DELETE' });
      setInsights(prev => prev.filter(i => i.id !== id));
    } catch (err) { toast.error('Failed to delete'); }
  }

  async function handleDeleteMemory(id) {
    if (!window.confirm('Forget this memory?')) return;
    try {
      await apiFetch('/memories/' + id, { method: 'DELETE' });
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (err) { toast.error('Failed to delete'); }
  }

  async function handleAddMemory() {
    const content = newMemoryText.trim();
    if (content.length < 5) { toast.error('Memory text is too short.'); return; }
    try {
      const res = await apiFetch('/memories', { method: 'POST', body: JSON.stringify({ content }) });
      if (res.skipped) {
        toast.show('A similar memory already exists.');
      } else if (res.memory) {
        setMemories(p => [res.memory, ...p]);
        setNewMemoryText('');
        setAddingMemory(false);
      }
    } catch (err) { toast.error(err.message || 'Failed to save memory'); }
  }

  async function handleSavePrefs() {
    setPrefsSaving(true); setPrefsSaved(false);
    try {
      const res = await apiFetch('/pricing-prefs', {
        method: 'PUT',
        body: JSON.stringify({ ohp_pct: prefs.ohp_pct, contingency_pct: prefs.contingency_pct }),
      });
      setPrefs({ ohp_pct: res.ohp_pct ?? 0, contingency_pct: res.contingency_pct ?? 0 });
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 2500);
    } catch (err) { toast.error(err.message || 'Failed to save'); }
    setPrefsSaving(false);
  }

  async function handleSaveEdit(id) {
    const content = editingText.trim();
    if (content.length < 5) { toast.error('Memory text is too short.'); return; }
    try {
      const res = await apiFetch('/memories/' + id, { method: 'PUT', body: JSON.stringify({ content }) });
      if (res.memory) {
        setMemories(p => p.map(m => m.id === id ? res.memory : m));
      }
      setEditingMemoryId(null);
      setEditingText('');
    } catch (err) { toast.error(err.message || 'Failed to update'); }
  }

  // Group insights by category
  const grouped = {};
  for (const ins of insights) {
    if (!grouped[ins.category]) grouped[ins.category] = [];
    grouped[ins.category].push(ins);
  }

  if (loading) {
    return (
      <div className="page" style={{ maxWidth: 900 }}>
        <Skeleton width={160} height={24} style={{ marginBottom: 8 }} />
        <Skeleton width={420} height={12} style={{ marginBottom: 24 }} />
        <div className="ui-grid" style={{ '--grid-min': '180px', marginBottom: 24 }}>
          <SkeletonCard height={70} />
          <SkeletonCard height={70} />
          <SkeletonCard height={70} />
        </div>
        <SkeletonCard height={140} />
      </div>
    );
  }

  const totalLearnings = (stats?.total || 0) + (rateStats?.total || 0) + (memories?.length || 0);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHeader
        title="AI Memory"
        subtitle="Everything the AI QS has learned about how you work. This builds automatically from your conversations and makes every estimate more accurate over time."
      />

      {/* Stats cards */}
      <div className="ui-grid" style={{ '--grid-min': '180px', marginBottom: 24 }}>
        <Stat value={totalLearnings} label="Total Learnings" accent />
        <Stat value={rateStats?.total || 0} label="Trained Rates" />
        <Stat value={stats?.total || 0} label="Client Insights" />
      </div>

      {/* Onboarding CTA — only shown when not completed */}
      {onboardingStatus && !onboardingStatus.completed_at && (
        <Banner tone="accent">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
                Teach the AI how you work — 2 minutes
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Three short steps — your trade, a few qualifying questions, and anything you want to add — and every estimate after this will price from your rates and preferences.
              </div>
            </div>
            <Button to="/onboarding">Start onboarding</Button>
          </div>
        </Banner>
      )}
      {onboardingStatus && onboardingStatus.completed_at && (
        <div style={{ marginBottom: 16, textAlign: 'right' }}>
          <Link to="/onboarding" style={{ fontSize: '0.78rem', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
            Update your profile →
          </Link>
        </div>
      )}

      {/* How it works */}
      <Banner tone="accent" style={{ marginBottom: 28 }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
          How AI Memory Works
        </div>
        <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Every time you chat with the AI QS, it picks up on your preferences, rates, suppliers, and working patterns.
          These get stored here and automatically applied to all your future projects.
          The more you use it, the more tailored your estimates become.
          You can remove anything here that you don't want the AI to remember.
        </div>
      </Banner>

      {/* Pricing margins — the per-user BOQ markup setting */}
      {prefs && (
        <Card style={{ marginBottom: 20 }}>
          <Card.Header title={<><PoundIcon size={16} style={{ verticalAlign: '-2px', marginRight: 8 }} />Pricing margins</>} />
          <Card.Body>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 14 }}>
              Leave both at 0 and your BOQ totals are the all-in price — every rate already
              includes the builder's overhead and profit, like a real quote. Set a percentage
              here to add a visible Contingency and/or Overheads &amp; Profit line on top of
              every BOQ instead.
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Contingency %" style={{ width: 110 }}>
                <Input
                  type="number" inputMode="decimal" min="0" max="100" step="0.5"
                  value={prefs.contingency_pct}
                  onChange={e => setPrefs(p => ({ ...p, contingency_pct: e.target.value }))}
                />
              </Field>
              <Field label="Overheads & profit %" style={{ width: 150 }}>
                <Input
                  type="number" inputMode="decimal" min="0" max="100" step="0.5"
                  value={prefs.ohp_pct}
                  onChange={e => setPrefs(p => ({ ...p, ohp_pct: e.target.value }))}
                />
              </Field>
              <Button onClick={handleSavePrefs} disabled={prefsSaving} busyLabel="Saving…">
                {prefsSaved ? 'Saved ✓' : 'Save margins'}
              </Button>
            </div>
            {(Number(prefs.contingency_pct) > 0 || Number(prefs.ohp_pct) > 0) && (
              <div style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: 10 }}>
                Every new BOQ will show {Number(prefs.contingency_pct) > 0 ? `Contingency (${prefs.contingency_pct}%)` : ''}
                {Number(prefs.contingency_pct) > 0 && Number(prefs.ohp_pct) > 0 ? ' and ' : ''}
                {Number(prefs.ohp_pct) > 0 ? `Overheads & Profit (${prefs.ohp_pct}%)` : ''} on top of the priced items.
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* User memories section */}
      <Card style={{ marginBottom: 20 }}>
        <Card.Header
          title={<><BrainIcon size={16} style={{ verticalAlign: '-2px', marginRight: 8 }} />Memories</>}
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge tone="accent" pill>{memories.length}</Badge>
              <Button size="sm" variant={addingMemory ? 'ghost' : 'soft'} onClick={() => setAddingMemory(v => !v)}>
                {addingMemory ? 'Cancel' : '+ Add memory'}
              </Button>
            </div>
          }
        />
        <Card.Body>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
            Facts and preferences you've confirmed, plus anything the AI has remembered from your chats.
          </div>

          {addingMemory && (
            <div style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Textarea
                value={newMemoryText}
                onChange={e => setNewMemoryText(e.target.value)}
                placeholder="e.g. I always exclude asbestos surveys from refurb quotes."
                rows={2}
                style={{ flex: 1, minHeight: 0 }}
              />
              <Button onClick={handleAddMemory} busyLabel="Saving…">Save</Button>
            </div>
          )}

          {memories.length === 0 ? (
            <div style={{ padding: '18px 8px', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              No memories yet. Complete onboarding or chat with the AI — durable preferences will appear here automatically.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {memories.map(m => {
                const isEditing = editingMemoryId === m.id;
                const sourceLabel = m.source === 'onboarding' ? 'Onboarding' :
                  m.source === 'user' ? 'Added by you' :
                  m.source === 'chat' ? 'From chat' :
                  m.source === 'auto' ? 'Learned automatically' : m.source;
                return (
                  <div key={m.id} style={rowStyle(m.source === 'onboarding')}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <Textarea
                          value={editingText}
                          onChange={e => setEditingText(e.target.value)}
                          rows={2}
                          style={{ minHeight: 0 }}
                        />
                      ) : (
                        <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{m.content}</div>
                      )}
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {m.category && <span>{m.category.replace(/_/g, ' ')}</span>}
                        <span>· {sourceLabel}</span>
                        {m.use_count > 0 && <span>· used {m.use_count}×</span>}
                        <span>· {new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {isEditing ? (
                        <>
                          <IconButton onClick={() => handleSaveEdit(m.id)} title="Save" aria-label="Save memory"><CheckIcon size={14} /></IconButton>
                          <IconButton onClick={() => { setEditingMemoryId(null); setEditingText(''); }} title="Cancel" aria-label="Cancel edit"><XIcon size={14} /></IconButton>
                        </>
                      ) : (
                        <>
                          <IconButton onClick={() => { setEditingMemoryId(m.id); setEditingText(m.content); }} title="Edit" aria-label="Edit memory"><EditIcon size={13} /></IconButton>
                          <IconButton danger onClick={() => handleDeleteMemory(m.id)} title="Forget" aria-label="Forget memory"><XIcon size={14} /></IconButton>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* People and firms — the entity graph */}
      <Card style={{ marginBottom: 20 }}>
        <Card.Header
          title={<><BrainIcon size={16} style={{ verticalAlign: '-2px', marginRight: 8 }} />People &amp; firms</>}
          extra={<Badge tone="accent" pill>{entities.length}</Badge>}
        />
        <Card.Body>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
            Who's on your jobs — clients, subbies, architects, suppliers. The assistant uses this to
            recall who someone is and what happened last time. Nothing here changes a price.
          </div>

          {entities.length === 0 ? (
            <div style={{ padding: '18px 8px', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              Nobody recorded yet. Your saved clients appear here automatically, and the assistant will
              ask before adding anyone it hears about in a chat.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entities.map(ent => {
                const isOpen = expandedEntityId === ent.id;
                const kindLabel = ent.kind.replace(/_/g, ' ');
                const jobCount = new Set((ent.events || []).filter(e => e.job_id).map(e => e.job_id)).size;
                return (
                  <div key={ent.id} style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'var(--surface-hover)',
                    border: '1px solid ' + (isOpen ? 'var(--border-accent)' : 'transparent'),
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                          {ent.display_name}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ textTransform: 'capitalize' }}>{kindLabel}</span>
                          {jobCount > 0 && <span>· {jobCount} job{jobCount === 1 ? '' : 's'}</span>}
                          {(ent.facts || []).length > 0 && <span>· {ent.facts.length} thing{ent.facts.length === 1 ? '' : 's'} remembered</span>}
                          {ent.source === 'estimator_clients' && <span>· From your clients</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button size="sm" variant="ghost" onClick={() => { setExpandedEntityId(isOpen ? null : ent.id); setNewFactText(''); }}>
                          {isOpen ? 'Close' : 'Details'}
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => handleDeleteEntity(ent)}
                          title="Delete this person or firm and everything remembered about them"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        {(ent.facts || []).length === 0 ? (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                            Nothing remembered about them yet.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                            {ent.facts.map(f => (
                              <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{f.content}</div>
                                <Button size="sm" variant="ghost"
                                  onClick={() => handleForgetFact(ent.id, f.id)}
                                  title="Stop using this. It stays on record but is no longer given to the assistant."
                                >
                                  Forget
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                          <Input
                            value={newFactText}
                            onChange={e => setNewFactText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddFact(ent.id); }}
                            placeholder="e.g. Always wants the kitchen priced as a PC sum"
                            style={{ flex: 1 }}
                          />
                          <Button variant="soft" onClick={() => handleAddFact(ent.id)}>Add</Button>
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                          <Button size="sm" variant="ghost" onClick={() => handleRenameEntity(ent)}>Rename</Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => handleMergeEntity(ent)}
                            title="Same person or firm recorded twice? Merge them."
                          >
                            Merge into another
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Insights by category */}
      {Object.keys(grouped).length === 0 && (rateStats?.total || 0) === 0 && (memories?.length || 0) === 0 ? (
        <Card>
          <EmptyState
            icon={BrainIcon}
            title="No memories yet"
            body="Start chatting with the AI QS about your projects. As you provide rates, preferences, and feedback, the system will learn and remember them here."
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Rates summary card */}
          {rateStats && rateStats.total > 0 && (
            <Card>
              <Card.Header
                title={<><PoundIcon size={16} style={{ verticalAlign: '-2px', marginRight: 8 }} />Trained Rates</>}
                extra={`${rateStats.total} rates learned, avg confidence ${Math.round((rateStats.avg_confidence || 0) * 100)}%`}
              />
              <Card.Body>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  View and manage your rates on the My Rates page. These are automatically applied to every estimate.
                </div>
              </Card.Body>
            </Card>
          )}

          {/* Insight categories */}
          {Object.entries(grouped).map(([category, items]) => {
            const catInfo = CATEGORY_LABELS[category] || { label: category, emoji: EditIcon, desc: '' };
            const CatIcon = catInfo.emoji;
            return (
              <Card key={category}>
                <Card.Header
                  title={<>{CatIcon && <CatIcon size={16} style={{ verticalAlign: '-2px', marginRight: 8 }} />}{catInfo.label}</>}
                  extra={<Badge tone="accent" pill>{items.length}</Badge>}
                />
                <Card.Body>
                  {catInfo.desc && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>{catInfo.desc}</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map(ins => (
                      <div key={ins.id} style={{ ...rowStyle(ins.times_reinforced >= 3), alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                            {ins.insight}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12 }}>
                            {ins.times_reinforced >= 3 && (
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                Strong ({ins.times_reinforced}x confirmed)
                              </span>
                            )}
                            {ins.times_reinforced > 1 && ins.times_reinforced < 3 && (
                              <span>Mentioned {ins.times_reinforced}x</span>
                            )}
                            <span>{new Date(ins.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          </div>
                        </div>
                        <IconButton danger onClick={() => handleDelete(ins.id)} title="Remove from memory" aria-label="Remove from memory">
                          <XIcon size={14} />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                </Card.Body>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
