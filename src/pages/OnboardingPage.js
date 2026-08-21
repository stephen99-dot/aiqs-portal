import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken } from '../utils/api';

// Three screens:
//   1. "What's your trade?" — live search over the server's trade catalogue
//      (names + aliases, so "sparky" finds Electrician), plus company name
//      and an optional logo upload.
//   2. Qualifying questions for that trade, fetched from the server so the
//      screen, the stored submission and the admin download all agree.
//   3. "Anything else?" free text, then submit.
// Completing it stores the full submission, alerts the admin (bell + email,
// downloadable from Admin → Onboarding with the logo), seeds memories, and
// puts the day rate into the rate library so estimates price from it.

// Defined OUTSIDE the component so React doesn't treat it as a new component type
// on every render — that was causing the input to lose focus after every keystroke.
function Field({ label, desc, children, colors }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 4 }}>{label}</div>
      {desc && <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>{desc}</div>}
      {children}
    </div>
  );
}

// Same ranking as the server's searchTrades: name prefix, then alias prefix,
// then substring anywhere — run locally so suggestions update per keystroke.
function filterTrades(trades, query, limit = 8) {
  const q = query.toLowerCase().trim();
  if (!q) return trades.slice(0, limit).map(t => t.name);
  const bands = [[], [], []];
  for (const t of trades) {
    const name = t.name.toLowerCase();
    if (name.startsWith(q)) bands[0].push(t.name);
    else if ((t.aliases || []).some(a => a.startsWith(q))) bands[1].push(t.name);
    else if (name.includes(q) || (t.aliases || []).some(a => a.includes(q))) bands[2].push(t.name);
  }
  return bands.flat().slice(0, limit);
}

export default function OnboardingPage() {
  const { t } = useTheme();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  // Step 1 — trade picker + identity
  const [trades, setTrades] = useState([]);
  const [tradeQuery, setTradeQuery] = useState('');
  const [trade, setTrade] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [logoUploaded, setLogoUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Step 2 — qualifying questions for the chosen trade
  const [questions, setQuestions] = useState([]);
  const [questionsFor, setQuestionsFor] = useState(null);
  const [qualifying, setQualifying] = useState({});
  const [dayRateTouched, setDayRateTouched] = useState(false);

  // Step 3 — the trade's itemised rate sheet. All optional: typical figures
  // sit as placeholders, and anything left blank is priced with generic UK
  // rates instead.
  const [rateItems, setRateItems] = useState([]);
  const [itemRates, setItemRates] = useState({});

  // Step 3 — anything else
  const [notes, setNotes] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch('/onboarding').then(d => setStatus(d)).catch(() => {}),
      apiFetch('/onboarding/trades').then(d => setTrades(d.trades || [])).catch(() => {}),
      apiFetch('/branding').then(b => {
        if (b.branding?.company_name) setCompanyName(b.branding.company_name);
        if (b.branding?.logo_filename) setLogoUploaded(true);
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // Load the question set when the chosen trade changes; prefill defaults
  // (like the trade's typical day rate) without clobbering answers on Back.
  useEffect(() => {
    if (step !== 1 || !trade || questionsFor === trade) return;
    apiFetch('/onboarding/questions?trade=' + encodeURIComponent(trade))
      .then(d => {
        const qs = d.questions || [];
        setQuestions(qs);
        setRateItems(d.rate_items || []);
        setItemRates({});
        setQuestionsFor(trade);
        setQualifying(prev => {
          const next = {};
          for (const q of qs) {
            // A day rate the user never touched re-prefills from the new
            // trade's typical figure; everything else they answered carries over.
            if (q.id === 'day_rate' && !dayRateTouched && q.default != null) next[q.id] = q.default;
            else if (prev[q.id] != null && prev[q.id] !== '') next[q.id] = prev[q.id];
            else if (q.default != null) next[q.id] = q.default;
          }
          return next;
        });
      })
      .catch(() => setQuestions([]));
  }, [step, trade, questionsFor, dayRateTouched]);

  const pickTrade = (name) => {
    setTrade(name);
    setTradeQuery(name);
    setSearchFocused(false);
  };

  const setAnswer = (id, val) => {
    if (id === 'day_rate') setDayRateTouched(true);
    setQualifying(a => ({ ...a, [id]: val }));
  };
  const toggleAnswer = (id, val) => {
    setQualifying(a => {
      const cur = Array.isArray(a[id]) ? a[id] : [];
      return { ...a, [id]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] };
    });
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file, file.name);
      const resp = await fetch('/api/branding/logo', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + getToken() },
        body: fd,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Upload failed');
      setLogoUploaded(true);
    } catch (e) { alert(e.message); }
    finally { setUploading(false); }
  };

  async function save() {
    setSaving(true);
    try {
      if (companyName.trim()) {
        await apiFetch('/branding', { method: 'PATCH', body: JSON.stringify({ company_name: companyName.trim() }) }).catch(() => {});
      }
      const dayRate = parseFloat(qualifying.day_rate);
      const body = {
        trade,
        qualifying,
        notes,
        answers: companyName.trim() ? { company_name: companyName.trim() } : {},
      };
      if (trade && dayRate > 0) {
        body.trade_rates = { [trade]: dayRate };
        body.trade_rates_touched = dayRateTouched;
      }
      const filledItems = {};
      for (const [k, v] of Object.entries(itemRates)) {
        const n = parseFloat(v);
        if (n > 0) filledItems[k] = n;
      }
      if (trade && Object.keys(filledItems).length > 0) body.rate_items = filledItems;
      await apiFetch('/onboarding', { method: 'POST', body: JSON.stringify(body) });
      setDone(true);
    } catch (e) {
      alert(e.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    if (!window.confirm('Skip for now? You can always complete this later from the AI Memory page.')) return;
    setSaving(true);
    try {
      await apiFetch('/onboarding', { method: 'POST', body: JSON.stringify({ skipped: true }) });
      navigate('/dashboard');
    } catch (e) {
      alert(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  // Palette derived from theme tokens so onboarding matches the chosen theme.
  const c = {
    page: t.bg, card: t.card, border: t.border,
    text: t.text, textMuted: t.textSecondary, accent: t.accent,
    accentBg: t.surfaceHover, accentBorder: t.accent,
    input: t.inputBg, inputBorder: t.border, pill: t.surfaceHover,
    pillActive: t.surfaceHover,
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    background: c.input, border: `1px solid ${c.inputBorder}`,
    color: c.text, fontSize: 14, outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const pill = (active) => ({
    padding: '8px 14px', borderRadius: 999,
    background: active ? c.pillActive : c.pill,
    border: `1px solid ${active ? c.accentBorder : c.inputBorder}`,
    color: active ? c.accent : c.text,
    fontSize: 13, fontWeight: active ? 600 : 500,
    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
  });

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: c.textMuted }}>Loading...</div>;

  // ── Done screen ──────────────────────────────────────────────────────
  if (done) {
    return (
      <div style={{ padding: '80px 32px', maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 14 }}>✓</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.text, margin: '0 0 10px' }}>
          Thanks — we've got your profile
        </h1>
        <p style={{ fontSize: 14, color: c.textMuted, lineHeight: 1.6, marginBottom: 26 }}>
          Our team has been notified and your AI QS is being tuned to how {trade ? `a ${trade.toLowerCase()} works` : 'you work'}.
          Your answers live in AI Memory, and your day rate is in My Rates — both editable any time.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '11px 26px', borderRadius: 8,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            border: 'none', color: '#0A0F1C', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Go to dashboard
        </button>
      </div>
    );
  }

  const suggestions = filterTrades(trades, tradeQuery);
  const exactMatch = trades.some(x => x.name.toLowerCase() === tradeQuery.toLowerCase().trim());
  const showCustom = tradeQuery.trim().length > 2 && !exactMatch;

  const renderQuestion = (q) => {
    if (q.type === 'pills') {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {q.options.map(opt => (
            <button key={opt} type="button" onClick={() => setAnswer(q.id, qualifying[q.id] === opt ? '' : opt)} style={pill(qualifying[q.id] === opt)}>
              {opt}
            </button>
          ))}
        </div>
      );
    }
    if (q.type === 'pills-multi') {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {q.options.map(opt => (
            <button key={opt} type="button" onClick={() => toggleAnswer(q.id, opt)} style={pill((qualifying[q.id] || []).includes(opt))}>
              {opt}
            </button>
          ))}
        </div>
      );
    }
    if (q.type === 'number') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: c.textMuted, fontSize: 13 }}>£</span>
            <input
              type="number" inputMode="decimal" min="0" step="5"
              value={qualifying[q.id] ?? ''}
              onChange={e => setAnswer(q.id, e.target.value)}
              style={{ ...inputStyle, width: 130, paddingLeft: 24 }}
            />
          </div>
          {q.unit && <span style={{ fontSize: 13, color: c.textMuted }}>{q.unit.replace('£/', 'per ')}</span>}
        </div>
      );
    }
    return (
      <input
        type="text"
        value={qualifying[q.id] || ''}
        placeholder={q.placeholder || ''}
        onChange={e => setAnswer(q.id, e.target.value)}
        style={inputStyle}
      />
    );
  };

  const steps = [
    {
      title: "What's your trade?",
      sub: 'Start typing and pick yours — it shapes the questions we ask and how your AI prices work.',
      canNext: !!trade,
      body: (
        <>
          <Field colors={c} label="Your trade">
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={tradeQuery}
                placeholder="e.g. electrician, roofer, general builder…"
                onChange={e => { setTradeQuery(e.target.value); setTrade(''); }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                autoFocus
                style={{ ...inputStyle, padding: '12px 14px', fontSize: 15 }}
              />
              {searchFocused && !trade && (suggestions.length > 0 || showCustom) && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                  marginTop: 4, background: c.card, border: `1px solid ${c.border}`,
                  borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden',
                }}>
                  {suggestions.map(name => (
                    <button
                      key={name}
                      type="button"
                      onMouseDown={() => pickTrade(name)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '10px 14px', background: 'none', border: 'none',
                        borderBottom: `1px solid ${c.border}`, color: c.text,
                        fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {name}
                    </button>
                  ))}
                  {showCustom && (
                    <button
                      type="button"
                      onMouseDown={() => pickTrade(tradeQuery.trim())}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '10px 14px', background: 'none', border: 'none',
                        color: c.accent, fontSize: 14, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      Use “{tradeQuery.trim()}”
                    </button>
                  )}
                </div>
              )}
            </div>
            {trade && (
              <div style={{ marginTop: 8, fontSize: 13, color: c.accent, fontWeight: 600 }}>
                ✓ {trade}
                <button
                  type="button"
                  onClick={() => { setTrade(''); setTradeQuery(''); }}
                  style={{ marginLeft: 10, background: 'none', border: 'none', color: c.textMuted, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
                >
                  change
                </button>
              </div>
            )}
          </Field>

          <Field colors={c} label="Company name (optional)">
            <input
              type="text"
              value={companyName}
              placeholder="e.g. Bloggs Electrical Ltd"
              onChange={e => setCompanyName(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field colors={c} label="Your logo (optional)" desc="Goes on your quotes and documents — and lets our team set your account up properly.">
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
              background: c.pill, border: `1px dashed ${logoUploaded ? c.accentBorder : c.inputBorder}`,
              color: logoUploaded ? c.accent : c.textMuted, fontSize: 13, fontWeight: 600,
            }}>
              {uploading ? 'Uploading…' : logoUploaded ? '✓ Logo added — click to change it' : 'Upload your logo (PNG or JPG)'}
              <input
                type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files && e.target.files[0]; if (f) uploadLogo(f); e.target.value = ''; }}
              />
            </label>
          </Field>
        </>
      ),
    },
    {
      title: trade ? `A few questions for a ${trade.toLowerCase()}` : 'A few questions',
      sub: 'Quick ones — they tune every estimate to how you actually work.',
      canNext: true,
      body: questions.length === 0
        ? <div style={{ color: c.textMuted, fontSize: 13 }}>Loading questions…</div>
        : questions.map(q => (
            <Field key={q.id} colors={c} label={q.label} desc={q.desc}>
              {renderQuestion(q)}
            </Field>
          )),
    },
    // Only trades the catalogue knows get a rate sheet; a custom trade goes
    // straight from questions to notes.
    ...(rateItems.length > 0 ? [{
      title: 'Your rates for the usual jobs',
      sub: "These are the jobs " + (trade ? 'a ' + trade.toLowerCase() : 'your trade') + " prices every week. Fill in the ones you know — every estimate will use YOUR figure. Leave anything blank and we'll price it with standard UK rates until you tell us otherwise.",
      canNext: true,
      body: (
        <>
          {rateItems.map(item => (
            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: c.text }}>{item.label}</div>
                <div style={{ fontSize: 11.5, color: c.textMuted }}>{item.unit}</div>
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: c.textMuted, fontSize: 13 }}>£</span>
                <input
                  type="number" inputMode="decimal" min="0"
                  value={itemRates[item.key] ?? ''}
                  placeholder={String(item.typical)}
                  onChange={e => setItemRates(r => ({ ...r, [item.key]: e.target.value }))}
                  style={{ ...inputStyle, width: 120, paddingLeft: 24 }}
                />
              </div>
            </div>
          ))}
          <div style={{ fontSize: 12, color: c.textMuted, marginTop: 12, padding: '10px 12px', background: c.pill, borderRadius: 8 }}>
            The grey figures are typical UK rates, not yours — type over them where yours differ. Everything here lands in My Rates, where you can add more jobs or import a full rate spreadsheet any time.
          </div>
        </>
      ),
    }] : []),
    {
      title: 'Anything you want to add?',
      sub: "Anything else we should know — how you like to quote, what you never take on, rates for other trades you use. It all goes to our team and into your AI's memory.",
      canNext: true,
      body: (
        <>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. We never do commercial work. Always add £250 for skip hire on full renovations. Our labourer is £150/day."
            rows={6}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ fontSize: 12, color: c.textMuted, marginTop: 10 }}>
            When you finish, our team is notified and starts tuning your account. You can edit everything later from AI Memory and My Rates.
          </div>
        </>
      ),
    },
  ];

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div style={{ padding: '24px 32px 60px', maxWidth: 680, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Onboarding · step {step + 1} of {steps.length}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.02em' }}>
          {current.title}
        </h1>
        <p style={{ fontSize: 13.5, color: c.textMuted, marginTop: 6, lineHeight: 1.55 }}>
          {current.sub}
        </p>
        {status && status.completed_at && step === 0 && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: c.accentBg, border: `1px solid ${c.accentBorder}`,
            fontSize: 12.5, color: c.accent,
          }}>
            You've completed this before. Submitting again updates your profile and re-alerts our team.
          </div>
        )}
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {steps.map((_, i) => (
          <div key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 999, background: i <= step ? c.accent : c.border, transition: 'all 0.2s' }} />
        ))}
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 24 }}>
        {current.body}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 20, alignItems: 'center' }}>
        <button
          onClick={skip}
          disabled={saving}
          style={{
            padding: '10px 18px', borderRadius: 8,
            background: 'transparent', border: 'none',
            color: c.textMuted, fontSize: 13, fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}
        >
          Skip for now
        </button>
        <div style={{ flex: 1 }} />
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={saving}
            style={{
              padding: '10px 18px', borderRadius: 8,
              background: 'transparent', border: `1px solid ${c.border}`,
              color: c.textMuted, fontSize: 13.5, fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Back
          </button>
        )}
        <button
          onClick={() => last ? save() : setStep(s => s + 1)}
          disabled={saving || !current.canNext}
          style={{
            padding: '10px 22px', borderRadius: 8,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            border: 'none', color: '#0A0F1C',
            fontSize: 13.5, fontWeight: 700,
            cursor: (saving || !current.canNext) ? 'not-allowed' : 'pointer',
            opacity: (saving || !current.canNext) ? 0.6 : 1, fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving...' : last ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}
