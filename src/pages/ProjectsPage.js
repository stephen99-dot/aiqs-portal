import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

export default function ProjectsPage() {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [projects, setProjects] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('projects');

  const load = useCallback(async () => {
    try {
      const [pData, uData] = await Promise.all([apiFetch('/projects'), apiFetch('/usage')]);
      setProjects(pData.projects || []);
      setUsage(uData);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const c = {
    cardBg: isDark ? '#0D1117' : '#FFFFFF',
    cardBorder: isDark ? '#1E293B' : '#E2E8F0',
    text: isDark ? '#F1F5F9' : '#1E293B',
    textSec: isDark ? '#94A3B8' : '#64748B',
    textMut: isDark ? '#64748B' : '#94A3B8',
    accent: '#2563EB',
    green: isDark ? '#34D399' : '#059669',
    yellow: isDark ? '#FBBF24' : '#D97706',
    tabBg: isDark ? '#111827' : '#F1F5F9',
    tabActive: isDark ? '#1E293B' : '#FFFFFF',
    rowHover: isDark ? 'rgba(37,99,235,0.06)' : 'rgba(37,99,235,0.03)',
  };

  const formatDate = (d) => { try { return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); } catch(e) { return d; } };
  const formatCurrency = (v, cur) => { const sym = cur === 'EUR' ? '\u20ac' : '\u00a3'; return sym + (v||0).toLocaleString('en-GB', {minimumFractionDigits:0, maximumFractionDigits:0}); };

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:c.textSec}}>Loading...</div>;

  return (
    <div style={{padding:'24px',maxWidth:'1100px',margin:'0 auto'}}>
      <h1 style={{fontSize:'22px',fontWeight:700,color:c.text,margin:'0 0 4px'}}>
        {isAdmin ? '\ud83d\udcca Dashboard' : '\ud83d\udcc1 My Projects'}
      </h1>
      <p style={{fontSize:'13px',color:c.textSec,margin:'0 0 20px'}}>
        {isAdmin ? 'Client usage, projects, and rate training progress.' : 'Your project history and usage.'}
      </p>

      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'12px',marginBottom:'20px'}}>
        {usage && (
          <>
            <StatCard label="This Month" value={usage.month_messages||0} sub="messages" color={c.accent} c={c} />
            <StatCard label="Documents" value={usage.month_docs||0} sub="generated" color={c.green} c={c} />
            <StatCard label="Total Projects" value={projects.length} sub="all time" color={c.yellow} c={c} />
            {isAdmin && <StatCard label="API Cost" value={'$'+(usage.total_cost||0).toFixed(2)} sub="all time" color={c.accent} c={c} />}
            {!isAdmin && <StatCard label="Trained Rates" value={usage.total_rates||0} sub={Math.round((usage.avg_confidence||0)*100)+'% avg'} color={c.green} c={c} />}
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'4px',marginBottom:'16px',background:c.tabBg,borderRadius:'10px',padding:'4px'}}>
        {['projects', 'usage', ...(isAdmin ? ['clients','training'] : [])].map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:'8px 16px',borderRadius:'8px',border:'none',cursor:'pointer',fontSize:'13px',fontWeight:600,
            background:tab===t?c.tabActive:'transparent',color:tab===t?c.text:c.textMut,
            boxShadow:tab===t?(isDark?'0 1px 3px rgba(0,0,0,0.3)':'0 1px 3px rgba(0,0,0,0.1)'):'none',
          }}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
        ))}
      </div>

      {/* Projects tab */}
      {tab === 'projects' && (
        projects.length === 0 ? (
          <EmptyState icon="\ud83d\udcc1" title="No projects yet" desc="Projects are automatically saved when you generate BOQ documents in the chat." c={c} />
        ) : (
          <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'12px',overflow:'hidden'}}>
            <div style={{display:'grid',gridTemplateColumns:isAdmin?'1fr 120px 100px 80px 120px':'1fr 120px 100px 80px 120px',padding:'10px 20px',fontSize:'11px',fontWeight:600,color:c.textMut,textTransform:'uppercase',borderBottom:'1px solid '+c.cardBorder}}>
              <div>Project</div>
              {isAdmin && <div>Client</div>}
              <div style={{textAlign:'right'}}>Value</div>
              <div style={{textAlign:'center'}}>Items</div>
              <div style={{textAlign:'center'}}>Files</div>
              <div style={{textAlign:'right'}}>Date</div>
            </div>
            {projects.map(p => (
              <div key={p.id} style={{display:'grid',gridTemplateColumns:isAdmin?'1fr 120px 100px 80px 120px':'1fr 120px 100px 80px 120px',padding:'12px 20px',alignItems:'center',borderBottom:'1px solid '+(isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'),transition:'background 0.1s'}} onMouseEnter={e=>e.currentTarget.style.background=c.rowHover} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div>
                  <div style={{fontSize:'13px',fontWeight:600,color:c.text}}>{p.title}</div>
                  {p.summary && <div style={{fontSize:'11px',color:c.textMut,marginTop:'2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'300px'}}>{p.summary}</div>}
                </div>
                {isAdmin && <div style={{fontSize:'12px',color:c.textSec}}>{p.full_name||p.email||'—'}</div>}
                <div style={{textAlign:'right',fontSize:'13px',fontWeight:600,color:c.text,fontFamily:'monospace'}}>{formatCurrency(p.total_value, p.currency)}</div>
                <div style={{textAlign:'center',fontSize:'12px',color:c.textSec}}>{p.item_count||0}</div>
                <div style={{textAlign:'center',display:'flex',gap:'4px',justifyContent:'center'}}>
                  {p.boq_filename && <a href={'/api/downloads/'+p.boq_filename} style={{fontSize:'11px',color:c.accent,textDecoration:'none'}}>BOQ</a>}
                  {p.findings_filename && <a href={'/api/downloads/'+p.findings_filename} style={{fontSize:'11px',color:c.accent,textDecoration:'none'}}>Report</a>}
                </div>
                <div style={{textAlign:'right',fontSize:'12px',color:c.textMut}}>{formatDate(p.created_at)}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Usage tab */}
      {tab === 'usage' && usage && usage.recent && (
        <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'12px',overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid '+c.cardBorder}}>
            <div style={{fontSize:'14px',fontWeight:600,color:c.text}}>Recent Activity</div>
          </div>
          {usage.recent.length === 0 ? (
            <div style={{padding:'40px',textAlign:'center',color:c.textMut}}>No activity yet</div>
          ) : (
            usage.recent.map((u, i) => (
              <div key={i} style={{padding:'10px 20px',borderBottom:'1px solid '+(isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'),display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <span style={{fontSize:'12px',fontWeight:600,color:u.action==='doc_generated'?c.green:c.text}}>
                    {u.action === 'chat_message' ? '\ud83d\udcac Chat' : u.action === 'doc_generated' ? '\ud83d\udcc4 Document' : u.action}
                  </span>
                  {isAdmin && u.full_name && <span style={{fontSize:'11px',color:c.textMut,marginLeft:'8px'}}>{u.full_name}</span>}
                  {u.detail && <span style={{fontSize:'11px',color:c.textMut,marginLeft:'8px'}}>{u.detail.substring(0,60)}</span>}
                </div>
                <div style={{display:'flex',gap:'12px',alignItems:'center'}}>
                  {u.tokens_in > 0 && <span style={{fontSize:'10px',color:c.textMut}}>{(u.tokens_in+u.tokens_out).toLocaleString()} tokens</span>}
                  <span style={{fontSize:'11px',color:c.textMut}}>{formatDate(u.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Clients tab (admin) */}
      {tab === 'clients' && isAdmin && usage && usage.by_client && (
        <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'12px',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 80px 60px 100px 80px 100px',padding:'10px 20px',fontSize:'11px',fontWeight:600,color:c.textMut,textTransform:'uppercase',borderBottom:'1px solid '+c.cardBorder}}>
            <div>Client</div><div style={{textAlign:'center'}}>Messages</div><div style={{textAlign:'center'}}>Docs</div><div style={{textAlign:'right'}}>Tokens</div><div style={{textAlign:'right'}}>Cost</div><div style={{textAlign:'right'}}>Last Active</div>
          </div>
          {usage.by_client.map((cl, i) => (
            <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 80px 60px 100px 80px 100px',padding:'12px 20px',alignItems:'center',borderBottom:'1px solid '+(isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)')}}>
              <div>
                <div style={{fontSize:'13px',fontWeight:500,color:c.text}}>{cl.full_name||cl.email}</div>
                {cl.company && <div style={{fontSize:'11px',color:c.textMut}}>{cl.company}</div>}
              </div>
              <div style={{textAlign:'center',fontSize:'13px',color:c.text}}>{cl.messages}</div>
              <div style={{textAlign:'center',fontSize:'13px',color:c.green,fontWeight:600}}>{cl.docs}</div>
              <div style={{textAlign:'right',fontSize:'11px',color:c.textMut,fontFamily:'monospace'}}>{((cl.tokens_in+cl.tokens_out)/1000).toFixed(0)}k</div>
              <div style={{textAlign:'right',fontSize:'12px',color:c.text,fontFamily:'monospace'}}>${cl.cost.toFixed(3)}</div>
              <div style={{textAlign:'right',fontSize:'11px',color:c.textMut}}>{cl.last_active ? formatDate(cl.last_active) : '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Training tab (admin) */}
      {tab === 'training' && isAdmin && usage && usage.rate_training && (
        <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'12px',overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid '+c.cardBorder}}>
            <div style={{fontSize:'14px',fontWeight:600,color:c.text}}>Rate Training Progress</div>
            <div style={{fontSize:'12px',color:c.textMut,marginTop:'2px'}}>How far each client is in building their rate library.</div>
          </div>
          {usage.rate_training.map((cl, i) => {
            var pct = Math.round((cl.avg_confidence || 0) * 100);
            var status = cl.total_rates === 0 ? 'Not started' : cl.total_rates < 5 ? 'Getting started' : pct >= 85 ? 'Well trained' : 'Building';
            var statusColor = cl.total_rates === 0 ? c.textMut : cl.total_rates < 5 ? c.yellow : pct >= 85 ? c.green : c.accent;
            return (
              <div key={i} style={{padding:'14px 20px',borderBottom:'1px solid '+(isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)')}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
                  <div>
                    <span style={{fontSize:'13px',fontWeight:600,color:c.text}}>{cl.full_name||cl.email}</span>
                    {cl.company && <span style={{fontSize:'11px',color:c.textMut,marginLeft:'8px'}}>{cl.company}</span>}
                  </div>
                  <span style={{fontSize:'11px',fontWeight:600,color:statusColor}}>{status}</span>
                </div>
                <div style={{display:'flex',gap:'20px',fontSize:'12px',color:c.textSec}}>
                  <span><strong>{cl.total_rates}</strong> rates</span>
                  <span><strong>{pct}%</strong> avg confidence</span>
                  <span><strong>{cl.total_corrections||0}</strong> corrections</span>
                </div>
                <div style={{marginTop:'6px',height:'4px',background:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)',borderRadius:'2px',overflow:'hidden'}}>
                  <div style={{height:'100%',width:Math.min(pct,100)+'%',background:statusColor,borderRadius:'2px',transition:'width 0.3s'}}></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color, c }) {
  return (
    <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'10px',padding:'14px 16px'}}>
      <div style={{fontSize:'11px',color:c.textMut,marginBottom:'4px'}}>{label}</div>
      <div style={{fontSize:'22px',fontWeight:700,color:color}}>{value}</div>
      <div style={{fontSize:'11px',color:c.textMut,marginTop:'2px'}}>{sub}</div>
    </div>
  );
}

function EmptyState({ icon, title, desc, c }) {
  return (
    <div style={{background:c.cardBg,border:'1px solid '+c.cardBorder,borderRadius:'12px',padding:'48px 24px',textAlign:'center'}}>
      <div style={{fontSize:'48px',marginBottom:'16px'}}>{icon}</div>
      <h3 style={{color:c.text,fontSize:'16px',fontWeight:600,margin:'0 0 8px'}}>{title}</h3>
      <p style={{color:c.textSec,fontSize:'13px',maxWidth:'400px',margin:'0 auto'}}>{desc}</p>
    </div>
  );
}
