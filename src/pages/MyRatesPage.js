import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

const CATEGORY_LABELS = {
  structural_steel: { label: 'Structural Steel', icon: '🏗️' },
  architectural_metalwork: { label: 'Architectural Metalwork', icon: '🔩' },
  preliminaries: { label: 'Preliminaries', icon: '📋' },
  groundworks: { label: 'Groundworks', icon: '⛏️' },
  masonry: { label: 'Masonry', icon: '🧱' },
  carpentry: { label: 'Carpentry', icon: '🪵' },
  roofing: { label: 'Roofing', icon: '🏠' },
  plastering: { label: 'Plastering', icon: '🪣' },
  flooring: { label: 'Flooring', icon: '🪨' },
  electrical: { label: 'Electrical', icon: '⚡' },
  plumbing: { label: 'Plumbing', icon: '🔧' },
  mechanical: { label: 'Mechanical', icon: '🌡️' },
  decorating: { label: 'Decorating', icon: '🎨' },
  kitchen: { label: 'Kitchen', icon: '🍳' },
  bathroom: { label: 'Bathroom', icon: '🚿' },
  demolition: { label: 'Demolition', icon: '💥' },
  partitions: { label: 'Partitions', icon: '🧱' },
  location_factors: { label: 'Location Factors', icon: '📍' },
};

function getCatInfo(cat) {
  return CATEGORY_LABELS[cat] || { label: cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: '📦' };
}

function confidenceBadge(conf, isDark) {
  if (conf >= 0.85) return { text: 'Verified', bg: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)', color: isDark ? '#34D399' : '#059669', border: isDark ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)' };
  if (conf >= 0.7) return { text: 'Emerging', bg: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.1)', color: isDark ? '#FBBF24' : '#D97706', border: isDark ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.2)' };
  return { text: 'New', bg: isDark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.1)', color: isDark ? '#94A3B8' : '#64748B', border: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(148,163,184,0.2)' };
}

export default function MyRatesPage() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [rates, setRates] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState({});

  const loadRates = useCallback(async () => {
    try {
      const data = await apiFetch('/my-rates');
      setRates(data.rates || []);
      setStats(data.stats || null);
      // Auto-expand all categories
      const cats = {};
      for (const r of (data.rates || [])) cats[r.category] = true;
      setExpandedCats(cats);
    } catch (e) {
      console.error('Failed to load rates:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  const handleSave = async (rate) => {
    const newVal = parseFloat(editValue);
    if (isNaN(newVal) || newVal === rate.value) { setEditingId(null); return; }
    try {
      await apiFetch('/my-rates/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrections: [{ category: rate.category, item_key: rate.item_key, display_name: rate.display_name, value: newVal, unit: rate.unit, original_value: rate.value, note: 'Manual edit from My Rates page' }],
          raw_message: `Manual correction: ${rate.display_name} changed from ${rate.value} to ${newVal}`
        })
      });
      setEditingId(null);
      loadRates();
    } catch (e) { alert('Failed to save — please try again.'); }
  };

  // Group by category
  const grouped = {};
  const filtered = search ? rates.filter(r => r.display_name.toLowerCase().includes(search.toLowerCase()) || r.category.toLowerCase().includes(search.toLowerCase())) : rates;
  for (const r of filtered) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }
  const categories = Object.keys(grouped).sort();

  const toggleCat = (cat) => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }));

  // Colors
  const c = {
    pageBg: isDark ? '#06080F' : '#F4F6FA',
    cardBg: isDark ? '#0D1117' : '#FFFFFF',
    cardBorder: isDark ? '#1E293B' : '#E2E8F0',
    headerBg: isDark ? '#111827' : '#F8FAFC',
    rowHover: isDark ? 'rgba(37,99,235,0.06)' : 'rgba(37,99,235,0.03)',
    text: isDark ? '#F1F5F9' : '#1E293B',
    textSec: isDark ? '#94A3B8' : '#64748B',
    textMut: isDark ? '#64748B' : '#94A3B8',
    accent: isDark ? '#2563EB' : '#2563EB',
    inputBg: isDark ? '#0D1117' : '#F8FAFC',
    inputBorder: isDark ? '#1E293B' : '#E2E8F0',
    catBg: isDark ? '#111827' : '#F1F5F9',
    catBorder: isDark ? '#1E293B' : '#E2E8F0',
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: c.textSec }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🧠</div>
        Loading your rate library...
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: c.text, margin: 0 }}>
              🧠 My Rate Library
            </h1>
            <p style={{ fontSize: '13px', color: c.textSec, margin: '4px 0 0' }}>
              {isAdmin ? 'Master rate library — these rates are used as defaults for all projects.' : 'Your trained rates — used automatically when you chat with the AI QS. Edit any rate and it updates instantly.'}
            </p>
          </div>
          {stats && stats.total > 0 && (
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}`, borderRadius: '10px', padding: '10px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: c.accent }}>{stats.total}</div>
                <div style={{ fontSize: '11px', color: c.textMut, marginTop: '2px' }}>Trained Rates</div>
              </div>
              <div style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}`, borderRadius: '10px', padding: '10px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: stats.avg_confidence >= 0.85 ? (isDark ? '#34D399' : '#059669') : (isDark ? '#FBBF24' : '#D97706') }}>
                  {Math.round((stats.avg_confidence || 0) * 100)}%
                </div>
                <div style={{ fontSize: '11px', color: c.textMut, marginTop: '2px' }}>Avg Confidence</div>
              </div>
              <div style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}`, borderRadius: '10px', padding: '10px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: c.text }}>{stats.total_uses || 0}</div>
                <div style={{ fontSize: '11px', color: c.textMut, marginTop: '2px' }}>Times Used</div>
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ marginTop: '16px' }}>
          <input
            type="text"
            placeholder="Search rates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', maxWidth: '320px', padding: '8px 14px',
              background: c.inputBg, border: `1px solid ${c.inputBorder}`,
              borderRadius: '8px', color: c.text, fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Empty state */}
      {rates.length === 0 && (
        <div style={{
          background: c.cardBg, border: `1px solid ${c.cardBorder}`,
          borderRadius: '12px', padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📐</div>
          <h3 style={{ color: c.text, fontSize: '16px', fontWeight: 600, margin: '0 0 8px' }}>No rates trained yet</h3>
          <p style={{ color: c.textSec, fontSize: '13px', maxWidth: '400px', margin: '0 auto' }}>
            Start chatting with the AI QS and correct any rates that don't match your costs. They'll appear here automatically and get smarter over time.
          </p>
        </div>
      )}

      {/* Rate categories */}
      {categories.map(cat => {
        const catInfo = getCatInfo(cat);
        const catRates = grouped[cat];
        const isExpanded = expandedCats[cat];
        const avgConf = catRates.reduce((s, r) => s + (r.confidence || 0), 0) / catRates.length;

        return (
          <div key={cat} style={{
            background: c.cardBg, border: `1px solid ${c.cardBorder}`,
            borderRadius: '12px', marginBottom: '12px', overflow: 'hidden',
          }}>
            {/* Category header */}
            <div
              onClick={() => toggleCat(cat)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', cursor: 'pointer',
                background: c.catBg, borderBottom: isExpanded ? `1px solid ${c.catBorder}` : 'none',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>{catInfo.icon}</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: c.text }}>{catInfo.label}</span>
                <span style={{ fontSize: '12px', color: c.textMut, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: '10px', padding: '2px 8px' }}>
                  {catRates.length} rate{catRates.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {(() => { const b = confidenceBadge(avgConf, isDark); return (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: b.color, background: b.bg, border: `1px solid ${b.border}`, borderRadius: '10px', padding: '2px 8px' }}>{b.text}</span>
                ); })()}
                <span style={{ fontSize: '16px', color: c.textMut, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▼</span>
              </div>
            </div>

            {/* Rate rows */}
            {isExpanded && (
              <div>
                {/* Table header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 100px 80px 90px 80px',
                  padding: '8px 20px', fontSize: '11px', fontWeight: 600,
                  color: c.textMut, textTransform: 'uppercase', letterSpacing: '0.05em',
                  borderBottom: `1px solid ${c.catBorder}`,
                }}>
                  <div>Rate</div>
                  <div style={{ textAlign: 'right' }}>Value</div>
                  <div style={{ textAlign: 'center' }}>Unit</div>
                  <div style={{ textAlign: 'center' }}>Confidence</div>
                  <div style={{ textAlign: 'center' }}>Actions</div>
                </div>

                {catRates.map(rate => {
                  const isEditing = editingId === rate.id;
                  const badge = confidenceBadge(rate.confidence, isDark);

                  return (
                    <div key={rate.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 100px 80px 90px 80px',
                      padding: '10px 20px', alignItems: 'center',
                      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
                      transition: 'background 0.1s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = c.rowHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: c.text }}>{rate.display_name}</div>
                        {rate.client_note && <div style={{ fontSize: '11px', color: c.textMut, marginTop: '2px' }}>{rate.client_note}</div>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {isEditing ? (
                          <input
                            type="number"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(rate); if (e.key === 'Escape') setEditingId(null); }}
                            autoFocus
                            style={{
                              width: '80px', padding: '4px 8px', textAlign: 'right',
                              background: c.inputBg, border: `1px solid ${c.accent}`,
                              borderRadius: '6px', color: c.text, fontSize: '13px', outline: 'none',
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: '13px', fontWeight: 600, color: c.text, fontFamily: 'monospace' }}>
                            {typeof rate.value === 'number' ? rate.value.toLocaleString('en-GB') : rate.value}
                          </span>
                        )}
                      </div>
                      <div style={{ textAlign: 'center', fontSize: '12px', color: c.textSec }}>{rate.unit}</div>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{
                          fontSize: '10px', fontWeight: 600, color: badge.color,
                          background: badge.bg, border: `1px solid ${badge.border}`,
                          borderRadius: '8px', padding: '2px 6px',
                        }}>{badge.text}</span>
                      </div>
                      <div style={{ textAlign: 'center', display: 'flex', gap: '4px', justifyContent: 'center' }}>
                        {isEditing ? (
                          <>
                            <button onClick={() => handleSave(rate)} style={{ background: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: isDark ? '#34D399' : '#059669', cursor: 'pointer', fontWeight: 600 }}>Save</button>
                            <button onClick={() => setEditingId(null)} style={{ background: 'transparent', border: 'none', padding: '4px 8px', fontSize: '11px', color: c.textMut, cursor: 'pointer' }}>Cancel</button>
                          </>
                        ) : (
                          <button onClick={() => { setEditingId(rate.id); setEditValue(String(rate.value)); }} style={{ background: 'transparent', border: `1px solid ${c.cardBorder}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: c.textSec, cursor: 'pointer' }}>Edit</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Info footer */}
      {rates.length > 0 && (
        <div style={{ marginTop: '20px', padding: '16px 20px', background: isDark ? 'rgba(37,99,235,0.06)' : 'rgba(37,99,235,0.03)', border: `1px solid ${isDark ? 'rgba(37,99,235,0.15)' : 'rgba(37,99,235,0.1)'}`, borderRadius: '10px' }}>
          <div style={{ fontSize: '13px', color: c.text, fontWeight: 500, marginBottom: '6px' }}>💡 How rate training works</div>
          <div style={{ fontSize: '12px', color: c.textSec, lineHeight: '1.6' }}>
            When you chat with the AI QS, it uses your trained rates instead of generic UK averages. Correct any rate in chat and it'll automatically update here — the more corrections you make, the higher the confidence score goes. You can also edit rates directly on this page.
          </div>
        </div>
      )}
    </div>
  );
}
