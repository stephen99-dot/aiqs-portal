import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Trash2, Shield, Search, X, Upload, Pause, Play, CreditCard, ChevronDown, Link2, Activity, Save, Key } from 'lucide-react';

const API_BASE = '/api';
function getToken() { return localStorage.getItem('aiqs_token'); }
function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const h = { 'Authorization': 'Bearer ' + token, ...options.headers };
  if (!(options.body instanceof FormData)) h['Content-Type'] = 'application/json';
  return fetch(API_BASE + endpoint, { ...options, headers: h })
    .then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Request failed'); return data; });
}

function AddUserModal({ isOpen, onClose, onUserAdded, isDark }) {
  const [form, setForm] = useState({ email: '', fullName: '', company: '', phone: '', role: 'client' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  if (!isOpen) return null;
  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setResult(''); setLoading(true);
    try {
      const data = await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify({ ...form, sendInvite: true }) });
      onUserAdded(data.user || data);
      if (data.emailSent) setResult('Invite emailed to ' + form.email);
      else if (data.magicUrl) { await navigator.clipboard.writeText(data.magicUrl).catch(()=>{}); setResult('User created — invite link copied to clipboard'); }
      setForm({ email:'',fullName:'',company:'',phone:'',role:'client' });
      setTimeout(() => { setResult(''); onClose(); }, 2000);
    }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const inp = { width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:isDark?'#0D1320':'#F8FAFC',color:isDark?'#E8EDF5':'#0F172A',fontSize:14,outline:'none',boxSizing:'border-box' };
  const lbl = { display:'block',fontSize:11,fontWeight:600,color:isDark?'#94A3B8':'#64748B',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.05em' };
  return (
    <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:isDark?'#131B2E':'#FFF',borderRadius:16,padding:28,width:'100%',maxWidth:460,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0')}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:isDark?'#E8EDF5':'#0F172A'}}><UserPlus size={20} style={{color:'#2563EB',verticalAlign:'middle',marginRight:8}} />Add User</h2>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:isDark?'#5A6E87':'#94A3B8'}}><X size={18} /></button>
        </div>
        {error && <div style={{background:'rgba(239,68,68,0.1)',borderRadius:8,padding:'8px 12px',marginBottom:14,color:'#EF4444',fontSize:13}}>{error}</div>}
        {result && <div style={{background:'rgba(16,185,129,0.1)',borderRadius:8,padding:'8px 12px',marginBottom:14,color:'#10B981',fontSize:13}}>{result}</div>}
        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:12}}>
          {[{k:'fullName',l:'Full Name',r:true,p:'Paul Richards'},{k:'email',l:'Email',r:true,t:'email',p:'paul@company.com'},{k:'company',l:'Company',p:'Penn Contracting'},{k:'phone',l:'Phone',p:'+44 7xxx xxx xxx'}].map(({k,l,r,t,p}) => (
            <div key={k}><label style={lbl}>{l}{r&&<span style={{color:'#EF4444'}}> *</span>}</label><input type={t||'text'} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} required={r} placeholder={p} style={inp} /></div>
          ))}
          <div style={{display:'flex',gap:10,marginTop:6}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:'transparent',color:isDark?'#94A3B8':'#64748B',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancel</button>
            <button type="submit" disabled={loading} style={{flex:1,padding:11,borderRadius:10,border:'none',background:'#2563EB',color:'#FFF',fontSize:13,fontWeight:600,cursor:'pointer',opacity:loading?0.7:1}}>{loading?'Creating & Sending Invite...':'Create & Send Invite'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, isDark, onClose, onSuccess }) {
  const [password, setPassword] = useState('Welcome123!');
  const [saving, setSaving] = useState(false);
  const border = isDark ? '#1C2A44' : '#E2E8F0';
  const text = isDark ? '#E8EDF5' : '#0F172A';
  const muted = isDark ? '#5A6E87' : '#94A3B8';
  const handleReset = async () => {
    if (!password || password.length < 6) { alert('Password must be at least 6 characters'); return; }
    setSaving(true);
    try {
      await apiFetch('/admin/users/' + user.id + '/password', { method: 'PUT', body: JSON.stringify({ password }) });
      onSuccess('Password reset for ' + (user.full_name || user.email));
      onClose();
    } catch (err) { alert('Failed: ' + err.message); } finally { setSaving(false); }
  };
  return (
    <div style={{position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:isDark?'#131B2E':'#FFF',borderRadius:16,padding:28,width:'100%',maxWidth:400,border:'1px solid '+border}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <h3 style={{margin:0,fontSize:16,fontWeight:700,color:text}}>🔑 Reset Password</h3>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:muted}}><X size={16} /></button>
        </div>
        <p style={{fontSize:13,color:muted,margin:'0 0 16px',lineHeight:1.5}}>
          Setting a new password for <strong style={{color:text}}>{user.full_name || user.email}</strong>. They will be prompted to choose a new one on next login.
        </p>
        <div style={{marginBottom:16}}>
          <label style={{display:'block',fontSize:11,fontWeight:600,color:muted,marginBottom:5,textTransform:'uppercase',letterSpacing:'0.05em'}}>New Password</label>
          <input type="text" value={password} onChange={e=>setPassword(e.target.value)} autoFocus
            style={{width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid '+border,background:isDark?'#0D1320':'#F8FAFC',color:text,fontSize:14,outline:'none',boxSizing:'border-box'}} />
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={handleReset} disabled={saving} style={{flex:1,padding:11,borderRadius:10,border:'none',background:'#F59E0B',color:'#0F172A',fontSize:13,fontWeight:700,cursor:'pointer',opacity:saving?0.6:1}}>
            {saving ? 'Resetting...' : 'Reset Password'}
          </button>
          <button onClick={onClose} style={{padding:'11px 18px',borderRadius:10,border:'1px solid '+border,background:'transparent',color:muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function UserActionPanel({ user, isDark, onUpdate, onClose }) {
  const [loading, setLoading] = useState('');
  const [plan, setPlan] = useState(user.plan || 'starter');
  const [msgAllowance, setMsgAllowance] = useState(user.monthly_quota || user.quota || 0);
  const [docAllowance, setDocAllowance] = useState(user.monthly_boq_quota || user.boq_quota || 0);
  const [suspendReason, setSuspendReason] = useState(user.suspended_reason || '');
  const [magicLink, setMagicLink] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = React.useRef(null);

  const border = isDark ? '#1C2A44' : '#E2E8F0';
  const text = isDark ? '#E8EDF5' : '#0F172A';
  const muted = isDark ? '#5A6E87' : '#94A3B8';
  const bg2 = isDark ? '#131B2E' : '#FFF';

  const PLANS = [
    { value: 'starter', label: 'Starter', msgs: 1, docs: 0 },
    { value: 'professional', label: 'Professional', msgs: 100, docs: 10 },
    { value: 'premium', label: 'Premium', msgs: 200, docs: 20 },
    { value: 'custom', label: 'Custom', msgs: null, docs: null },
  ];

  const btn = (c) => ({ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: c, color: '#FFF', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: loading ? 0.6 : 1 });
  const outBtn = { padding: '7px 14px', borderRadius: 8, border: '1px solid ' + border, cursor: 'pointer', background: 'transparent', color: text, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 };
  const lbl = { fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };
  const sInp = { padding: '7px 10px', borderRadius: 6, border: '1px solid ' + border, background: isDark ? '#0D1320' : '#F8FAFC', color: text, fontSize: 13, outline: 'none' };

  const [errorMsg, setErrorMsg] = useState('');
  const doAction = async (key, fn) => { setLoading(key); setErrorMsg(''); try { await fn(); } catch (e) { setErrorMsg(e.message || 'Action failed'); } finally { setLoading(''); } };
  function showSuccess(msg) { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 4000); }

  const savePlan = () => doAction('plan', async () => {
    await apiFetch('/admin/users/' + user.id + '/plan', {
      method: 'PUT',
      body: JSON.stringify({ plan, monthlyQuota: parseInt(msgAllowance) || 0, boqQuota: parseInt(docAllowance) || 0 })
    });
    onUpdate({ ...user, plan, monthly_quota: parseInt(msgAllowance) || 0, monthly_boq_quota: parseInt(docAllowance) || 0 });
    showSuccess('Plan updated to ' + plan);
  });

  const saveAllowances = () => doAction('allowances', async () => {
    const msgs = parseInt(msgAllowance) || 0;
    const docs = parseInt(docAllowance) || 0;
    await apiFetch('/admin/users/' + user.id + '/plan', {
      method: 'PUT',
      body: JSON.stringify({ plan, monthlyQuota: msgs, boqQuota: docs })
    });
    onUpdate({ ...user, monthly_quota: msgs, quota: msgs, monthly_boq_quota: docs, boq_quota: docs });
    showSuccess('Allowances updated — ' + msgs + ' messages, ' + docs + ' documents');
  });

  const toggleSuspend = () => doAction('suspend', async () => {
    if (user.suspended) {
      await apiFetch('/admin/unsuspend/' + user.id, { method: 'POST' });
      onUpdate({ ...user, suspended: 0, suspended_reason: null });
      showSuccess('Account reactivated');
    } else {
      await apiFetch('/admin/suspend/' + user.id, { method: 'POST', body: JSON.stringify({ reason: suspendReason || 'Suspended by admin' }) });
      onUpdate({ ...user, suspended: 1, suspended_reason: suspendReason });
      showSuccess('Account suspended');
    }
  });

  const genMagicLink = () => doAction('magic', async () => {
    const res = await apiFetch('/admin/users/' + user.id + '/magic-link', { method: 'POST' });
    setMagicLink(res.magicLink || res.link || res.magicUrl || '');
  });

  const importRates = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    setLoading('import'); setImportResult(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const token = localStorage.getItem('aiqs_token');
      const resp = await fetch((process.env.REACT_APP_API_URL || '') + '/api/admin/import-rates/' + user.id, {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd
      });
      const res = await resp.json();
      setImportResult(res);
    } catch (err) { setImportResult({ error: err.message }); }
    finally { setLoading(''); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const msgsUsed = user.messages_used || user.used || 0;
  const msgsTotal = parseInt(msgAllowance) || user.monthly_quota || user.quota || 0;
  const msgPct = msgsTotal > 0 ? Math.min(100, (msgsUsed / msgsTotal) * 100) : 0;
  const msgBarColor = msgPct >= 90 ? '#EF4444' : msgPct >= 70 ? '#F59E0B' : '#10B981';
  const boqUsed = user.boq_used || user.docs_used || 0;
  const boqTotal = parseInt(docAllowance) || user.monthly_boq_quota || user.boq_quota || 0;
  const boqPct = boqTotal > 0 ? Math.min(100, (boqUsed / boqTotal) * 100) : 0;
  const boqBarColor = boqPct >= 90 ? '#EF4444' : boqPct >= 70 ? '#F59E0B' : '#10B981';

  return (
    <>
      {showResetModal && (
        <ResetPasswordModal user={user} isDark={isDark} onClose={() => setShowResetModal(false)} onSuccess={showSuccess} />
      )}
      <div style={{ background: isDark ? '#0D1320' : '#F8FAFC', borderTop: '1px solid ' + border, padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: text }}>Manage: {user.full_name || user.email}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted }}><X size={16} /></button>
        </div>

        {successMsg && (
          <div style={{ marginBottom: 12, padding: '9px 14px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10B981', fontSize: 13, fontWeight: 500 }}>
            {successMsg}
          </div>
        )}

        {errorMsg && (
          <div style={{ marginBottom: 12, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444', fontSize: 13, fontWeight: 500 }}>
            {errorMsg}
          </div>
        )}

        {/* Usage bars */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Messages This Month', used: msgsUsed, total: msgsTotal, pct: msgPct, color: msgBarColor },
            { label: 'Documents This Month', used: boqUsed, total: boqTotal, pct: boqPct, color: boqBarColor },
          ].map(({ label, used, total, pct, color }) => (
            <div key={label} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid ' + border, background: bg2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: total > 0 && pct >= 90 ? '#EF4444' : text }}>{used} / {total > 0 ? total : '—'}</span>
              </div>
              {total > 0 ? (
                <div style={{ height: 6, borderRadius: 4, background: isDark ? '#1C2A44' : '#E2E8F0', overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', borderRadius: 4, background: color, transition: 'width 0.3s' }} />
                </div>
              ) : (
                <div style={{ fontSize: 11, color: muted }}>No allowance set</div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Plan */}
          <div style={{ padding: 14, borderRadius: 10, border: '1px solid ' + border, background: bg2 }}>
            <div style={lbl}>Plan</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {PLANS.map(p => (
                <button key={p.value} onClick={() => { setPlan(p.value); if (p.msgs !== null) setMsgAllowance(p.msgs); if (p.docs !== null) setDocAllowance(p.docs); }}
                  style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: plan === p.value ? '2px solid #2563EB' : '1px solid ' + border,
                    background: plan === p.value ? 'rgba(37,99,235,0.1)' : 'transparent',
                    color: plan === p.value ? '#2563EB' : muted, textTransform: 'capitalize' }}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={savePlan} disabled={!!loading} style={{ ...btn('#2563EB'), marginTop: 10 }}>
              <Save size={12} /> Save Plan
            </button>
          </div>

          {/* Allowances */}
          <div style={{ padding: 14, borderRadius: 10, border: '1px solid ' + border, background: bg2 }}>
            <div style={lbl}>Allowances (this month)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              {[
                { label: 'Messages', val: msgAllowance, set: setMsgAllowance },
                { label: 'Documents / BOQs', val: docAllowance, set: setDocAllowance },
              ].map(({ label, val, set }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: muted, width: 110, flexShrink: 0 }}>{label}</span>
                  <input type="number" min={0} max={9999} value={val} onChange={e => set(e.target.value)}
                    style={{ ...sInp, width: 70, fontSize: 14, fontWeight: 700, textAlign: 'center' }} />
                </div>
              ))}
              <button onClick={saveAllowances} disabled={!!loading} style={{ ...btn('#2563EB'), marginTop: 2 }}>
                <Save size={12} /> Save Allowances
              </button>
            </div>
          </div>

          {/* Suspend */}
          <div style={{ padding: 14, borderRadius: 10, border: '1px solid ' + border, background: bg2 }}>
            <div style={lbl}>{user.suspended ? 'Reactivate Account' : 'Suspend Account'}</div>
            {!user.suspended && (
              <input value={suspendReason} onChange={e => setSuspendReason(e.target.value)}
                placeholder="Reason (optional)"
                style={{ ...sInp, width: '100%', marginTop: 6, marginBottom: 8 }} />
            )}
            <button onClick={toggleSuspend} disabled={!!loading}
              style={user.suspended ? btn('#10B981') : btn('#EF4444')}>
              {user.suspended ? <><Play size={12} /> Reactivate</> : <><Pause size={12} /> Suspend</>}
            </button>
            {user.suspended && user.suspended_reason && (
              <div style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>Reason: {user.suspended_reason}</div>
            )}
          </div>

          {/* Tools */}
          <div style={{ padding: 14, borderRadius: 10, border: '1px solid ' + border, background: bg2 }}>
            <div style={lbl}>Tools</div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={importRates} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <button onClick={genMagicLink} disabled={!!loading} style={outBtn}><Link2 size={12} /> Magic Link</button>
              <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={!!loading} style={outBtn}><Upload size={12} /> Import Rates</button>
              <button onClick={() => setShowResetModal(true)} disabled={!!loading}
                style={{ ...outBtn, color: '#F59E0B', borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.06)' }}>
                <Key size={12} /> Reset Password
              </button>
            </div>
            {magicLink && (
              <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: isDark ? '#0D1320' : '#F1F5F9', fontSize: 11, wordBreak: 'break-all', color: '#2563EB', cursor: 'pointer' }}
                onClick={() => { navigator.clipboard.writeText(magicLink); showSuccess('Magic link copied!'); }}>
                {magicLink}<br /><span style={{ color: muted }}>Click to copy</span>
              </div>
            )}
            {importResult && (
              <div style={{ marginTop: 8, fontSize: 12, color: importResult.error ? '#EF4444' : '#10B981' }}>
                {importResult.error ? 'Error: ' + importResult.error : 'Imported ' + importResult.imported + ' rates' + (importResult.skipped > 0 ? ', skipped ' + importResult.skipped : '')}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

export default function UserManagementPage({ theme }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [roleFilter, setRoleFilter] = useState('all');
  const [expandedUser, setExpandedUser] = useState(null);
  const [tab, setTab] = useState('users');
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const t = theme || {};
  const isDark = t.name === 'dark';

  const fetchUsers = useCallback(async () => {
    try { setLoading(true); const data = await apiFetch('/admin/users'); setUsers(data.users || data || []); setError(''); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const loadActivity = useCallback(async () => {
    if (activity.length > 0) return;
    setActivityLoading(true);
    try {
      const data = await apiFetch('/admin/activity');
      setActivity(data.activities || data.recent || []);
    }
    catch(e) { console.error(e); } finally { setActivityLoading(false); }
  }, [activity.length]);

  useEffect(() => { if (tab === 'activity') loadActivity(); }, [tab, loadActivity]);

  const handleDelete = async (userId) => {
    try { await apiFetch('/admin/users/' + userId, { method: 'DELETE' }); setUsers(prev => prev.filter(u => u.id !== userId)); setDeleteTarget(null); }
    catch (err) { alert('Failed: ' + err.message); }
  };
  const handleUserUpdate = (updated) => { setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u)); };
  const filtered = users.filter(u => {
    const ms = !search || [u.full_name, u.email, u.company].some(f => f && f.toLowerCase().includes(search.toLowerCase()));
    return (roleFilter === 'all' || u.role === roleFilter) && ms;
  });
  const adminCount = users.filter(u => u.role === 'admin').length;
  const clientCount = users.filter(u => u.role === 'client').length;
  const cardStyle = { background: isDark ? '#131B2E' : '#FFF', border: '1px solid ' + (isDark ? '#1C2A44' : '#E2E8F0'), borderRadius: 14, overflow: 'hidden' };
  const muted = isDark ? '#5A6E87' : '#94A3B8';
  const formatDate = (d) => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch(e) { return d; } };

  return (
    <div style={{padding:'28px 32px',maxWidth:1100,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div>
          <h1 style={{margin:0,fontSize:24,fontWeight:800,color:isDark?'#E8EDF5':'#0F172A'}}>User Management</h1>
          <p style={{margin:'4px 0 0',fontSize:13,color:isDark?'#5A6E87':'#94A3B8'}}>{users.length} total | {adminCount} admins | {clientCount} clients</p>
        </div>
        <button onClick={() => setShowAddModal(true)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 18px',borderRadius:10,border:'none',background:'#2563EB',color:'#FFF',fontSize:13,fontWeight:600,cursor:'pointer'}}><UserPlus size={15} /> Add User</button>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:16,background:isDark?'#0D1320':'#F1F5F9',borderRadius:10,padding:3}}>
        {['users','activity'].map(tb => (
          <button key={tb} onClick={() => setTab(tb)} style={{padding:'8px 18px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:tab===tb?(isDark?'#1C2A44':'#FFF'):'transparent',color:tab===tb?(isDark?'#E8EDF5':'#0F172A'):(isDark?'#5A6E87':'#94A3B8'),boxShadow:tab===tb?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>
            {tb === 'users' ? <><Users size={13} style={{verticalAlign:'middle',marginRight:6}} />Users</> : <><Activity size={13} style={{verticalAlign:'middle',marginRight:6}} />Activity Feed</>}
          </button>
        ))}
      </div>

      {/* Activity Tab */}
      {tab === 'activity' && (
        <div style={cardStyle}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid '+(isDark?'#1C2A44':'#E2E8F0')}}>
            <div style={{fontSize:14,fontWeight:600,color:isDark?'#E8EDF5':'#0F172A'}}>Recent Activity</div>
            <div style={{fontSize:12,color:isDark?'#5A6E87':'#94A3B8'}}>All client actions across the platform</div>
          </div>
          {activityLoading ? <div style={{padding:40,textAlign:'center',color:isDark?'#5A6E87':'#94A3B8'}}>Loading...</div> :
          activity.length === 0 ? <div style={{padding:40,textAlign:'center',color:isDark?'#5A6E87':'#94A3B8'}}>No activity yet</div> :
          activity.map((a, i) => {
            const evType = a.event_type || a.action || '';
            const dotColor = evType.includes('boq')||evType.includes('doc')||evType.includes('completed')?'#10B981':evType.includes('login')?'#3B82F6':evType.includes('signup')?'#A855F7':evType.includes('error')?'#EF4444':'#F59E0B';
            return (
            <div key={a.id||i} style={{padding:'10px 20px',borderBottom:'1px solid '+(isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'),display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:8,height:8,borderRadius:'50%',flexShrink:0,background:dotColor}}></div>
                <div>
                  <span style={{fontSize:12,fontWeight:600,color:isDark?'#E8EDF5':'#0F172A'}}>{a.user_name||a.full_name||a.email||'System'}</span>
                  <span style={{fontSize:12,color:isDark?'#5A6E87':'#94A3B8',marginLeft:8}}>{a.title||evType}</span>
                  {a.detail && <span style={{fontSize:11,color:isDark?'#3D4A5C':'#CBD5E1',marginLeft:8}}>{a.detail.substring(0,80)}</span>}
                </div>
              </div>
              <div style={{flexShrink:0}}>
                <span style={{fontSize:11,color:isDark?'#3D4A5C':'#CBD5E1'}}>{formatDate(a.created_at)}</span>
              </div>
            </div>
          );})}
        </div>
      )}

      {/* Users Tab */}
      {tab === 'users' && (<>
        <div style={{display:'flex',gap:12,marginBottom:16}}>
          <div style={{flex:1,display:'flex',alignItems:'center',gap:10,padding:'0 14px',borderRadius:10,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:isDark?'#0D1320':'#F8FAFC'}}>
            <Search size={15} style={{color:muted}} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{flex:1,padding:'10px 0',border:'none',background:'transparent',color:isDark?'#E8EDF5':'#0F172A',fontSize:13,outline:'none'}} />
            {search && <button onClick={() => setSearch('')} style={{background:'none',border:'none',cursor:'pointer',color:muted}}><X size={14} /></button>}
          </div>
          <div style={{display:'flex',gap:3,background:isDark?'#0D1320':'#F1F5F9',borderRadius:10,padding:3}}>
            {['all','admin','client'].map(f => (
              <button key={f} onClick={() => setRoleFilter(f)} style={{padding:'7px 14px',borderRadius:8,border:'none',cursor:'pointer',background:roleFilter===f?'#2563EB':'transparent',color:roleFilter===f?'#FFF':(isDark?'#5A6E87':'#94A3B8'),fontSize:12,fontWeight:600,textTransform:'capitalize'}}>
                {f==='all'?'All ('+users.length+')':f==='admin'?'Admins ('+adminCount+')':'Clients ('+clientCount+')'}
              </button>
            ))}
          </div>
        </div>
        {error && <div style={{background:'rgba(239,68,68,0.1)',borderRadius:10,padding:'12px 16px',marginBottom:16,color:'#EF4444',fontSize:13}}>{error}</div>}
        {loading ? <div style={{textAlign:'center',padding:'50px 0',color:muted}}>Loading...</div> :
         filtered.length === 0 ? <div style={{textAlign:'center',padding:'50px 0',color:muted}}>{search?'No match':'No users'}</div> : (
          <div style={cardStyle}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:isDark?'rgba(37,99,235,0.06)':'#F8FAFC'}}>
                {['User','Company','Plan','Messages','BOQs','Status',''].map(h => (
                  <th key={h} style={{padding:'11px 16px',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:muted,textAlign:h===''?'right':'left',borderBottom:'1px solid '+(isDark?'#1C2A44':'#E2E8F0')}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map((user, i) => {
                  const msgsUsed = user.messages_used || user.used || 0;
                  const msgsTotal = (user.monthly_quota != null ? user.monthly_quota : null) ?? user.quota ?? (user.plan==='premium'?200:user.plan==='professional'?100:user.plan==='starter'?1:0);
                  const msgPct = msgsTotal > 0 ? Math.min(100, (msgsUsed / msgsTotal) * 100) : 0;
                  const msgBarColor = msgPct >= 90 ? '#EF4444' : msgPct >= 70 ? '#F59E0B' : '#10B981';
                  return (
                    <React.Fragment key={user.id}>
                      <tr style={{borderBottom:expandedUser===user.id?'none':(i<filtered.length-1?'1px solid '+(isDark?'#1C2A44':'#F1F5F9'):'none'),cursor:'pointer'}}
                        onClick={() => setExpandedUser(expandedUser===user.id?null:user.id)}
                        onMouseEnter={e => { e.currentTarget.style.background = isDark?'rgba(37,99,235,0.04)':'#FAFBFE'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                        <td style={{padding:'12px 16px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <div style={{width:36,height:36,borderRadius:'50%',background:user.role==='admin'?'linear-gradient(135deg,#2563EB,#7C3AED)':(isDark?'#1C2A44':'#E2E8F0'),display:'flex',alignItems:'center',justifyContent:'center',color:user.role==='admin'?'#FFF':(isDark?'#5A6E87':'#94A3B8'),fontSize:13,fontWeight:700}}>
                              {user.full_name?user.full_name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2):'??'}
                            </div>
                            <div>
                              <div style={{fontSize:13,fontWeight:600,color:isDark?'#E8EDF5':'#0F172A'}}>{user.full_name} {user.role==='admin'&&<Shield size={11} style={{color:'#2563EB'}} />}</div>
                              <div style={{fontSize:11,color:muted}}>{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{padding:'12px 16px',fontSize:12,color:isDark?'#94A3B8':'#64748B'}}>{user.company||'-'}</td>
                        <td style={{padding:'12px 16px'}}>
                          <span style={{padding:'3px 9px',borderRadius:6,fontSize:10,fontWeight:700,textTransform:'uppercase',
                            background:user.role==='admin'?'rgba(37,99,235,0.1)':user.plan==='premium'?'rgba(124,58,237,0.1)':user.plan==='professional'?'rgba(16,185,129,0.1)':user.plan==='custom'?'rgba(245,158,11,0.1)':(isDark?'rgba(148,163,184,0.1)':'#F1F5F9'),
                            color:user.role==='admin'?'#2563EB':user.plan==='premium'?'#A78BFA':user.plan==='professional'?'#10B981':user.plan==='custom'?'#F59E0B':(isDark?'#94A3B8':'#64748B')}}>
                            {user.role==='admin'?'Admin':(user.plan||'starter')}
                          </span>
                        </td>
                        {/* Message usage bar in table */}
                        <td style={{padding:'12px 16px',minWidth:120}}>
                          {msgsTotal > 0 ? (
                            <div>
                              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                                <span style={{fontSize:10,color:muted}}>{msgsUsed} / {msgsTotal}</span>
                                {user.bonus_messages > 0 && <span style={{fontSize:10,color:'#A78BFA'}}>+{user.bonus_messages}</span>}
                              </div>
                              <div style={{height:5,borderRadius:3,background:isDark?'#1C2A44':'#E2E8F0',overflow:'hidden',width:100}}>
                                <div style={{width:msgPct+'%',height:'100%',borderRadius:3,background:msgBarColor}} />
                              </div>
                            </div>
                          ) : (
                            <span style={{fontSize:11,color:muted}}>{msgsUsed} sent</span>
                          )}
                        </td>
                        {/* BOQ docs usage */}
                        <td style={{padding:'12px 16px',minWidth:100}}>
                          {(()=>{
                            const docsUsed = user.docs_used || 0;
                            const docsTotal = (user.monthly_boq_quota != null ? user.monthly_boq_quota : null) ?? user.docs_limit ?? (user.plan==='premium'?20:user.plan==='professional'?10:0);
                            const docPct = docsTotal > 0 ? Math.min(100, (docsUsed / docsTotal) * 100) : 0;
                            const docBarColor = docPct >= 90 ? '#EF4444' : docPct >= 70 ? '#F59E0B' : '#3B82F6';
                            return docsTotal > 0 ? (
                              <div>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                                  <span style={{fontSize:10,color:muted}}>{docsUsed} / {docsTotal}</span>
                                  {user.bonus_docs > 0 && <span style={{fontSize:10,color:'#A78BFA'}}>+{user.bonus_docs}</span>}
                                </div>
                                <div style={{height:5,borderRadius:3,background:isDark?'#1C2A44':'#E2E8F0',overflow:'hidden',width:100}}>
                                  <div style={{width:docPct+'%',height:'100%',borderRadius:3,background:docBarColor}} />
                                </div>
                              </div>
                            ) : <span style={{fontSize:11,color:muted}}>{docsUsed} generated</span>;
                          })()}
                        </td>
                        <td style={{padding:'12px 16px'}}>
                          <span style={{padding:'3px 9px',borderRadius:6,fontSize:10,fontWeight:700,background:user.suspended?'rgba(239,68,68,0.1)':'rgba(16,185,129,0.1)',color:user.suspended?'#EF4444':'#10B981'}}>
                            {user.suspended?'Suspended':'Active'}
                          </span>
                        </td>
                        <td style={{padding:'12px 16px',textAlign:'right'}}>
                          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}} onClick={e => e.stopPropagation()}>
                            <button onClick={() => setExpandedUser(expandedUser===user.id?null:user.id)}
                              style={{padding:'5px 10px',borderRadius:6,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:expandedUser===user.id?'rgba(37,99,235,0.1)':'transparent',cursor:'pointer',color:expandedUser===user.id?'#2563EB':muted,display:'flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600}}>
                              <ChevronDown size={13} style={{transform:expandedUser===user.id?'rotate(180deg)':'rotate(0)',transition:'transform 0.2s'}} /> Manage
                            </button>
                            {user.role!=='admin'&&<button onClick={() => setDeleteTarget(user)} style={{padding:'5px 7px',borderRadius:6,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:'transparent',cursor:'pointer',color:muted,display:'flex',alignItems:'center'}}><Trash2 size={13} /></button>}
                          </div>
                        </td>
                      </tr>
                      {expandedUser===user.id&&(
                        <tr><td colSpan={7} style={{padding:0}}>
                          <UserActionPanel user={user} isDark={isDark} onUpdate={handleUserUpdate} onClose={() => setExpandedUser(null)} />
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>)}

      <AddUserModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onUserAdded={u => { setUsers(prev => [u, ...prev]); }} isDark={isDark} />
      {deleteTarget && (
        <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:isDark?'#131B2E':'#FFF',borderRadius:16,padding:28,width:'100%',maxWidth:400,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),textAlign:'center'}}>
            <h3 style={{margin:'0 0 8px',fontSize:17,fontWeight:700,color:isDark?'#E8EDF5':'#0F172A'}}>Delete {deleteTarget.full_name}?</h3>
            <p style={{margin:'0 0 20px',fontSize:13,color:'#EF4444'}}>Deletes all data. Cannot be undone.</p>
            <div style={{display:'flex',gap:10}}>
              <button onClick={() => setDeleteTarget(null)} style={{flex:1,padding:11,borderRadius:10,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:'transparent',color:muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancel</button>
              <button onClick={() => handleDelete(deleteTarget.id)} style={{flex:1,padding:11,borderRadius:10,border:'none',background:'#EF4444',color:'#FFF',fontSize:13,fontWeight:600,cursor:'pointer'}}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
