import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

const PLAN_OPTIONS = [
  { value: 'starter', label: 'Starter (PAYG)', quota: 0 },
  { value: 'professional', label: 'Professional', quota: 10 },
  { value: 'premium', label: 'Premium', quota: 20 },
  { value: 'custom', label: 'Custom', quota: 999 },
];

const SYSTEM_SERVICES = [
  { label: 'Pipedream API', status: 'operational', uptime: '99.8%' },
  { label: 'Claude API (Anthropic)', status: 'operational', uptime: '99.5%' },
  { label: 'Google Drive Sync', status: 'operational', uptime: '100%' },
  { label: 'Rate Library', status: 'operational', uptime: '100%' },
];

function StatCard({ label, value, sub, emoji, t }) {
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: '22px 18px', boxShadow: t.shadowSm }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 24 }}>{emoji}</span>
        {sub && <span style={{ fontSize: 11, color: t.textMuted }}>{sub}</span>}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: t.text }}>{value}</div>
      <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════

function OverviewTab({ t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <StatCard emoji="👥" label="Total Clients" value="8" sub="4 Pro" t={t} />
        <StatCard emoji="📄" label="Drawings Processed" value="116" sub="this month" t={t} />
        <StatCard emoji="💷" label="Revenue" value="£14,400" sub="all time" t={t} />
        <StatCard emoji="⚡" label="Avg Processing" value="4.2 min" sub="per drawing" t={t} />
      </div>
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: 20, boxShadow: t.shadowSm }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: '0 0 14px' }}>System Health</h3>
        {SYSTEM_SERVICES.map((svc, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < SYSTEM_SERVICES.length - 1 ? '1px solid ' + t.border : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: svc.status === 'operational' ? t.success : t.warning }} />
              <span style={{ fontSize: 13, color: t.text }}>{svc.label}</span>
            </div>
            <span style={{ fontSize: 12, color: t.textMuted }}>{svc.uptime} uptime</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// CLIENTS TAB
// ═══════════════════════════════════════════════════

function ClientsTab({ t }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editPlan, setEditPlan] = useState('');
  const [editQuota, setEditQuota] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', fullName: '', company: '', phone: '' });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  // Reset password modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('Welcome123!');
  const [resetting, setResetting] = useState(false);

  useEffect(() => { loadUsers(); }, []);
  function loadUsers() { setLoading(true); apiFetch('/admin/users').then(r => setUsers(r.users || r || [])).catch(console.error).finally(() => setLoading(false)); }
  function showMsg(text, type = 'success') { setActionMsg({ text, type }); setTimeout(() => setActionMsg(null), 4000); }

  async function handleAddUser(e) {
    e.preventDefault(); setAddError('');
    if (!addForm.email || !addForm.fullName) { setAddError('Email and full name are required'); return; }
    setAdding(true);
    try {
      const newUser = await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify({ email: addForm.email, fullName: addForm.fullName, company: addForm.company, phone: addForm.phone, sendInvite: true }) });
      setUsers(prev => [...prev, { ...newUser, plan: 'starter', planLabel: 'PAYG', quota: 0, used: 0, remaining: 0, atLimit: false }]);
      setShowAddForm(false); setAddForm({ email: '', fullName: '', company: '', phone: '' });
      if (newUser.emailSent) {
        showMsg('Invite emailed to ' + (newUser.email || addForm.email));
      } else if (newUser.magicUrl) {
        const copied = await navigator.clipboard.writeText(newUser.magicUrl).then(() => true).catch(() => false);
        showMsg(copied ? 'User created — invite link copied to clipboard (email not configured)' : 'User created — check console for invite link');
      } else {
        showMsg((newUser.fullName || newUser.email) + ' added successfully');
      }
    } catch (err) { setAddError(err.message || 'Failed to add user'); } finally { setAdding(false); }
  }

  async function handleDelete(userId) {
    setDeleting(true);
    try { await apiFetch('/admin/users/' + userId, { method: 'DELETE' }); setUsers(prev => prev.filter(u => u.id !== userId)); setConfirmDelete(null); showMsg('User deleted'); }
    catch (err) { alert('Failed to delete: ' + err.message); } finally { setDeleting(false); }
  }

  function handleResetPassword(user) {
    setResetTarget(user);
    setResetPassword('Welcome123!');
    setShowResetModal(true);
  }

  async function confirmResetPassword() {
    if (!resetPassword || resetPassword.length < 6) { alert('Password must be at least 6 characters'); return; }
    setResetting(true);
    try {
      await apiFetch('/admin/users/' + resetTarget.id + '/password', { method: 'PUT', body: JSON.stringify({ password: resetPassword }) });
      showMsg('Password reset for ' + (resetTarget.fullName || resetTarget.email) + ' — they will be prompted to set a new one on login');
      setShowResetModal(false);
      setResetTarget(null);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setResetting(false);
    }
  }

  async function handleSendMagicLink(user) {
    try {
      const result = await apiFetch('/admin/users/' + user.id + '/magic-link', { method: 'POST' });
      if (result.emailSent) { showMsg('Magic link emailed to ' + user.email); }
      else if (result.magicUrl) {
        const copied = await navigator.clipboard.writeText(result.magicUrl).then(() => true).catch(() => false);
        if (copied) showMsg('Magic link copied to clipboard');
        else prompt('Magic link (copy this):', result.magicUrl);
      }
    } catch (err) { alert('Failed: ' + err.message); }
  }

  async function handleSyncStripe(user) {
    if (!window.confirm(`Sync ${user.full_name || user.email} from Stripe? This will update their plan and billing cycle from their active subscription.`)) return;
    try {
      const result = await apiFetch('/admin/users/' + user.id + '/sync-stripe', { method: 'POST' });
      showMsg(`Synced: ${result.plan} plan, billing cycle: ${new Date(result.billing_cycle_start).toLocaleDateString('en-GB')}`);
      loadUsers();
    } catch (err) { alert('Sync failed: ' + err.message); }
  }

  function startEdit(user) { setEditingId(user.id); setEditPlan(user.plan || 'starter'); setEditQuota(user.quota || 0); }
  function cancelEdit() { setEditingId(null); }

  async function savePlan(userId) {
    setSaving(true);
    try {
      const result = await apiFetch('/admin/users/' + userId + '/plan', { method: 'PUT', body: JSON.stringify({ plan: editPlan, monthlyQuota: parseInt(editQuota) || 0 }) });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: result.plan, planLabel: result.planLabel, quota: result.quota, used: result.used, remaining: result.remaining } : u));
      setEditingId(null); showMsg('Plan updated');
    } catch (err) { alert('Failed: ' + err.message); } finally { setSaving(false); }
  }

  function handlePlanChange(value) { setEditPlan(value); const p = PLAN_OPTIONS.find(p => p.value === value); if (p) setEditQuota(p.quota); }

  const planBadge = (plan) => {
    const s = { starter: { bg: t.surfaceHover, color: t.textMuted, label: 'PAYG' }, professional: { bg: t.warningBg, color: t.warning, label: 'Pro' }, premium: { bg: 'rgba(124,58,237,0.1)', color: '#A78BFA', label: 'Premium' }, custom: { bg: t.goldBg, color: t.gold, label: 'Custom' } }[plan] || { bg: t.surfaceHover, color: t.textMuted, label: 'PAYG' };
    return <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{s.label}</span>;
  };

  const inputStyle = { padding: '9px 12px', borderRadius: 8, fontSize: 13, background: t.inputBg || t.surface, border: '1px solid ' + t.border, color: t.text, outline: 'none', width: '100%' };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>Loading clients...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Reset Password Modal */}
      {showResetModal && resetTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: 28, width: 360, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: t.text, margin: '0 0 6px' }}>🔑 Reset Password</h3>
            <p style={{ fontSize: 13, color: t.textMuted, margin: '0 0 18px', lineHeight: 1.5 }}>
              Setting a new password for <strong style={{ color: t.text }}>{resetTarget.fullName || resetTarget.email}</strong>. They will be prompted to change it on next login.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: t.textMuted, display: 'block', marginBottom: 4 }}>New Password</label>
              <input
                type="text"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, background: t.inputBg || t.surface, border: '1px solid ' + t.border, color: t.text, outline: 'none', boxSizing: 'border-box' }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={confirmResetPassword}
                disabled={resetting}
                style={{ flex: 1, padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: t.accent || '#F59E0B', color: '#0F172A', border: 'none', cursor: 'pointer', opacity: resetting ? 0.6 : 1 }}
              >
                {resetting ? 'Saving...' : 'Reset Password'}
              </button>
              <button
                onClick={() => { setShowResetModal(false); setResetTarget(null); }}
                style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, background: 'transparent', color: t.textMuted, border: '1px solid ' + t.border, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {actionMsg && <div style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: actionMsg.type === 'success' ? (t.successBg || 'rgba(16,185,129,0.1)') : 'rgba(239,68,68,0.1)', color: actionMsg.type === 'success' ? (t.success || '#10B981') : '#EF4444', border: '1px solid ' + (actionMsg.type === 'success' ? (t.success || '#10B981') + '30' : '#EF444430') }}>{actionMsg.type === 'success' ? '✅' : '❌'} {actionMsg.text}</div>}

      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, overflow: 'hidden', boxShadow: t.shadowSm }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid ' + t.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: 0 }}>Client Plans & Usage</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: t.textMuted }}>{users.length} clients</span>
            <button onClick={() => setShowAddForm(!showAddForm)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: showAddForm ? t.surfaceHover : (t.accent || '#F59E0B'), color: showAddForm ? t.textSecondary : '#fff', border: showAddForm ? '1px solid ' + t.border : 'none', cursor: 'pointer' }}>{showAddForm ? '✕ Cancel' : '+ Add Client'}</button>
          </div>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddUser} style={{ padding: '16px 20px', borderBottom: '1px solid ' + t.border, background: t.surfaceHover || t.surface }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: t.textMuted, display: 'block', marginBottom: 4 }}>Full Name *</label><input style={inputStyle} placeholder="e.g. John Smith" value={addForm.fullName} onChange={e => setAddForm(p => ({ ...p, fullName: e.target.value }))} /></div>
              <div><label style={{ fontSize: 11, color: t.textMuted, display: 'block', marginBottom: 4 }}>Email *</label><input style={inputStyle} type="email" placeholder="john@example.com" value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label style={{ fontSize: 11, color: t.textMuted, display: 'block', marginBottom: 4 }}>Company</label><input style={inputStyle} placeholder="Company name" value={addForm.company} onChange={e => setAddForm(p => ({ ...p, company: e.target.value }))} /></div>
              <div><label style={{ fontSize: 11, color: t.textMuted, display: 'block', marginBottom: 4 }}>Phone</label><input style={inputStyle} placeholder="+44 7..." value={addForm.phone} onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))} /></div>
            </div>
            <p style={{ fontSize: 12, color: t.textMuted, margin: '0 0 10px', lineHeight: 1.4 }}>They'll receive an email to set up their password and access the portal.</p>
            {addError && <div style={{ fontSize: 12, color: '#EF4444', marginBottom: 8 }}>{addError}</div>}
            <button type="submit" disabled={adding} style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: t.accent || '#F59E0B', color: '#fff', border: 'none', cursor: 'pointer', opacity: adding ? 0.6 : 1 }}>{adding ? 'Creating & Sending Invite...' : 'Create User & Send Invite'}</button>
          </form>
        )}

        {users.map((user, i) => {
          const isEditing = editingId === user.id;
          const isDeleting = confirmDelete === user.id;
          const pct = user.quota > 0 ? Math.min(100, (user.used / user.quota) * 100) : 0;
          const barColor = user.atLimit ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#10B981';
          return (
            <div key={user.id} style={{ padding: '16px 20px', borderBottom: i < users.length - 1 ? '1px solid ' + t.border : 'none', background: isEditing ? (t.surfaceHover || t.surface) : isDeleting ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
              {isDeleting && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginBottom: 10, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <span style={{ fontSize: 13, color: '#EF4444' }}>⚠️ Delete <strong>{user.fullName || user.email}</strong>?</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => handleDelete(user.id)} disabled={deleting} style={{ padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: '#EF4444', color: '#fff', border: 'none', cursor: 'pointer' }}>{deleting ? '...' : 'Yes, Delete'}</button>
                    <button onClick={() => setConfirmDelete(null)} style={{ padding: '5px 14px', borderRadius: 6, fontSize: 11, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: t.accentGlow, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: t.accentLight, flexShrink: 0 }}>{(user.fullName || '?')[0].toUpperCase()}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{user.fullName}</div>
                    <div style={{ fontSize: 12, color: t.textMuted }}>{user.email}</div>
                    {user.company && <div style={{ fontSize: 11, color: t.textDim }}>{user.company}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 260 }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <select value={editPlan} onChange={e => handlePlanChange(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 12, background: t.inputBg || t.surface, border: '1px solid ' + t.border, color: t.text }}>{PLAN_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
                      <input type="number" value={editQuota} onChange={e => setEditQuota(e.target.value)} style={{ width: 60, padding: '6px 8px', borderRadius: 6, fontSize: 12, background: t.inputBg || t.surface, border: '1px solid ' + t.border, color: t.text, textAlign: 'center' }} /><span style={{ fontSize: 11, color: t.textMuted }}>/mo</span>
                    </div>
                  ) : (
                    <>{planBadge(user.plan)}{user.quota > 0 ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}><div style={{ flex: 1, height: 6, borderRadius: 4, background: t.surfaceHover, overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', borderRadius: 4, background: barColor }} /></div><span style={{ fontSize: 11, color: t.textMuted, whiteSpace: 'nowrap' }}>{user.used}/{user.quota}</span></div> : <span style={{ fontSize: 11, color: t.textMuted }}>{user.used || 0} projects this month</span>}</>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {isEditing ? (
                    <><button onClick={() => savePlan(user.id)} disabled={saving} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: t.success, color: '#fff', border: 'none', cursor: 'pointer' }}>{saving ? '...' : 'Save'}</button><button onClick={cancelEdit} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>Cancel</button></>
                  ) : (
                    <><button onClick={() => startEdit(user)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>✏️ Plan</button><button onClick={() => handleResetPassword(user)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>🔑 Reset</button><button onClick={() => handleSendMagicLink(user)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(37,99,235,0.08)', color: '#60A5FA', border: '1px solid rgba(37,99,235,0.2)', cursor: 'pointer' }}>✉️ Link</button><button onClick={() => handleSyncStripe(user)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(124,58,237,0.08)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.2)', cursor: 'pointer' }} title="Sync plan & billing cycle from Stripe">Sync</button><button onClick={() => setConfirmDelete(user.id)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.06)', color: '#F87171', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer' }}>🗑️</button></>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// RATES TAB — COLLAPSIBLE TRADE ACCORDION
// ═══════════════════════════════════════════════════

function RatesTab({ t }) {
  const [libraries, setLibraries] = useState([]);
  const [rates, setRates] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingRates, setLoadingRates] = useState(false);
  const [selectedLib, setSelectedLib] = useState('');
  const [search, setSearch] = useState('');
  const [openTrades, setOpenTrades] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addData, setAddData] = useState({ code: '', trade: '', description: '', unit: '', labour_rate: '', material_rate: '', notes: '' });
  const [addError, setAddError] = useState('');
  const [msg, setMsg] = useState(null);

  function flash(text, type) { setMsg({ text, type: type || 'success' }); setTimeout(() => setMsg(null), 3500); }

  useEffect(() => {
    apiFetch('/admin/rate-libraries').then(libs => { setLibraries(libs); if (libs.length > 0) setSelectedLib(libs[0].id); }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const loadRates = useCallback(() => {
    if (!selectedLib) return;
    setLoadingRates(true);
    const params = new URLSearchParams({ library_id: selectedLib, page: 1, limit: 9999 });
    if (search) params.set('search', search);
    apiFetch('/admin/rates?' + params).then(data => {
      setRates(data.rates || []);
      setTrades(data.trades || []);
    }).catch(console.error).finally(() => setLoadingRates(false));
  }, [selectedLib, search]);

  useEffect(() => { loadRates(); }, [loadRates]);

  function toggleTrade(trade) { setOpenTrades(prev => ({ ...prev, [trade]: !prev[trade] })); }
  function expandAll() { const all = {}; trades.forEach(tr => { all[tr] = true; }); setOpenTrades(all); }
  function collapseAll() { setOpenTrades({}); }

  const grouped = {};
  rates.forEach(r => { if (!grouped[r.trade]) grouped[r.trade] = []; grouped[r.trade].push(r); });
  const tradeKeys = Object.keys(grouped).sort();

  function startEdit(rate) { setEditingId(rate.id); setEditData({ code: rate.code, trade: rate.trade, description: rate.description, unit: rate.unit, labour_rate: rate.labour_rate, material_rate: rate.material_rate, notes: rate.notes || '' }); }
  async function saveEdit(id) { setSaving(true); try { const u = await apiFetch('/admin/rates/' + id, { method: 'PUT', body: JSON.stringify(editData) }); setRates(prev => prev.map(r => r.id === id ? { ...r, ...u } : r)); setEditingId(null); flash('Rate updated'); } catch (err) { alert('Save failed: ' + err.message); } finally { setSaving(false); } }
  async function deleteRate(id) { if (!window.confirm('Delete this rate?')) return; try { await apiFetch('/admin/rates/' + id, { method: 'DELETE' }); setRates(prev => prev.filter(r => r.id !== id)); flash('Rate deleted'); } catch (err) { alert('Delete failed: ' + err.message); } }
  async function handleAddRate() {
    setAddError(''); if (!addData.code || !addData.trade || !addData.description || !addData.unit) { setAddError('Code, trade, description and unit required'); return; }
    try { const nr = await apiFetch('/admin/rates', { method: 'POST', body: JSON.stringify({ ...addData, library_id: selectedLib }) }); setRates(prev => [nr, ...prev]); setShowAdd(false); setAddData({ code: '', trade: '', description: '', unit: '', labour_rate: '', material_rate: '', notes: '' }); flash('Rate added'); } catch (err) { setAddError(err.message); }
  }
  async function handleExport() {
    try { const data = await apiFetch('/admin/rates/export/' + selectedLib); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'rate-library-export.json'; a.click(); URL.revokeObjectURL(url); flash('Exported ' + data.count + ' rates'); } catch (err) { alert('Export failed: ' + err.message); }
  }
  function handleImport() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => { const file = e.target.files[0]; if (!file) return; try { const text = await file.text(); const parsed = JSON.parse(text); const arr = parsed.rates || parsed; if (!Array.isArray(arr)) { alert('Invalid format'); return; } const result = await apiFetch('/admin/rates/import', { method: 'POST', body: JSON.stringify({ library_id: selectedLib, rates: arr }) }); flash('Imported ' + result.imported + ' rates'); loadRates(); } catch (err) { alert('Import failed: ' + err.message); } };
    input.click();
  }

  const iS = { padding: '7px 10px', borderRadius: 6, fontSize: 12, background: t.inputBg || t.surface, border: '1px solid ' + t.border, color: t.text, outline: 'none' };
  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>Loading rate libraries...</div>;
  const selLib = libraries.find(l => l.id === selectedLib);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {msg && <div style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: msg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: msg.type === 'success' ? '#10B981' : '#EF4444' }}>{msg.type === 'success' ? '✅' : '❌'} {msg.text}</div>}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: '16px 20px', boxShadow: t.shadowSm }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📚</span>
            <select value={selectedLib} onChange={e => { setSelectedLib(e.target.value); }} style={{ ...iS, fontSize: 13, fontWeight: 600, minWidth: 200 }}>{libraries.map(lib => <option key={lib.id} value={lib.id}>{lib.name} ({lib.item_count} items)</option>)}</select>
            {selLib && <span style={{ fontSize: 11, color: t.textMuted }}>{selLib.version} • {selLib.region}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleExport} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 11, fontWeight: 600, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>📥 Export</button>
            <button onClick={handleImport} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 11, fontWeight: 600, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>📤 Import</button>
            <button onClick={() => setShowAdd(!showAdd)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 11, fontWeight: 600, background: showAdd ? t.surfaceHover : (t.accent || '#F59E0B'), color: showAdd ? t.textSecondary : '#fff', border: showAdd ? '1px solid ' + t.border : 'none', cursor: 'pointer' }}>{showAdd ? '✕ Cancel' : '+ Add Rate'}</button>
          </div>
        </div>
      </div>
      {showAdd && (
        <div style={{ background: t.card, border: '1px solid ' + (t.accent || '#F59E0B') + '40', borderRadius: 14, padding: '16px 20px' }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: t.text, margin: '0 0 12px' }}>Add New Rate</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 160px 60px 90px 90px', gap: 8, alignItems: 'end' }}>
            <div><label style={{ fontSize: 10, color: t.textMuted, display: 'block', marginBottom: 3 }}>Code</label><input style={{ ...iS, width: '100%' }} placeholder="GW-039" value={addData.code} onChange={e => setAddData(p => ({ ...p, code: e.target.value }))} /></div>
            <div><label style={{ fontSize: 10, color: t.textMuted, display: 'block', marginBottom: 3 }}>Description</label><input style={{ ...iS, width: '100%' }} placeholder="Description..." value={addData.description} onChange={e => setAddData(p => ({ ...p, description: e.target.value }))} /></div>
            <div><label style={{ fontSize: 10, color: t.textMuted, display: 'block', marginBottom: 3 }}>Trade</label><select style={{ ...iS, width: '100%' }} value={addData.trade} onChange={e => setAddData(p => ({ ...p, trade: e.target.value }))}><option value="">Select...</option>{trades.map(tr => <option key={tr} value={tr}>{tr}</option>)}</select></div>
            <div><label style={{ fontSize: 10, color: t.textMuted, display: 'block', marginBottom: 3 }}>Unit</label><input style={{ ...iS, width: '100%' }} placeholder="m²" value={addData.unit} onChange={e => setAddData(p => ({ ...p, unit: e.target.value }))} /></div>
            <div><label style={{ fontSize: 10, color: t.textMuted, display: 'block', marginBottom: 3 }}>Labour £</label><input style={{ ...iS, width: '100%' }} type="number" step="0.01" placeholder="0.00" value={addData.labour_rate} onChange={e => setAddData(p => ({ ...p, labour_rate: e.target.value }))} /></div>
            <div><label style={{ fontSize: 10, color: t.textMuted, display: 'block', marginBottom: 3 }}>Material £</label><input style={{ ...iS, width: '100%' }} type="number" step="0.01" placeholder="0.00" value={addData.material_rate} onChange={e => setAddData(p => ({ ...p, material_rate: e.target.value }))} /></div>
          </div>
          {addError && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 6 }}>⚠️ {addError}</div>}
          <button onClick={handleAddRate} style={{ marginTop: 10, padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: t.accent || '#F59E0B', color: '#fff', border: 'none', cursor: 'pointer' }}>Add Rate</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ ...iS, flex: 1, minWidth: 200, fontSize: 13, padding: '9px 14px' }} placeholder="🔍  Search rates..." value={search} onChange={e => setSearch(e.target.value)} />
        <span style={{ fontSize: 12, color: t.textMuted }}>{rates.length} rates across {tradeKeys.length} trades</span>
        <button onClick={expandAll} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>Expand All</button>
        <button onClick={collapseAll} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>Collapse All</button>
      </div>
      {loadingRates ? <div style={{ padding: 30, textAlign: 'center', color: t.textMuted }}>Loading rates...</div> : tradeKeys.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: t.textMuted }}>No rates found</div> : tradeKeys.map(trade => {
        const tradeRates = grouped[trade];
        const isOpen = openTrades[trade];
        return (
          <div key={trade} style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, overflow: 'hidden', boxShadow: t.shadowSm }}>
            <div onClick={() => toggleTrade(trade)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', background: isOpen ? (t.surfaceHover || t.surface) : 'transparent', transition: 'background 0.15s', userSelect: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{trade}</span>
                <span style={{ fontSize: 11, color: t.textMuted, background: t.surfaceHover, padding: '2px 8px', borderRadius: 10 }}>{tradeRates.length} items</span>
              </div>
              <span style={{ fontSize: 11, color: t.textDim }}>£{tradeRates.reduce((sum, r) => sum + (r.total_rate || 0), 0).toFixed(0)} total value</span>
            </div>
            {isOpen && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 55px 80px 80px 90px 60px', padding: '8px 20px', borderTop: '1px solid ' + t.border, borderBottom: '1px solid ' + t.border, background: t.surfaceHover || t.surface }}>
                  {['Code', 'Description', 'Unit', 'Labour', 'Material', 'Total', ''].map((h, i) => <span key={i} style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>)}
                </div>
                {tradeRates.map((rate, i) => {
                  const isE = editingId === rate.id;
                  return (
                    <div key={rate.id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 55px 80px 80px 90px 60px', padding: '9px 20px', alignItems: 'center', borderBottom: i < tradeRates.length - 1 ? '1px solid ' + t.border : 'none', background: isE ? (t.surfaceHover || t.surface) : 'transparent' }}>
                      {isE ? (<>
                        <input style={{ ...iS, width: 70 }} value={editData.code} onChange={e => setEditData(p => ({ ...p, code: e.target.value }))} />
                        <input style={{ ...iS, width: '100%' }} value={editData.description} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))} />
                        <input style={{ ...iS, width: 45 }} value={editData.unit} onChange={e => setEditData(p => ({ ...p, unit: e.target.value }))} />
                        <input style={{ ...iS, width: 70 }} type="number" step="0.01" value={editData.labour_rate} onChange={e => setEditData(p => ({ ...p, labour_rate: e.target.value }))} />
                        <input style={{ ...iS, width: 70 }} type="number" step="0.01" value={editData.material_rate} onChange={e => setEditData(p => ({ ...p, material_rate: e.target.value }))} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: t.accent || '#F59E0B', fontFamily: 'monospace' }}>£{((parseFloat(editData.labour_rate) || 0) + (parseFloat(editData.material_rate) || 0)).toFixed(2)}</span>
                        <div style={{ display: 'flex', gap: 3 }}><button onClick={() => saveEdit(rate.id)} disabled={saving} style={{ padding: '4px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: t.success || '#10B981', color: '#fff', border: 'none', cursor: 'pointer' }}>{saving ? '..' : '✓'}</button><button onClick={() => setEditingId(null)} style={{ padding: '4px 8px', borderRadius: 5, fontSize: 10, background: t.surfaceHover, color: t.textMuted, border: '1px solid ' + t.border, cursor: 'pointer' }}>✕</button></div>
                      </>) : (<>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: t.accent || '#F59E0B', fontWeight: 600 }}>{rate.code}</span>
                        <div><span style={{ fontSize: 12, color: t.text }}>{rate.description}</span>{rate.notes && <span style={{ fontSize: 10, color: t.textDim, marginLeft: 6 }}>({rate.notes})</span>}</div>
                        <span style={{ fontSize: 11, color: t.textMuted }}>{rate.unit}</span>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: t.textSecondary }}>£{(rate.labour_rate || 0).toFixed(2)}</span>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: t.textSecondary }}>£{(rate.material_rate || 0).toFixed(2)}</span>
                        <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: t.text }}>£{(rate.total_rate || 0).toFixed(2)}</span>
                        <div style={{ display: 'flex', gap: 3 }}><button onClick={() => startEdit(rate)} style={{ padding: '4px 8px', borderRadius: 5, fontSize: 10, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>✏️</button><button onClick={() => deleteRate(rate.id)} style={{ padding: '4px 8px', borderRadius: 5, fontSize: 10, background: 'rgba(239,68,68,0.06)', color: '#F87171', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer' }}>🗑️</button></div>
                      </>)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// ACTIVITY LOG TAB
// ═══════════════════════════════════════════════════

function LogsTab({ t }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => { loadActivity(); }, [filter]);

  function loadActivity() {
    setLoading(true);
    const params = new URLSearchParams({ limit: 100 });
    if (filter) params.set('type', filter);
    apiFetch('/admin/activity?' + params)
      .then(data => { setActivities(data.activities || []); setTotal(data.total || 0); })
      .catch(err => { console.error('Failed to load activity:', err); setActivities([]); })
      .finally(() => setLoading(false));
  }

  const eventStyles = {
    signup: { icon: '👤', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
    login: { icon: '🔑', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
    project_created: { icon: '📋', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    project_completed: { icon: '✅', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
    plan_changed: { icon: '💳', color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)' },
    file_uploaded: { icon: '📎', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
    boq_generated: { icon: '📊', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
    error: { icon: '❌', color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  };
  const defaultStyle = { icon: 'ℹ️', color: '#94A3B8', bg: 'rgba(148,163,184,0.1)' };

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, background: t.inputBg || t.surface, border: '1px solid ' + t.border, color: t.text, minWidth: 160 }}>
          <option value="">All Events ({total})</option>
          <option value="signup">Signups</option>
          <option value="project_created">Project Submissions</option>
          <option value="project_completed">Completions</option>
          <option value="login">Logins</option>
          <option value="plan_changed">Plan Changes</option>
          <option value="error">Errors</option>
        </select>
        <button onClick={loadActivity} style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer' }}>🔄 Refresh</button>
        <span style={{ fontSize: 12, color: t.textMuted }}>{activities.length} events</span>
      </div>
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, overflow: 'hidden', boxShadow: t.shadowSm }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid ' + t.border }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: 0 }}>Activity Log</h3>
          <p style={{ fontSize: 12, color: t.textMuted, margin: '4px 0 0' }}>Real-time tracking of signups, projects, and system events</p>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: t.textMuted }}>Loading activity...</div>
        ) : activities.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, color: t.textMuted }}>No activity yet</div>
            <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>Events will appear here when users sign up or submit projects</div>
          </div>
        ) : activities.map((item, i) => {
          const style = eventStyles[item.event_type] || defaultStyle;
          return (
            <div key={item.id} style={{ display: 'flex', gap: 14, padding: '14px 20px', borderBottom: i < activities.length - 1 ? '1px solid ' + t.border : 'none', alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: style.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15 }}>{style.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{item.title}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: style.bg, color: style.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{item.event_type.replace(/_/g, ' ')}</span>
                </div>
                {item.detail && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}>{item.detail}</div>}
                {item.user_name && <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>by {item.user_name} ({item.user_email})</div>}
              </div>
              <span style={{ fontSize: 11, color: t.textDim, whiteSpace: 'nowrap', flexShrink: 0 }}>{timeAgo(item.created_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════

function SettingsTab({ t }) {
  const sections = [
    { title: 'API Configuration', items: [{ label: 'Anthropic API Key', value: 'sk-...7xQ4', type: 'secret' }, { label: 'Pipedream Webhook URL', value: 'https://eo...pipedream.net/...', type: 'url' }, { label: 'Google Drive Folder ID', value: '1abc...xyz', type: 'text' }] },
    { title: 'Processing Defaults', items: [{ label: 'Default Rate Library', value: 'UK Master Rates v4.0' }, { label: 'Location Factor Auto-Adjust', value: 'Enabled' }, { label: 'QA Review Required', value: 'Enabled' }, { label: 'Auto-Email BOQ on Complete', value: 'Disabled' }] },
    { title: 'Branding', items: [{ label: 'Company Name', value: 'CRM Wizard AI' }, { label: 'Report Header Logo', value: 'crm-wizard-logo.png' }, { label: 'BOQ Excel Template', value: 'Dark navy + light blue style' }] },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map((section, i) => (
        <div key={i} style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: 20, boxShadow: t.shadowSm }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: '0 0 14px' }}>{section.title}</h3>
          {section.items.map((item, j) => (
            <div key={j} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: j < section.items.length - 1 ? '1px solid ' + t.border : 'none' }}>
              <span style={{ fontSize: 13, color: t.textSecondary }}>{item.label}</span>
              <span style={{ fontSize: 13, color: t.text, fontWeight: 500, fontFamily: 'monospace', background: t.surfaceHover, padding: '4px 10px', borderRadius: 6 }}>{item.type === 'secret' ? '••••••••' + item.value.slice(-4) : item.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MAIN ADMIN PAGE
// ═══════════════════════════════════════════════════

export default function AdminPage() {
  const { t } = useTheme();
  const [tab, setTab] = useState('overview');
  const tabs = [{ key: 'overview', label: '📊 Overview' }, { key: 'clients', label: '👥 Clients' }, { key: 'rates', label: '📚 Rate Libraries' }, { key: 'logs', label: '📋 Activity Log' }, { key: 'settings', label: '⚙️ Settings' }];

  return (
    <div style={{ padding: '28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: t.text, margin: 0 }}>Admin Panel</h1>
        <p style={{ fontSize: 13, color: t.textMuted, margin: '4px 0 0' }}>System configuration, rate management, and monitoring</p>
      </div>
      <div style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 24, background: t.surface, borderRadius: 12, border: '1px solid ' + t.border, overflowX: 'auto' }}>
        {tabs.map(tb => <button key={tb.key} onClick={() => setTab(tb.key)} style={{ flex: 1, padding: '10px 14px', borderRadius: 9, background: tab === tb.key ? t.card : 'transparent', color: tab === tb.key ? t.text : t.textMuted, border: tab === tb.key ? '1px solid ' + t.border : '1px solid transparent', cursor: 'pointer', fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, boxShadow: tab === tb.key ? t.shadowSm : 'none', whiteSpace: 'nowrap' }}>{tb.label}</button>)}
      </div>
      {tab === 'overview' && <OverviewTab t={t} />}
      {tab === 'clients' && <ClientsTab t={t} />}
      {tab === 'rates' && <RatesTab t={t} />}
      {tab === 'logs' && <LogsTab t={t} />}
      {tab === 'settings' && <SettingsTab t={t} />}
    </div>
  );
}
