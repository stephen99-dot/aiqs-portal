import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Trash2, Shield, Search, X, AlertTriangle, Upload, Pause, Play, Plus, CreditCard, ChevronDown } from 'lucide-react';

const API_BASE = '/api';
function getToken() { return localStorage.getItem('aiqs_token'); }
function apiFetch(endpoint, options = {}) {
  const token = getToken();
  return fetch(`${API_BASE}${endpoint}`, { ...options, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers } })
    .then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Request failed'); return data; });
}
function apiUpload(endpoint, formData) {
  const token = getToken();
  return fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData })
    .then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Upload failed'); return data; });
}

function AddUserModal({ isOpen, onClose, onUserAdded, isDark }) {
  const [form, setForm] = useState({ email: '', password: '', fullName: '', company: '', phone: '', role: 'client' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  if (!isOpen) return null;
  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { const data = await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(form) }); onUserAdded(data.user); setForm({ email:'',password:'',fullName:'',company:'',phone:'',role:'client' }); onClose(); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const inputStyle = { width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:isDark?'#0D1320':'#F8FAFC',color:isDark?'#E8EDF5':'#0F172A',fontSize:14,outline:'none',boxSizing:'border-box' };
  const labelStyle = { display:'block',fontSize:12,fontWeight:600,color:isDark?'#94A3B8':'#64748B',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em' };
  return (
    <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:isDark?'#131B2E':'#FFF',borderRadius:16,padding:32,width:'100%',maxWidth:480,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),boxShadow:'0 24px 48px rgba(0,0,0,0.3)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,color:isDark?'#E8EDF5':'#0F172A',display:'flex',alignItems:'center',gap:10}}><UserPlus size={22} style={{color:'#2563EB'}} /> Add New User</h2>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:isDark?'#5A6E87':'#94A3B8',padding:4}}><X size={20} /></button>
        </div>
        {error && <div style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'10px 14px',marginBottom:16,color:'#EF4444',fontSize:13,display:'flex',alignItems:'center',gap:8}}><AlertTriangle size={14} /> {error}</div>}
        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:14}}>
          {[{key:'fullName',label:'Full Name',required:true,placeholder:'e.g. Paul Richards'},{key:'email',label:'Email',required:true,type:'email',placeholder:'paul@company.com'},{key:'password',label:'Password',required:true,type:'password',placeholder:'Min 6 characters'},{key:'company',label:'Company',placeholder:'e.g. Penn Contracting'},{key:'phone',label:'Phone',placeholder:'+44 7xxx xxx xxx'}].map(({key,label,required,type,placeholder}) => (
            <div key={key}><label style={labelStyle}>{label} {required && <span style={{color:'#EF4444'}}>*</span>}</label><input type={type||'text'} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} required={required} placeholder={placeholder} style={inputStyle} /></div>
          ))}
          <div><label style={labelStyle}>Role</label>
            <div style={{display:'flex',gap:10}}>
              {['client','admin'].map(role => (<button key={role} type="button" onClick={()=>setForm(f=>({...f,role}))} style={{flex:1,padding:'10px 14px',borderRadius:8,cursor:'pointer',border:(form.role===role?'2px solid #2563EB':'1px solid '+(isDark?'#1C2A44':'#E2E8F0')),background:form.role===role?'rgba(37,99,235,0.1)':'transparent',color:form.role===role?'#2563EB':(isDark?'#94A3B8':'#64748B'),fontSize:13,fontWeight:600,textTransform:'capitalize',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>{role==='admin'&&<Shield size={14}/>}{role==='client'&&<Users size={14}/>}{role}</button>))}
            </div>
          </div>
          <div style={{display:'flex',gap:10,marginTop:8}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:12,borderRadius:10,cursor:'pointer',border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:'transparent',color:isDark?'#94A3B8':'#64748B',fontSize:14,fontWeight:600}}>Cancel</button>
            <button type="submit" disabled={loading} style={{flex:1,padding:12,borderRadius:10,cursor:loading?'wait':'pointer',border:'none',background:'#2563EB',color:'#FFF',fontSize:14,fontWeight:600,opacity:loading?0.7:1}}>{loading ? 'Creating...' : 'Create User'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserActionPanel({ user, isDark, onUpdate, onClose }) {
  const [loading, setLoading] = useState('');
  const [creditMsgs, setCreditMsgs] = useState(10);
  const [creditDocs, setCreditDocs] = useState(1);
  const [importResult, setImportResult] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const fileInputRef = React.useRef(null);
  const bg = isDark ? '#0D1320' : '#F8FAFC';
  const border = isDark ? '#1C2A44' : '#E2E8F0';
  const text = isDark ? '#E8EDF5' : '#0F172A';
  const muted = isDark ? '#5A6E87' : '#94A3B8';
  const btnStyle = (color) => ({padding:'7px 14px',borderRadius:8,border:'none',cursor:'pointer',background:color,color:'#FFF',fontSize:12,fontWeight:600,opacity:loading?0.6:1,display:'inline-flex',alignItems:'center',gap:6});
  const outlineBtn = {padding:'7px 14px',borderRadius:8,border:'1px solid '+border,cursor:'pointer',background:'transparent',color:text,fontSize:12,fontWeight:600,display:'inline-flex',alignItems:'center',gap:6};
  const labelSm = {fontSize:11,fontWeight:600,color:muted,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:4};
  const smallInput = {padding:'7px 10px',borderRadius:6,border:'1px solid '+border,background:bg,color:text,fontSize:13,width:70,outline:'none'};

  const doAction = async (key, fn) => { setLoading(key); try { await fn(); } catch(e) { alert(e.message); } finally { setLoading(''); } };

  const changePlan = (plan) => doAction('plan', async () => {
    await apiFetch('/admin/change-plan/'+user.id, { method:'POST', body:JSON.stringify({plan}) });
    onUpdate({ ...user, plan });
  });
  const addCredits = () => doAction('credit', async () => {
    const res = await apiFetch('/admin/credit/'+user.id, { method:'POST', body:JSON.stringify({ bonus_messages:creditMsgs, bonus_docs:creditDocs }) });
    onUpdate({ ...user, bonus_messages: res.bonus_messages, bonus_docs: res.bonus_docs });
  });
  const toggleSuspend = () => doAction('suspend', async () => {
    if (user.suspended) { await apiFetch('/admin/unsuspend/'+user.id, { method:'POST' }); onUpdate({ ...user, suspended: 0, suspended_reason: null }); }
    else { await apiFetch('/admin/suspend/'+user.id, { method:'POST', body:JSON.stringify({ reason: suspendReason || 'Suspended by admin' }) }); onUpdate({ ...user, suspended: 1, suspended_reason: suspendReason || 'Suspended by admin' }); }
  });
  const grantDoc = () => doAction('grantdoc', async () => {
    await apiFetch('/admin/grant-doc/'+user.id, { method:'POST' });
    alert('Document credit granted to ' + (user.full_name || user.email));
  });
  const importRates = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    setLoading('import');
    try { const fd = new FormData(); fd.append('file', file); const res = await apiUpload('/admin/import-rates/'+user.id, fd); setImportResult(res); }
    catch(err) { alert(err.message); } finally { setLoading(''); if(fileInputRef.current) fileInputRef.current.value=''; }
  };

  return (
    <div style={{background:bg,borderTop:'1px solid '+border,padding:'20px 24px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:700,color:text}}>Manage: {user.full_name}</div>
        <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:muted}}><X size={16} /></button>
      </div>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:20}}>
        <div style={{padding:'10px 16px',borderRadius:10,border:'1px solid '+border,background:isDark?'#131B2E':'#FFF',minWidth:120}}><div style={labelSm}>Plan</div><div style={{fontSize:14,fontWeight:700,color:text,textTransform:'capitalize'}}>{user.plan || 'starter'}</div></div>
        <div style={{padding:'10px 16px',borderRadius:10,border:'1px solid '+border,background:isDark?'#131B2E':'#FFF',minWidth:120}}><div style={labelSm}>Bonus Messages</div><div style={{fontSize:14,fontWeight:700,color:'#2563EB'}}>{user.bonus_messages || 0}</div></div>
        <div style={{padding:'10px 16px',borderRadius:10,border:'1px solid '+border,background:isDark?'#131B2E':'#FFF',minWidth:120}}><div style={labelSm}>Bonus Docs</div><div style={{fontSize:14,fontWeight:700,color:'#10B981'}}>{user.bonus_docs || 0}</div></div>
        <div style={{padding:'10px 16px',borderRadius:10,border:'1px solid '+(user.suspended?'rgba(239,68,68,0.3)':border),background:user.suspended?'rgba(239,68,68,0.05)':(isDark?'#131B2E':'#FFF'),minWidth:120}}><div style={labelSm}>Status</div><div style={{fontSize:14,fontWeight:700,color:user.suspended?'#EF4444':'#10B981'}}>{user.suspended ? 'Suspended' : 'Active'}</div></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <div style={{padding:16,borderRadius:10,border:'1px solid '+border,background:isDark?'#131B2E':'#FFF'}}>
          <div style={{...labelSm,marginBottom:10}}>Change Plan</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {['starter','professional','premium'].map(p => (
              <button key={p} onClick={()=>changePlan(p)} disabled={user.plan===p||!!loading} style={{padding:'6px 12px',borderRadius:6,fontSize:12,fontWeight:600,cursor:user.plan===p?'default':'pointer',border:user.plan===p?'2px solid #2563EB':'1px solid '+border,background:user.plan===p?'rgba(37,99,235,0.1)':'transparent',color:user.plan===p?'#2563EB':muted,textTransform:'capitalize',opacity:user.plan===p?1:(loading?0.5:1)}}>{p}</button>
            ))}
          </div>
        </div>
        <div style={{padding:16,borderRadius:10,border:'1px solid '+border,background:isDark?'#131B2E':'#FFF'}}>
          <div style={{...labelSm,marginBottom:10}}>Add Bonus Credits</div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <div><div style={{fontSize:10,color:muted,marginBottom:2}}>Messages</div><input type="number" value={creditMsgs} onChange={e=>setCreditMsgs(parseInt(e.target.value)||0)} style={smallInput} /></div>
            <div><div style={{fontSize:10,color:muted,marginBottom:2}}>Docs</div><input type="number" value={creditDocs} onChange={e=>setCreditDocs(parseInt(e.target.value)||0)} style={smallInput} /></div>
            <button onClick={addCredits} disabled={!!loading} style={{...btnStyle('#2563EB'),marginTop:14}}><Plus size={12} /> Add</button>
          </div>
        </div>
        <div style={{padding:16,borderRadius:10,border:'1px solid '+border,background:isDark?'#131B2E':'#FFF'}}>
          <div style={{...labelSm,marginBottom:10}}>{user.suspended ? 'Reactivate Account' : 'Suspend Account'}</div>
          {!user.suspended && <input value={suspendReason} onChange={e=>setSuspendReason(e.target.value)} placeholder="Reason (optional)" style={{...smallInput,width:'100%',marginBottom:8}} />}
          <button onClick={toggleSuspend} disabled={!!loading} style={user.suspended ? btnStyle('#10B981') : btnStyle('#EF4444')}>{user.suspended ? <><Play size={12} /> Reactivate</> : <><Pause size={12} /> Suspend</>}</button>
          {user.suspended && user.suspended_reason && <div style={{fontSize:11,color:'#EF4444',marginTop:6}}>Reason: {user.suspended_reason}</div>}
        </div>
        <div style={{padding:16,borderRadius:10,border:'1px solid '+border,background:isDark?'#131B2E':'#FFF'}}>
          <div style={{...labelSm,marginBottom:10}}>Import Rates / Grant Credit</div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={importRates} style={{display:'none'}} />
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={()=>fileInputRef.current && fileInputRef.current.click()} disabled={!!loading} style={outlineBtn}><Upload size={12} /> Upload Excel</button>
            <button onClick={grantDoc} disabled={!!loading} style={outlineBtn}><CreditCard size={12} /> Grant BOQ Credit</button>
          </div>
          {importResult && <div style={{marginTop:8,fontSize:12,color:'#10B981'}}>Imported {importResult.imported} rates{importResult.skipped > 0 ? ', skipped '+importResult.skipped : ''}</div>}
        </div>
      </div>
    </div>
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
  const t = theme || {};
  const isDark = t.bg === '#06080F' || (t.bg && t.bg.includes && t.bg.includes('0'));
  const fetchUsers = useCallback(async () => {
    try { setLoading(true); const data = await apiFetch('/admin/users'); setUsers(data.users || []); setError(''); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  const handleDelete = async (userId) => {
    try { await apiFetch('/admin/users/'+userId, { method:'DELETE' }); setUsers(prev => prev.filter(u => u.id !== userId)); setDeleteTarget(null); }
    catch (err) { alert('Failed: ' + err.message); }
  };
  const handleToggleRole = async (user) => {
    const newRole = user.role === 'admin' ? 'client' : 'admin';
    try { await apiFetch('/admin/users/'+user.id+'/role', { method:'PUT', body:JSON.stringify({ role: newRole }) }); setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u)); }
    catch (err) { alert('Failed: ' + err.message); }
  };
  const handleUserUpdate = (updated) => { setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u)); };
  const filtered = users.filter(u => {
    const matchSearch = !search || [u.full_name,u.email,u.company].some(f => f && f.toLowerCase().includes(search.toLowerCase()));
    return (roleFilter === 'all' || u.role === roleFilter) && matchSearch;
  });
  const adminCount = users.filter(u => u.role === 'admin').length;
  const clientCount = users.filter(u => u.role === 'client').length;
  const cardStyle = { background:isDark?'#131B2E':'#FFF', border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'), borderRadius:14, overflow:'hidden' };
  return (
    <div style={{padding:'28px 32px',maxWidth:1100,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:28}}>
        <div>
          <h1 style={{margin:0,fontSize:26,fontWeight:800,color:isDark?'#E8EDF5':'#0F172A'}}>User Management</h1>
          <p style={{margin:'4px 0 0',fontSize:14,color:isDark?'#5A6E87':'#94A3B8'}}>{users.length} total | {adminCount} admins | {clientCount} clients</p>
        </div>
        <button onClick={()=>setShowAddModal(true)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 20px',borderRadius:10,border:'none',background:'#2563EB',color:'#FFF',fontSize:14,fontWeight:600,cursor:'pointer'}}><UserPlus size={16} /> Add User</button>
      </div>
      <div style={{display:'flex',gap:12,marginBottom:20}}>
        <div style={{flex:1,display:'flex',alignItems:'center',gap:10,padding:'0 14px',borderRadius:10,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:isDark?'#0D1320':'#F8FAFC'}}>
          <Search size={16} style={{color:isDark?'#5A6E87':'#94A3B8'}} />
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{flex:1,padding:'11px 0',border:'none',background:'transparent',color:isDark?'#E8EDF5':'#0F172A',fontSize:14,outline:'none'}} />
          {search && <button onClick={()=>setSearch("")} style={{background:'none',border:'none',cursor:'pointer',color:isDark?'#5A6E87':'#94A3B8'}}><X size={14} /></button>}
        </div>
        <div style={{display:'flex',gap:4,background:isDark?'#0D1320':'#F1F5F9',borderRadius:10,padding:3}}>
          {['all','admin','client'].map(f => (<button key={f} onClick={()=>setRoleFilter(f)} style={{padding:'8px 16px',borderRadius:8,border:'none',cursor:'pointer',background:roleFilter===f?'#2563EB':'transparent',color:roleFilter===f?'#FFF':(isDark?'#5A6E87':'#94A3B8'),fontSize:13,fontWeight:600,textTransform:'capitalize'}}>{f==='all'?'All ('+users.length+')':f==='admin'?'Admins ('+adminCount+')':'Clients ('+clientCount+')'}</button>))}
        </div>
      </div>
      {error && <div style={{background:'rgba(239,68,68,0.1)',borderRadius:10,padding:'14px 18px',marginBottom:20,color:'#EF4444',fontSize:14}}>{error}</div>}
      {loading ? (
        <div style={{textAlign:'center',padding:'60px 0',color:isDark?'#5A6E87':'#94A3B8'}}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{textAlign:'center',padding:'60px 0',color:isDark?'#5A6E87':'#94A3B8'}}><Users size={40} style={{marginBottom:12,opacity:0.4}} /><p>{search?'No match':'No users yet'}</p></div>
      ) : (
        <div style={cardStyle}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:isDark?'rgba(37,99,235,0.06)':'#F8FAFC'}}>
              {['User','Company','Plan','Status','Actions'].map(h => (<th key={h} style={{padding:'12px 16px',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:isDark?'#5A6E87':'#94A3B8',textAlign:h==='Actions'?'right':'left',borderBottom:'1px solid '+(isDark?'#1C2A44':'#E2E8F0')}}>{h}</th>))}
            </tr></thead>
            <tbody>
              {filtered.map((user, i) => (
                <React.Fragment key={user.id}>
                  <tr style={{borderBottom:expandedUser===user.id?'none':(i<filtered.length-1?'1px solid '+(isDark?'#1C2A44':'#F1F5F9'):'none'),cursor:'pointer'}}
                    onClick={()=>setExpandedUser(expandedUser===user.id?null:user.id)}
                    onMouseEnter={e=>{e.currentTarget.style.background=isDark?'rgba(37,99,235,0.04)':'#FAFBFE'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='transparent'}}>
                    <td style={{padding:'14px 16px'}}><div style={{display:'flex',alignItems:'center',gap:12}}>
                      <div style={{width:38,height:38,borderRadius:'50%',background:user.role==='admin'?'linear-gradient(135deg,#2563EB,#7C3AED)':(isDark?'#1C2A44':'#E2E8F0'),display:'flex',alignItems:'center',justifyContent:'center',color:user.role==='admin'?'#FFF':(isDark?'#5A6E87':'#94A3B8'),fontSize:14,fontWeight:700}}>{user.full_name?user.full_name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2):'??'}</div>
                      <div><div style={{fontSize:14,fontWeight:600,color:isDark?'#E8EDF5':'#0F172A'}}>{user.full_name} {user.role==='admin'&&<Shield size={12} style={{color:'#2563EB'}} />}</div><div style={{fontSize:12,color:isDark?'#5A6E87':'#94A3B8'}}>{user.email}</div></div>
                    </div></td>
                    <td style={{padding:'14px 16px',fontSize:13,color:isDark?'#94A3B8':'#64748B'}}>{user.company||'-'}</td>
                    <td style={{padding:'14px 16px'}}><span style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:700,textTransform:'uppercase',background:user.role==='admin'?'rgba(37,99,235,0.1)':user.plan==='premium'?'rgba(124,58,237,0.1)':user.plan==='professional'?'rgba(16,185,129,0.1)':(isDark?'rgba(148,163,184,0.1)':'#F1F5F9'),color:user.role==='admin'?'#2563EB':user.plan==='premium'?'#A78BFA':user.plan==='professional'?'#10B981':(isDark?'#94A3B8':'#64748B')}}>{user.role==='admin'?'Admin':(user.plan||'starter')}</span></td>
                    <td style={{padding:'14px 16px'}}><span style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:700,background:user.suspended?'rgba(239,68,68,0.1)':'rgba(16,185,129,0.1)',color:user.suspended?'#EF4444':'#10B981'}}>{user.suspended?'Suspended':'Active'}</span></td>
                    <td style={{padding:'14px 16px',textAlign:'right'}}><div style={{display:'flex',gap:6,justifyContent:'flex-end'}} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>setExpandedUser(expandedUser===user.id?null:user.id)} style={{padding:'6px 10px',borderRadius:6,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:expandedUser===user.id?'rgba(37,99,235,0.1)':'transparent',cursor:'pointer',color:expandedUser===user.id?'#2563EB':(isDark?'#94A3B8':'#64748B'),display:'flex',alignItems:'center',gap:4,fontSize:12,fontWeight:600}}><ChevronDown size={14} style={{transform:expandedUser===user.id?'rotate(180deg)':'rotate(0)',transition:'transform 0.2s'}} /> Manage</button>
                      {user.role!=='admin'&&<button onClick={()=>setDeleteTarget(user)} style={{padding:'6px 8px',borderRadius:6,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:'transparent',cursor:'pointer',color:isDark?'#94A3B8':'#64748B',display:'flex',alignItems:'center'}}><Trash2 size={14} /></button>}
                    </div></td>
                  </tr>
                  {expandedUser===user.id&&user.role!=='admin'&&(<tr><td colSpan={5} style={{padding:0}}><UserActionPanel user={user} isDark={isDark} onUpdate={handleUserUpdate} onClose={()=>setExpandedUser(null)} /></td></tr>)}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddUserModal isOpen={showAddModal} onClose={()=>setShowAddModal(false)} onUserAdded={u=>{setUsers(prev=>[u,...prev])}} isDark={isDark} />
      {deleteTarget&&(<div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}><div style={{background:isDark?'#131B2E':'#FFF',borderRadius:16,padding:32,width:'100%',maxWidth:420,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),textAlign:'center'}}><h3 style={{margin:'0 0 8px',fontSize:18,fontWeight:700,color:isDark?'#E8EDF5':'#0F172A'}}>Delete {deleteTarget.full_name}?</h3><p style={{margin:'0 0 24px',fontSize:13,color:'#EF4444'}}>This deletes all data. Cannot be undone.</p><div style={{display:'flex',gap:10}}><button onClick={()=>setDeleteTarget(null)} style={{flex:1,padding:12,borderRadius:10,border:'1px solid '+(isDark?'#1C2A44':'#E2E8F0'),background:'transparent',color:isDark?'#94A3B8':'#64748B',fontSize:14,fontWeight:600,cursor:'pointer'}}>Cancel</button><button onClick={()=>handleDelete(deleteTarget.id)} style={{flex:1,padding:12,borderRadius:10,border:'none',background:'#EF4444',color:'#FFF',fontSize:14,fontWeight:600,cursor:'pointer'}}>Delete</button></div></div></div>)}
    </div>
  );
}
