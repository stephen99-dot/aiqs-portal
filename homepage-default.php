<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
<!-- Theme (light/dark): applied before paint to avoid a flash of the wrong theme -->
<script>
(function () {
  try {
    var stored = localStorage.getItem('aiqs_theme');
    var theme = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
</script>
<meta name="theme-color" content="#0A0F1C" id="metaThemeColor">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI QS -- AI-Powered Quantity Surveying | Professional BOQs in Hours, Not Days</title>
<meta name="description" content="Get professional Bills of Quantities, cost estimates and feasibility reports powered by AI. Trusted by builders, QS firms and contractors across the UK & Ireland.">
<link rel="canonical" href="https://theaiqs.co.uk/">
<!-- Open Graph / social sharing -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="AI QS">
<meta property="og:title" content="AI QS — Professional BOQs in Minutes, Not Weeks">
<meta property="og:description" content="Upload your drawings and get a professionally formatted Bill of Quantities with accurate UK & Ireland market rates — ready to price, tender, or send to your client.">
<meta property="og:url" content="https://theaiqs.co.uk/">
<meta property="og:image" content="https://theaiqs.co.uk/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="AI QS — Professional BOQs in Minutes, Not Weeks">
<meta name="twitter:description" content="AI-powered quantity surveying for the UK & Ireland. Professional Excel BOQs and Word findings reports, delivered fast.">
<meta name="twitter:image" content="https://theaiqs.co.uk/og-image.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<!-- Meta Pixel + Conversions API (consent-gated) -->
<script>
(function () {
  var PIXEL_ID = '1012573914670280';

  // ---- AI QS CAPI helper: fires Pixel + server-side CAPI together, only with consent ----
  window.AIQS_CAPI = {
    workerUrl: 'https://aiqs-meta-capi.plain-poetry-df76.workers.dev',
    pixelId: PIXEL_ID,
    consent: false,
    newEventId: function () { return 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10); },
    getFbc: function () { var m = document.cookie.match(/_fbc=([^;]+)/); return m ? m[1] : null; },
    getFbp: function () { var m = document.cookie.match(/_fbp=([^;]+)/); return m ? m[1] : null; },
    fire: function (eventName, userData, customData) {
      if (!this.consent) return;            // no tracking without consent
      userData = userData || {}; customData = customData || {};
      var eventId = this.newEventId();
      if (typeof fbq !== 'undefined') { fbq('track', eventName, customData, { eventID: eventId }); }
      var payload = {
        event_name: eventName, event_id: eventId, event_source_url: window.location.href,
        user_data: Object.assign({ fbc: this.getFbc(), fbp: this.getFbp() }, userData),
        custom_data: customData
      };
      fetch(this.workerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true })
        .catch(function (err) { console.warn('CAPI fire failed:', err); });
      return eventId;
    }
  };

  // ---- Inject the Meta Pixel only after consent ----
  var pixelLoaded = false;
  window.AIQS_loadPixel = function () {
    if (pixelLoaded) return; pixelLoaded = true;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
  };

  // ---- Consent storage ----
  function readConsent() { try { return localStorage.getItem('aiqs_consent'); } catch (e) { return null; } }
  function saveConsent(v) { try { localStorage.setItem('aiqs_consent', v); } catch (e) {} }
  function hideBanner() { var b = document.getElementById('cookie-banner'); if (b) b.classList.remove('show'); }

  window.AIQS_grantConsent = function () {
    saveConsent('granted');
    window.AIQS_CAPI.consent = true;
    window.AIQS_loadPixel();
    window.AIQS_CAPI.fire('ViewContent', {}, { content_name: 'Homepage', content_category: 'Landing Page' });
    hideBanner();
  };
  window.AIQS_denyConsent = function () { saveConsent('denied'); window.AIQS_CAPI.consent = false; hideBanner(); };

  // Honour a stored choice on load; otherwise show the banner
  window.addEventListener('DOMContentLoaded', function () {
    var c = readConsent();
    if (c === 'granted') { window.AIQS_grantConsent(); }
    else if (c === 'denied') { window.AIQS_CAPI.consent = false; }
    else { var b = document.getElementById('cookie-banner'); if (b) b.classList.add('show'); }
  });
})();
</script>
<!-- End Meta Pixel -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "AI QS",
  "legalName": "TheAIQS Ltd",
  "url": "https://theaiqs.co.uk/",
  "logo": "https://theaiqs.co.uk/apple-touch-icon.png",
  "description": "AI-powered quantity surveying for the UK and Ireland construction industry. Professional Bills of Quantities, cost estimates and feasibility reports.",
  "areaServed": ["GB", "IE"],
  "telephone": "+44-7534-808399",
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+44-7534-808399",
    "contactType": "sales",
    "areaServed": ["GB", "IE"],
    "availableLanguage": "English"
  }
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What types of projects can you price?",
      "acceptedAnswer": { "@type": "Answer", "text": "We handle residential extensions, new builds, loft conversions, commercial fit-outs, refurbishments, structural steelwork, metalwork fabrication, heritage conversions, and more. If you can draw it, we can price it. For unusual project types, just ask and we'll let you know straight away." }
    },
    {
      "@type": "Question",
      "name": "How accurate are the rates?",
      "acceptedAnswer": { "@type": "Answer", "text": "We use current UK and Ireland market rates, adjusted for location. Rates are benchmarked against live supplier pricing, industry data, and our own rate library built from hundreds of real projects. Every BOQ is sense-checked against real-world cost benchmarks before delivery." }
    },
    {
      "@type": "Question",
      "name": "What format do I receive the BOQ in?",
      "acceptedAnswer": { "@type": "Answer", "text": "You receive a professionally formatted Excel spreadsheet (.xlsx) with your BOQ, plus a Word document (.docx) findings report. Both are ready to use; you can edit them, add your own branding, or send them straight to your client or subcontractors." }
    },
    {
      "@type": "Question",
      "name": "What drawings or information do you need?",
      "acceptedAnswer": { "@type": "Answer", "text": "Plans, elevations, and sections are ideal, but we can work with whatever you have: sketches, photos, even a written brief. The more detail you provide, the more accurate the BOQ. We'll flag anything we need clarification on before pricing." }
    },
    {
      "@type": "Question",
      "name": "Is this fully AI or do humans review it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both. AI handles the heavy lifting: quantity extraction, rate matching, document generation. But every BOQ is reviewed by a human with construction industry experience to catch anything the AI might miss and ensure the output makes sense in the real world." }
    },
    {
      "@type": "Question",
      "name": "Can I get a sample BOQ before committing?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. We can share example deliverables so you can see the quality and format before placing an order. Just get in touch and we'll send you a sample pack." }
    }
  ]
}
</script>
<style>
:root {
  --bg-primary: #0A0F1C;
  --bg-secondary: #111827;
  --bg-card: #161E2E;
  --bg-card-hover: #1C2640;
  --accent: #F59E0B;
  --accent-bright: #FBBF24;
  --accent-dim: #D97706;
  --text-primary: #F8FAFC;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;
  --border: rgba(248,250,252,0.08);
  --border-accent: rgba(245,158,11,0.3);
  --gradient-amber: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
  --gradient-dark: linear-gradient(180deg, #0A0F1C 0%, #111827 100%);
  --shadow-glow: 0 0 60px rgba(245,158,11,0.08);
  --radius: 12px;
  --radius-lg: 20px;
  --font-display: 'DM Serif Display', Georgia, serif;
  --font-body: 'Instrument Sans', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
/* Theme tokens, light palette and the .theme-toggle button now live in
   the shared /assets/theme.css (linked just after this <style> block). */
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
html { scroll-behavior: smooth; font-size: 16px; }
body { font-family: var(--font-body); background: var(--bg-primary); color: var(--text-primary); line-height: 1.7; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; background: rgba(245,158,11,0.1); border: 1px solid var(--border-accent); color: var(--accent); font-size: 0.8rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #10B981; animation: pulse-dot 2s infinite; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }
.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 200; padding: 16px 0; background: var(--nav-bg); backdrop-filter: blur(20px) saturate(1.4); border-bottom: 1px solid var(--border); transition: background 0.3s ease, padding 0.3s ease; }
.nav.scrolled { padding: 10px 0; background: var(--nav-bg-scrolled); }
.nav-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
.nav-logo { display: flex; align-items: center; text-decoration: none; }
.nav-logo .logo-svg { height: 48px; width: auto; transition: opacity 0.2s; }
.nav-logo:hover .logo-svg { opacity: 0.85; }
.nav-links { display: flex; align-items: center; gap: 32px; }
.nav-links a { color: var(--text-secondary); text-decoration: none; font-size: 0.9rem; font-weight: 500; transition: color 0.2s; }
.nav-links a:hover { color: #F59E0B !important; }
.nav-cta { padding: 10px 22px !important; background: var(--gradient-amber) !important; color: var(--on-accent) !important; border-radius: 8px; font-weight: 600 !important; transition: transform 0.2s, box-shadow 0.2s !important; }
.nav-cta:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(245,158,11,0.3); }
.nav-send { color: #F59E0B !important; font-weight: 600 !important; }
.mobile-toggle { display: none; background: none; border: none; color: var(--text-primary); cursor: pointer; padding: 12px; position: relative; z-index: 200; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.mobile-toggle svg { width: 28px; height: 28px; pointer-events: none; display: block; }
.hero { padding: 160px 0 100px; position: relative; overflow: hidden; }
.hero::before { content: ''; position: absolute; top: -200px; right: -200px; width: 800px; height: 800px; background: radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%); pointer-events: none; }
.hero::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent 0%, var(--border) 50%, transparent 100%); }
.hero-content { max-width: 1200px; margin: 0 auto; padding: 0 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
.hero-text { position: relative; z-index: 2; }
.hero h1 { font-family: var(--font-display); font-size: 3.8rem; line-height: 1.1; margin: 20px 0 24px; letter-spacing: -0.02em; }
.hero h1 em { font-style: italic; color: var(--accent); position: relative; }
.hero h1 em::after { content: ''; position: absolute; bottom: 4px; left: 0; right: 0; height: 3px; background: var(--gradient-amber); border-radius: 2px; opacity: 0.4; }
.hero-sub { font-size: 1.15rem; color: var(--text-secondary); max-width: 520px; line-height: 1.75; margin-bottom: 36px; }
.hero-actions { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 48px; }
.btn-primary { display: inline-flex; align-items: center; gap: 10px; padding: 16px 32px; border-radius: 10px; background: var(--gradient-amber); color: var(--on-accent); font-weight: 700; font-size: 1rem; text-decoration: none; border: none; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 2px 20px rgba(245,158,11,0.2); }
.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(245,158,11,0.35); }
.btn-primary svg { width: 18px; height: 18px; }
.btn-secondary { display: inline-flex; align-items: center; gap: 10px; padding: 16px 32px; border-radius: 10px; background: transparent; color: var(--text-primary); font-weight: 600; font-size: 1rem; text-decoration: none; border: 1px solid var(--border); cursor: pointer; transition: all 0.25s ease; }
.btn-secondary:hover { border-color: var(--text-muted); background: var(--surface-subtle); }
.hero-proof { display: flex; align-items: center; gap: 20px; padding-top: 32px; border-top: 1px solid var(--border); }
.hero-proof-stat { text-align: center; }
.hero-proof-stat .num { font-family: var(--font-display); font-size: 1.8rem; color: var(--text-primary); display: block; }
.hero-proof-stat .label { font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.hero-proof-divider { width: 1px; height: 40px; background: var(--border); }
.hero-visual { position: relative; }
.hero-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; box-shadow: var(--shadow-glow); position: relative; }
.hero-card::before { content: ''; position: absolute; inset: -1px; border-radius: var(--radius-lg); background: linear-gradient(135deg, rgba(245,158,11,0.15), transparent 50%, transparent); z-index: -1; pointer-events: none; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.card-header-left { display: flex; align-items: center; gap: 10px; }
.card-dot { width: 8px; height: 8px; border-radius: 50%; }
.card-dot.green { background: #10B981; }
.card-header-title { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); }
.card-status { font-family: var(--font-mono); font-size: 0.72rem; color: #10B981; padding: 4px 10px; background: rgba(16,185,129,0.1); border-radius: 6px; }
.boq-preview-row { display: grid; grid-template-columns: 2fr 0.5fr 0.6fr 0.8fr; padding: 10px 0; font-size: 0.82rem; border-bottom: 1px solid rgba(255,255,255,0.03); }
.boq-preview-row.header { color: var(--text-muted); text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.06em; font-weight: 600; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 4px; }
.boq-preview-row .desc { color: var(--text-secondary); }
.boq-preview-row .qty { text-align: center; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.78rem; }
.boq-preview-row .rate { text-align: right; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.78rem; }
.boq-preview-row .total { text-align: right; color: var(--text-primary); font-family: var(--font-mono); font-size: 0.78rem; font-weight: 600; }
.boq-subtotal { display: flex; justify-content: space-between; margin-top: 12px; padding-top: 14px; border-top: 2px solid var(--accent); }
.boq-subtotal span:first-child { font-weight: 600; color: var(--text-secondary); font-size: 0.85rem; }
.boq-subtotal span:last-child { font-family: var(--font-mono); color: var(--accent); font-weight: 700; font-size: 1rem; }
.floating-badge { position: absolute; padding: 10px 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 8px 30px rgba(0,0,0,0.3); font-size: 0.8rem; animation: float 6s ease-in-out infinite; display: flex; align-items: center; }
.floating-badge.top-right { top: -28px; right: -40px; }
.floating-badge.bottom-left { bottom: -24px; left: -40px; animation-delay: -3s; }
.floating-badge .fb-icon { display: inline-flex; margin-right: 8px; }
.floating-badge .fb-text { color: var(--text-secondary); }
.floating-badge .fb-highlight { color: #10B981; font-weight: 700; }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.trust-bar { padding: 48px 0; border-bottom: 1px solid var(--border); }
.trust-inner { display: flex; align-items: center; justify-content: center; gap: 48px; flex-wrap: wrap; }
.trust-item { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 0.85rem; }
.trust-item svg { width: 20px; height: 20px; opacity: 0.5; }
.trust-item strong { color: var(--text-secondary); }
.pain { padding: 100px 0; position: relative; }
.pain::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); }
.section-label { font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 16px; }
.section-title { font-family: var(--font-display); font-size: 2.6rem; line-height: 1.15; margin-bottom: 16px; letter-spacing: -0.01em; }
.section-sub { font-size: 1.05rem; color: var(--text-secondary); max-width: 600px; line-height: 1.7; }
.pain-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 56px; }
.pain-card { padding: 32px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); transition: all 0.3s ease; position: relative; overflow: hidden; }
.pain-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, #F59E0B, transparent); opacity: 0.5; }
.pain-card:hover { border-color: rgba(239,68,68,0.2); background: var(--bg-card-hover); transform: translateY(-2px); }
.pain-icon { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 12px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.15); margin-bottom: 16px; }
.pain-icon svg { flex-shrink: 0; }
.pain-card h3 { font-family: var(--font-display); font-size: 1.2rem; margin-bottom: 10px; }
.pain-card p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.7; }
.how { padding: 100px 0; background: var(--bg-secondary); position: relative; }
.how::before, .how::after { content: ''; position: absolute; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); }
.how::before { top: 0; } .how::after { bottom: 0; }
.how-header { text-align: center; margin-bottom: 64px; }
.how-header .section-sub { margin: 0 auto; }
.demo-stage { max-width: 920px; margin: 0 auto; opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s ease; }
.demo-stage.visible { opacity: 1; transform: translateY(0); }
.no-js .demo-stage { opacity: 1; transform: none; }
.demo-browser { background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border); overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.4), var(--shadow-glow); }
.demo-browser-bar { display: flex; align-items: center; gap: 8px; padding: 14px 18px; background: rgba(0,0,0,0.25); border-bottom: 1px solid var(--border); }
.demo-dot { width: 10px; height: 10px; border-radius: 50%; }
.demo-dot:nth-child(1) { background: #EF4444; opacity: 0.7; }
.demo-dot:nth-child(2) { background: #F59E0B; opacity: 0.7; }
.demo-dot:nth-child(3) { background: #10B981; opacity: 0.7; }
.demo-url { flex: 1; margin-left: 10px; padding: 6px 14px; border-radius: 6px; background: var(--surface-subtle); font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); }
.demo-body { display: flex; min-height: 460px; }
.demo-sidebar { width: 190px; padding: 18px 12px; border-right: 1px solid var(--border); flex-shrink: 0; }
.demo-sidebar-brand { font-family: var(--font-display); font-size: 14px; color: var(--accent); padding: 0 8px 16px; border-bottom: 1px solid var(--border); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.demo-sidebar-brand svg { width: 16px; height: 16px; fill: var(--accent); }
.demo-nav-item { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 7px; font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 2px; }
.demo-nav-item svg { width: 15px; height: 15px; opacity: 0.5; }
.demo-nav-item.active { background: rgba(245,158,11,0.12); color: var(--accent); }
.demo-nav-item.active svg { opacity: 1; }
.demo-chat { flex: 1; display: flex; flex-direction: column; padding: 18px; overflow: hidden; }
.demo-messages { flex: 1; display: flex; flex-direction: column; gap: 14px; overflow: hidden; }
.demo-msg { display: flex; gap: 10px; opacity: 0; transform: translateY(16px); max-width: 88%; }
.demo-msg.user { align-self: flex-end; flex-direction: row-reverse; }
.demo-msg.ai { align-self: flex-start; }
.demo-avatar { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.demo-msg.user .demo-avatar { background: rgba(59,130,246,0.15); color: #3B82F6; }
.demo-msg.ai .demo-avatar { background: rgba(245,158,11,0.12); color: var(--accent); }
.demo-bubble { padding: 11px 15px; border-radius: 12px; font-size: 12.5px; line-height: 1.55; }
.demo-msg.user .demo-bubble { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.12); border-bottom-right-radius: 4px; }
.demo-msg.ai .demo-bubble { background: var(--surface-subtle); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
.demo-upload { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.1); margin-top: 6px; }
.demo-upload-icon { width: 34px; height: 34px; border-radius: 8px; background: rgba(59,130,246,0.1); display: flex; align-items: center; justify-content: center; }
.demo-upload-icon svg { width: 16px; height: 16px; color: #3B82F6; }
.demo-upload-name { font-size: 11.5px; font-weight: 600; color: var(--text-primary); }
.demo-upload-size { font-size: 10.5px; color: var(--text-muted); }
.demo-typing { display: flex; gap: 4px; padding: 4px 0; }
.demo-typing-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: 0.3; animation: demoPulse 1.4s ease infinite; }
.demo-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.demo-typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes demoPulse { 0%,100% { opacity: 0.2; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.3); } }
.demo-boq { margin-top: 10px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); font-family: var(--font-mono); font-size: 10px; }
.demo-boq-hdr { display: grid; grid-template-columns: 36px 1fr 36px 46px 52px; background: #1B2A4A; padding: 5px 10px; color: rgba(255,255,255,0.85); font-weight: 600; }
.demo-boq-row { display: grid; grid-template-columns: 36px 1fr 36px 46px 52px; padding: 4px 10px; background: var(--bg-card); border-bottom: 1px solid rgba(255,255,255,0.02); color: var(--text-muted); }
.demo-boq-row.sec { background: rgba(214,228,240,0.05); color: var(--text-secondary); font-weight: 600; grid-template-columns: 1fr; }
.demo-boq-row.sub { background: rgba(255,242,204,0.05); color: var(--accent); font-weight: 600; }
.demo-rbadge { display: inline-flex; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: 600; margin-left: 4px; vertical-align: middle; }
.demo-rbadge.v { background: rgba(16,185,129,0.12); color: #10B981; }
.demo-rbadge.g { background: rgba(148,163,184,0.12); color: #94A3B8; }
.demo-dl { display: flex; gap: 8px; margin-top: 10px; }
.demo-dl-btn { display: flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 7px; font-size: 11px; font-weight: 600; border: none; }
.demo-dl-btn.xl { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.15); color: #10B981; }
.demo-dl-btn.wd { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.15); color: #3B82F6; }
.demo-input-bar { display: flex; align-items: center; gap: 10px; padding: 11px 14px; margin-top: 14px; border-radius: 10px; background: var(--surface-subtle); border: 1px solid var(--border); }
.demo-input-bar input { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-family: var(--font-body); font-size: 12.5px; }
.demo-input-bar input::placeholder { color: var(--text-muted); }
.demo-send { width: 30px; height: 30px; border-radius: 8px; background: var(--accent); border: none; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.demo-send svg { width: 14px; height: 14px; color: var(--on-accent); }
.demo-steps { display: flex; justify-content: center; margin-top: 48px; position: relative; }
.demo-step { display: flex; flex-direction: column; align-items: center; width: 200px; position: relative; z-index: 1; }
.demo-step-num { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; font-family: var(--font-mono); background: var(--bg-card); border: 2px solid var(--border); color: var(--text-muted); transition: all 0.6s ease; z-index: 2; position: relative; }
.demo-step.done .demo-step-num { background: rgba(245,158,11,0.12); border-color: var(--accent); color: var(--accent); box-shadow: 0 0 30px rgba(245,158,11,0.1); }
.demo-step-label { margin-top: 12px; font-size: 13px; font-weight: 600; color: var(--text-muted); transition: color 0.6s; }
.demo-step.done .demo-step-label { color: var(--text-primary); }
.demo-step-desc { margin-top: 4px; font-size: 11px; color: var(--text-muted); text-align: center; opacity: 0.6; }
.demo-connector { position: absolute; top: 22px; height: 2px; background: var(--border); z-index: 0; transition: all 0.6s; }
.demo-connector.c1 { left: calc(16.6% + 22px); width: calc(33.3% - 44px); }
.demo-connector.c2 { left: calc(50% + 22px); width: calc(33.3% - 44px); }
.demo-connector.done { background: var(--accent); box-shadow: 0 0 12px rgba(245,158,11,0.15); }
.deliverables { padding: 100px 0; position: relative; }
.del-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 56px; }
.del-card { padding: 36px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); transition: all 0.3s ease; position: relative; overflow: hidden; }
.del-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--gradient-amber); opacity: 0; transition: opacity 0.3s; }
.del-card:hover::before { opacity: 1; }
.del-card:hover { border-color: var(--border-accent); transform: translateY(-3px); box-shadow: var(--shadow-glow); }
.del-icon { width: 52px; height: 52px; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; }
.del-icon svg { flex-shrink: 0; }
.del-icon.excel { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); }
.del-icon.word { background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.2); }
.del-icon.drawings { background: rgba(168,85,247,0.1); border: 1px solid rgba(168,85,247,0.2); }
.del-icon.consult { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); }
.del-card h3 { font-family: var(--font-display); font-size: 1.25rem; margin-bottom: 10px; }
.del-card p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.7; margin-bottom: 16px; }
.del-features { list-style: none; }
.del-features li { padding: 6px 0; font-size: 0.85rem; color: var(--text-secondary); display: flex; align-items: flex-start; gap: 8px; }
.del-features li::before { content: '\2713'; color: var(--accent); font-weight: 700; flex-shrink: 0; margin-top: 1px; }
.comparison { padding: 100px 0; background: var(--bg-secondary); position: relative; }
.comparison::before, .comparison::after { content: ''; position: absolute; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); }
.comparison::before { top: 0; } .comparison::after { bottom: 0; }
.comparison-header { text-align: center; margin-bottom: 56px; }
.comparison-header .section-sub { margin: 0 auto; }
.comp-table { width: 100%; border-collapse: separate; border-spacing: 0; border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--border); }
.comp-table thead th { padding: 20px 24px; text-align: left; font-size: 0.85rem; background: var(--bg-card); border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; }
.comp-table thead th:last-child { color: var(--accent); background: rgba(245,158,11,0.05); }
.comp-table tbody td { padding: 16px 24px; font-size: 0.9rem; border-bottom: 1px solid var(--border); color: var(--text-secondary); }
.comp-table tbody td:last-child { background: rgba(245,158,11,0.03); }
.comp-table tbody tr:last-child td { border-bottom: none; }
.comp-table .check { color: #10B981; font-weight: 700; }
.comp-table .cross { color: #EF4444; opacity: 0.6; }
.comp-table .highlight { color: var(--accent); font-weight: 600; }
.audience { padding: 100px 0; }
.audience-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 56px; }
.audience-card { padding: 36px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); transition: all 0.3s ease; text-align: center; }
.audience-card:hover { border-color: var(--border-accent); transform: translateY(-3px); }
.audience-icon { width: 64px; height: 64px; border-radius: 16px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.15); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
.audience-icon svg { flex-shrink: 0; }
.audience-card h3 { font-family: var(--font-display); font-size: 1.2rem; margin-bottom: 10px; }
.audience-card p { color: var(--text-secondary); font-size: 0.88rem; line-height: 1.7; }
.testimonials { padding: 100px 0; background: var(--bg-secondary); position: relative; }
.testimonials::before, .testimonials::after { content: ''; position: absolute; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); }
.testimonials::before { top: 0; } .testimonials::after { bottom: 0; }
.testimonials-header { text-align: center; margin-bottom: 56px; }
.testimonials-header .section-sub { margin: 0 auto; }
.testimonial-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.testimonial-card { padding: 32px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); transition: all 0.3s ease; }
.testimonial-card:hover { border-color: var(--border-accent); transform: translateY(-2px); }
.testimonial-stars { color: var(--accent); margin-bottom: 16px; font-size: 0.9rem; letter-spacing: 2px; }
.testimonial-card blockquote { font-size: 0.92rem; color: var(--text-secondary); line-height: 1.75; margin-bottom: 20px; font-style: italic; }
.testimonial-author { display: flex; align-items: center; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border); }
.testimonial-avatar { width: 40px; height: 40px; border-radius: 10px; background: var(--gradient-amber); display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--on-accent); font-size: 0.85rem; }
.testimonial-name { font-weight: 600; font-size: 0.88rem; }
.testimonial-role { font-size: 0.78rem; color: var(--text-muted); }
.pricing { padding: 100px 0; }
.pricing-header { text-align: center; margin-bottom: 56px; }
.pricing-header .section-sub { margin: 0 auto; }
.pricing-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; align-items: stretch; }
.pricing-grid.two-col { grid-template-columns: repeat(2, 1fr); max-width: 820px; margin: 0 auto; gap: 24px; }
.pricing-grid.three-col { grid-template-columns: repeat(3, 1fr); max-width: 1080px; margin: 0 auto; gap: 24px; }
.pricing-card { padding: 32px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); display: flex; flex-direction: column; transition: all 0.3s ease; }
.pricing-card.featured { border-color: var(--accent); position: relative; box-shadow: 0 0 40px rgba(245,158,11,0.1); }
.pricing-card.featured::before { content: '\2605 MOST POPULAR \2605'; position: absolute; top: -13px; left: 50%; transform: translateX(-50%); padding: 5px 16px; background: var(--gradient-amber); color: var(--on-accent); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-radius: 6px; white-space: nowrap; }
.pricing-card.popular { border-color: var(--accent); position: relative; box-shadow: 0 0 40px rgba(245,158,11,0.1); }
.pricing-card.popular .pricing-badge { position: absolute; top: -13px; left: 50%; transform: translateX(-50%); padding: 5px 16px; background: var(--gradient-amber); color: var(--on-accent); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-radius: 6px; white-space: nowrap; }
.pricing-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-glow); }
.pricing-tier { font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
.pricing-card h3 { font-family: var(--font-display); font-size: 1.25rem; margin-bottom: 6px; }
.pricing-desc { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 20px; line-height: 1.6; }
.pricing-amount { font-family: var(--font-display); font-size: 2.2rem; margin-bottom: 4px; }
.pricing-amount .currency { font-size: 1.1rem; vertical-align: top; color: var(--text-muted); }
.pricing-amount .period { font-size: 0.82rem; color: var(--text-muted); font-family: var(--font-body); }
.pricing-note { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 20px; }
.pricing-features { list-style: none; flex: 1; margin-bottom: 24px; }
.pricing-features li { padding: 6px 0; font-size: 0.84rem; color: var(--text-secondary); display: flex; align-items: flex-start; gap: 10px; }
.pricing-features li::before { content: '\2713'; color: var(--accent); font-weight: 700; flex-shrink: 0; }
.pricing-features li.excluded { color: var(--text-muted); opacity: 0.5; }
.pricing-features li.excluded::before { content: '\2014'; color: var(--text-muted); }
.pricing-card .btn-primary, .pricing-card .btn-secondary { text-align: center; justify-content: center; width: 100%; padding: 14px 24px; }
.pricing-footnote { text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: 28px; }
.pricing-footnote a { color: var(--accent); text-decoration: none; font-weight: 600; }
.pricing-footnote a:hover { text-decoration: underline; }
.btn-purple { display: inline-flex; align-items: center; gap: 10px; padding: 14px 24px; border-radius: 10px; background: linear-gradient(135deg, #7C3AED, #6D28D9); color: #fff; font-weight: 700; font-size: 1rem; text-decoration: none; border: none; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 2px 20px rgba(124,58,237,0.2); text-align: center; justify-content: center; width: 100%; }
.btn-purple:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(124,58,237,0.35); }
.btn-outline-purple { display: inline-flex; align-items: center; gap: 10px; padding: 14px 24px; border-radius: 10px; background: transparent; color: #A78BFA; font-weight: 600; font-size: 1rem; text-decoration: none; border: 1px solid rgba(124,58,237,0.3); cursor: pointer; transition: all 0.25s ease; text-align: center; justify-content: center; width: 100%; }
.btn-outline-purple:hover { border-color: rgba(124,58,237,0.6); background: rgba(124,58,237,0.05); }
.faq { padding: 100px 0; background: var(--bg-secondary); position: relative; }
.faq::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); }
.faq-header { text-align: center; margin-bottom: 56px; }
.faq-header .section-sub { margin: 0 auto; }
.faq-list { max-width: 760px; margin: 0 auto; }
.faq-item { border-bottom: 1px solid var(--border); }
.faq-question { width: 100%; text-align: left; background: none; border: none; padding: 24px 0; font-family: var(--font-body); font-size: 1rem; font-weight: 600; color: var(--text-primary); cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.faq-question:hover { color: var(--accent); }
.faq-question .faq-icon { font-size: 1.3rem; color: var(--text-muted); transition: transform 0.3s; flex-shrink: 0; }
.faq-item.open .faq-icon { transform: rotate(45deg); color: var(--accent); }
.faq-answer { max-height: 0; overflow: hidden; transition: max-height 0.4s ease, padding 0.3s ease; }
.faq-item.open .faq-answer { max-height: 300px; padding-bottom: 24px; }
.faq-answer p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.8; }
.final-cta { padding: 100px 0; text-align: center; position: relative; overflow: hidden; }
.final-cta::before { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 600px; height: 600px; background: radial-gradient(circle, rgba(245,158,11,0.08), transparent 70%); pointer-events: none; }
.final-cta .section-title { max-width: 600px; margin: 0 auto 16px; }
.final-cta .section-sub { max-width: 500px; margin: 0 auto 40px; }
.final-cta-actions { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.footer { padding: 56px 0 32px; border-top: 1px solid var(--border); }
.footer-inner { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; margin-bottom: 48px; }
.footer-brand .nav-logo { margin-bottom: 20px; }
.footer-brand p { color: var(--text-muted); font-size: 0.85rem; line-height: 1.7; max-width: 300px; }
.footer-col h4 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 16px; font-weight: 600; }
.footer-col a { display: block; padding: 4px 0; color: var(--text-secondary); text-decoration: none; font-size: 0.88rem; transition: color 0.2s; }
.footer-col a:hover { color: var(--accent); }
.footer-bottom { padding-top: 24px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
.footer-bottom p { color: var(--text-muted); font-size: 0.8rem; }
.footer-bottom-links { display: flex; gap: 24px; }
.footer-bottom-links a { color: var(--text-muted); text-decoration: none; font-size: 0.8rem; transition: color 0.2s; }
.footer-bottom-links a:hover { color: var(--text-secondary); }
.fade-in { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s ease; }
.fade-in.visible { opacity: 1; transform: translateY(0); }
.no-js .fade-in { opacity: 1; transform: none; }
@media (max-width: 1024px) {
  .hero h1 { font-size: 3rem; }
  .hero-content { grid-template-columns: 1fr; gap: 48px; }
  .hero-visual { max-width: 500px; }
  .pricing-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .pricing-card.featured { order: -1; }
  .footer-inner { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 768px) {
  .nav-links { display: none; }
  .mobile-toggle { display: flex; align-items: center; justify-content: center; min-width: 48px; min-height: 48px; }
  .nav-links.open {
    display: flex !important; flex-direction: column;
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    width: 100vw; height: 100vh; height: 100dvh;
    background: var(--menu-bg);
    padding: 90px 32px 40px; gap: 0;
    z-index: 199;
    align-items: stretch; justify-content: flex-start;
    overflow-y: auto;
  }
  .nav-links.open a {
    font-size: 1.05rem; color: var(--text-secondary);
    padding: 16px 0; border-radius: 0;
    border: none; border-bottom: 1px solid var(--border);
    background: transparent;
    text-align: left; font-weight: 500;
    transition: color 0.15s; display: block;
  }
  .nav-links.open a:active, .nav-links.open a:hover { color: #F59E0B; background: transparent; }
  .nav-links.open .nav-cta {
    background: linear-gradient(135deg, #F59E0B, #D97706) !important;
    color: #0A0F1C !important;
    border: none !important; border-bottom: none !important;
    margin-top: 20px; font-weight: 700 !important;
    text-align: center; padding: 14px 20px !important;
    border-radius: 10px !important;
  }
  .nav-links.open .nav-send { color: #F59E0B !important; font-weight: 700 !important; }
  .hero { padding: 130px 0 60px; }
  .hero h1 { font-size: 2.3rem; }
  .hero-sub { font-size: 1rem; }
  .section-title { font-size: 2rem; }
  .pain-grid { grid-template-columns: 1fr; }
  .del-grid { grid-template-columns: 1fr; }
  .audience-grid { grid-template-columns: 1fr; }
  .testimonial-grid { grid-template-columns: 1fr; }
  .hero-proof { flex-wrap: wrap; gap: 16px; }
  .hero-proof-divider { display: none; }
  .comp-table { font-size: 0.8rem; }
  .comp-table thead th, .comp-table tbody td { padding: 12px; }
  .footer-inner { grid-template-columns: 1fr; gap: 32px; }
  .floating-badge { display: none; }
  .hero-actions { flex-direction: column; }
  .hero-actions .btn-primary, .hero-actions .btn-secondary { width: 100%; justify-content: center; }
  .pricing-grid { grid-template-columns: 1fr !important; }
    .pricing-grid.two-col { max-width: 420px; }
  .pricing-grid.three-col { max-width: 420px; }
  .demo-sidebar { display: none; }
  .demo-body { min-height: 380px; }
  .demo-steps { flex-direction: column; align-items: center; gap: 20px; }
  .demo-step { flex-direction: row; width: auto; gap: 14px; }
  .demo-step-label { margin-top: 0; }
  .demo-step-desc { display: none; }
  .demo-connector { display: none; }
}
@keyframes waPulse { 0%,100% { transform:scale(1); opacity:.6; } 50% { transform:scale(1.3); opacity:0; } }
#wa-panel.open { display:flex !important; }
@media (max-width:420px) { #wa-panel { right:-16px; left:-280px; width:auto; } }
/* Respect reduced-motion preferences */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
  .fade-in, .demo-stage { opacity: 1 !important; transform: none !important; }
}
/* Cookie consent banner */
.cookie-banner { position: fixed; bottom: 20px; left: 20px; right: 20px; max-width: 540px; margin: 0 auto; z-index: 100000; background: var(--bg-card); border: 1px solid var(--border-accent); border-radius: var(--radius); box-shadow: 0 16px 48px rgba(0,0,0,0.45); padding: 20px 22px; transform: translateY(180%); transition: transform 0.4s ease; }
.cookie-banner.show { transform: translateY(0); }
.cookie-banner p { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 14px; }
.cookie-banner a { color: var(--accent); text-decoration: none; }
.cookie-banner a:hover { text-decoration: underline; }
.cookie-banner-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.cookie-btn { padding: 9px 18px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none; font-family: var(--font-body); transition: transform 0.15s ease; }
.cookie-btn:hover { transform: translateY(-1px); }
.cookie-btn.accept { background: var(--gradient-amber); color: var(--on-accent); }
.cookie-btn.decline { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
.footer-legal { color: var(--text-muted); font-size: 0.75rem; line-height: 1.6; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
@media (max-width:480px) { .cookie-banner { left: 12px; right: 12px; bottom: 12px; padding: 16px; } }
</style>
<link rel="stylesheet" href="/assets/theme.css">
</head>
<body>

<!-- NAV -->
<nav class="nav" id="nav">
  <div class="nav-inner">
    <a href="#" class="nav-logo" aria-label="AI QS Home">
      <svg class="logo-svg" width="160" height="40" viewBox="0 0 156 60" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AI QS — Quantity Surveying">
        <text x="2" y="36" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="40" font-weight="800" letter-spacing="0.5"><tspan fill="#F8FAFC">AI</tspan><tspan fill="#F59E0B"> QS</tspan></text>
        <text x="3" y="54" textLength="150" lengthAdjust="spacingAndGlyphs" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="11" font-weight="600" fill="#94A3B8">QUANTITY SURVEYING</text>
      </svg>
    </a>
    <div class="nav-links" id="navLinks">
      <a href="/send-drawings.html" class="nav-send">Send Drawings</a>
      <a href="#how">How It Works</a>
      <a href="#deliverables">Deliverables</a>
      <a href="#pricing">Pricing</a>
      <a href="/blog/">Blog</a>
      <a href="/officeinabox.html">Office in a Box</a>
      <a href="#faq">FAQ</a>
      <a href="https://aiqs-portal.onrender.com" class="nav-cta" target="_blank" rel="noopener">Login Portal &#8594;</a>
    </div>
    <div class="nav-tools">
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="Switch theme" title="Switch theme">
        <svg class="icon-sun" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        <svg class="icon-moon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      </button>
      <button class="mobile-toggle" id="mobileToggle" aria-label="Menu">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    </div>
  </div>
</nav>

<!-- HERO -->
<section class="hero" id="hero">
  <div class="hero-content">
    <div class="hero-text">
      <div class="badge">AI-Powered Quantity Surveying</div>
      <h1>Professional BOQs<br>in Minutes, <em>Not Weeks</em></h1>
      <p class="hero-sub">Upload your drawings. Get a detailed, professionally formatted Bill of Quantities with accurate UK market rates -- ready to price, tender, or send to your client.</p>
      <div class="hero-actions">
        <a href="/send-drawings.html" class="btn-primary">Get Your BOQ Now <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg></a>
        <a href="#how" class="btn-secondary">See How It Works</a>
      </div>
      <div class="hero-proof">
        <div class="hero-proof-stat"><span class="num">10,000+</span><span class="label">BOQs Delivered</span></div>
        <div class="hero-proof-divider"></div>
        <div class="hero-proof-stat"><span class="num">2 Hrs</span><span class="label">Avg Turnaround</span></div>
        <div class="hero-proof-divider"></div>
        <div class="hero-proof-stat"><span class="num">UK &amp; IE</span><span class="label">Coverage</span></div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="hero-card">
        <div class="card-header">
          <div class="card-header-left"><span class="card-dot green"></span><span class="card-header-title">BOQ -- Residential Extension</span></div>
          <span class="card-status">Complete</span>
        </div>
        <div class="boq-preview-row header"><span>Description</span><span class="qty">Qty</span><span class="rate">Rate</span><span class="total">Total</span></div>
        <div class="boq-preview-row"><span class="desc">Strip foundations 600x250mm</span><span class="qty">18 m</span><span class="rate">&#163;84</span><span class="total">&#163;1,512</span></div>
        <div class="boq-preview-row"><span class="desc">Blockwork below DPC</span><span class="qty">32 m&#178;</span><span class="rate">&#163;62</span><span class="total">&#163;1,984</span></div>
        <div class="boq-preview-row"><span class="desc">100mm concrete floor slab</span><span class="qty">28 m&#178;</span><span class="rate">&#163;48</span><span class="total">&#163;1,344</span></div>
        <div class="boq-preview-row"><span class="desc">Cavity wall insulation</span><span class="qty">56 m&#178;</span><span class="rate">&#163;38</span><span class="total">&#163;2,128</span></div>
        <div class="boq-preview-row"><span class="desc">Roof structure &#8212; cut timber</span><span class="qty">28 m&#178;</span><span class="rate">&#163;95</span><span class="total">&#163;2,660</span></div>
        <div class="boq-subtotal"><span>Section Subtotal</span><span>&#163;9,628.00</span></div>
      </div>
      <div class="floating-badge top-right"><span class="fb-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span><span class="fb-text">Rates: </span><span class="fb-highlight">Live UK &amp; IE Data</span></div>
      <div class="floating-badge bottom-left"><span class="fb-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span><span class="fb-text">Turnaround: </span><span class="fb-highlight">Same Day</span></div>
    </div>
  </div>
</section>

<section class="trust-bar">
  <div class="trust-inner container">
    <div class="trust-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg><span>Trusted by <strong>builders, QS firms &amp; contractors</strong></span></div>
    <div class="trust-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg><span><strong>UK &amp; Ireland</strong> market rates</span></div>
    <div class="trust-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg><span><strong>Professional Excel &amp; Word</strong> deliverables</span></div>
    <div class="trust-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span><strong>2 Hrs</strong> typical turnaround</span></div>
  </div>
</section>

<section class="pain" id="pain">
  <div class="container">
    <div class="section-label">The Problem</div>
    <h2 class="section-title">Traditional QS is<br>Broken for Small Projects</h2>
    <p class="section-sub">You're either waiting weeks for a QS to come back, overpaying for simple jobs, or winging it with rough estimates that lose you money.</p>
    <div class="pain-grid">
      <div class="pain-card fade-in"><span class="pain-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22"/><path d="M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2"/></svg></span><h3>Quotes Take Days or Weeks</h3><p>Your client needs a price now. By the time a traditional QS gets back to you, the job's gone to someone faster. Speed wins tenders.</p></div>
      <div class="pain-card fade-in"><span class="pain-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span><h3>QS Fees Eat Your Margin</h3><p>Paying &#163;1,500--&#163;5,000 for a full QS take-off on a house extension? The maths doesn't work for smaller projects.</p></div>
      <div class="pain-card fade-in"><span class="pain-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 16 14 12"/><path d="M18 16V4"/><path d="M2 20h20"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="10" y1="20" x2="10" y2="10"/></svg></span><h3>Guesswork Costs You Jobs</h3><p>Price too high and you lose the tender. Price too low and you're working for nothing. Without accurate quantities, you're gambling.</p></div>
      <div class="pain-card fade-in"><span class="pain-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg></span><h3>Messy, Inconsistent Docs</h3><p>Scribbled take-offs on the back of an envelope don't win serious clients. You need professional documentation that builds confidence.</p></div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="how" id="how">
  <div class="container">
    <div class="how-header">
      <div class="section-label">How It Works</div>
      <h2 class="section-title">From Drawings to BOQ<br>in Minutes, Not Days</h2>
      <p class="section-sub">Upload your construction drawings, chat with our AI quantity surveyor, and get a professionally formatted Bill of Quantities — complete with your own trained rates.</p>
    </div>
    <div class="demo-stage" id="demoStage">
      <div class="demo-browser">
        <div class="demo-browser-bar">
          <div class="demo-dot"></div><div class="demo-dot"></div><div class="demo-dot"></div>
          <div class="demo-url">portal.theaiqs.co.uk/chat</div>
        </div>
        <div class="demo-body">
          <div class="demo-sidebar">
            <div class="demo-sidebar-brand"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> The AI QS</div>
            <div class="demo-nav-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> Dashboard</div>
            <div class="demo-nav-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Projects</div>
            <div class="demo-nav-item active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Chat</div>
            <div class="demo-nav-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg> My Rates</div>
            <div class="demo-nav-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z"/></svg> AI Memory</div>
          </div>
          <div class="demo-chat">
            <div class="demo-messages" id="demoMessages"></div>
            <div class="demo-input-bar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);flex-shrink:0"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              <input type="text" placeholder="Upload drawings or describe your project..." id="demoInput" readonly>
              <div class="demo-send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></div>
            </div>
          </div>
        </div>
      </div>
      <div class="demo-steps" id="demoSteps">
        <div class="demo-connector c1" id="dConn1"></div>
        <div class="demo-connector c2" id="dConn2"></div>
        <div class="demo-step" id="dStep1"><div class="demo-step-num">1</div><div class="demo-step-label">Upload Drawings</div><div class="demo-step-desc">PDF plans & specs</div></div>
        <div class="demo-step" id="dStep2"><div class="demo-step-num">2</div><div class="demo-step-label">AI Analysis</div><div class="demo-step-desc">Measures & prices everything</div></div>
        <div class="demo-step" id="dStep3"><div class="demo-step-num">3</div><div class="demo-step-label">Documents Ready</div><div class="demo-step-desc">Excel BOQ & Findings Report</div></div>
      </div>
    </div>
  </div>
</section>

<section class="deliverables" id="deliverables">
  <div class="container">
    <div class="section-label">What You Get</div>
    <h2 class="section-title">Professional Deliverables,<br>Not Just Estimates</h2>
    <p class="section-sub">Every project comes with a full documentation pack -- the same standard you'd expect from a chartered QS practice.</p>
    <div class="del-grid">
      <div class="del-card fade-in"><div class="del-icon excel"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="10" y1="9" x2="10" y2="21"/></svg></div><h3>Excel Bill of Quantities</h3><p>Fully itemised, professionally formatted BOQ spreadsheet with measured quantities, rates, and section subtotals.</p><ul class="del-features"><li>Elemental breakdown (substructure, superstructure, finishes, etc.)</li><li>Current UK/IE market rates applied</li><li>Location-adjusted pricing</li><li>Prelims, contingencies &amp; professional fees included</li></ul></div>
      <div class="del-card fade-in"><div class="del-icon word"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg></div><h3>Findings Report</h3><p>Comprehensive Word document explaining the scope, assumptions, exclusions, and any risks identified during analysis.</p><ul class="del-features"><li>Project scope &amp; specification notes</li><li>Building regulations considerations</li><li>Risk flags &amp; procurement advice</li><li>Assumptions &amp; exclusions clearly stated</li></ul></div>
      <div class="del-card fade-in"><div class="del-icon drawings"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A855F7" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div><h3>Annotated Take-Off</h3><p>Marked-up drawings showing exactly what was measured and where, so you can verify every line item in the BOQ.</p><ul class="del-features"><li>Visual measurement references</li><li>Dimension verification</li><li>Area &amp; volume calculations shown</li><li>Cross-referenced to BOQ items</li></ul></div>
      <div class="del-card fade-in"><div class="del-icon consult"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/></svg></div><h3>Follow-Up Support</h3><p>Questions about your BOQ? Need adjustments or alternative specs priced? We're here to make sure you're confident in every number.</p><ul class="del-features"><li>Query resolution included</li><li>Re-pricing for spec changes</li><li>Value engineering suggestions</li><li>Direct access to your QS analyst</li></ul></div>
    </div>
  </div>
</section>

<section class="comparison" id="comparison">
  <div class="container">
    <div class="comparison-header">
      <div class="section-label">Why Switch</div>
      <h2 class="section-title">AI QS vs. Traditional<br>Quantity Surveying</h2>
      <p class="section-sub">Same professional output. Fraction of the cost and turnaround time.</p>
    </div>
    <table class="comp-table">
      <thead><tr><th></th><th>Traditional QS</th><th>AI QS</th></tr></thead>
      <tbody>
        <tr><td>Typical Turnaround</td><td>5--14 days</td><td class="highlight">Same day &#8212; 2 Hrs</td></tr>
        <tr><td>Cost per Project</td><td>&#163;1,500 -- &#163;5,000+</td><td class="highlight">From &#163;58 per BOQ</td></tr>
        <tr><td>Professional Excel BOQ</td><td><span class="check">&#10003;</span></td><td><span class="check">&#10003;</span></td></tr>
        <tr><td>Findings Report</td><td>Sometimes</td><td><span class="check">&#10003;</span> Always included</td></tr>
        <tr><td>Current Market Rates</td><td>Varies by firm</td><td><span class="check">&#10003;</span> Live UK/IE data</td></tr>
        <tr><td>Revisions Included</td><td>Extra charge</td><td><span class="check">&#10003;</span> Included</td></tr>
        <tr><td>Available Evenings &amp; Weekends</td><td><span class="cross">&#10007;</span></td><td><span class="check">&#10003;</span></td></tr>
        <tr><td>Scales to Your Workload</td><td><span class="cross">&#10007;</span></td><td><span class="check">&#10003;</span></td></tr>
      </tbody>
    </table>
  </div>
</section>

<section class="audience" id="audience">
  <div class="container">
    <div class="section-label">Who It's For</div>
    <h2 class="section-title">Built for the People<br>Who Build Things</h2>
    <p class="section-sub">Whether you're a one-man band or managing a pipeline of projects, AI QS fits into your workflow.</p>
    <div class="audience-grid">
      <div class="audience-card fade-in"><div class="audience-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18a1 1 0 001 1h18a1 1 0 001-1v-2a1 1 0 00-1-1H3a1 1 0 00-1 1v2z"/><path d="M10 15V7a2 2 0 012-2v0a2 2 0 012 2v8"/><path d="M6 15v-3.5a6 6 0 0112 0V15"/></svg></div><h3>Builders &amp; Contractors</h3><p>Price jobs faster, win more tenders, and stop losing money on underquoted work. Get professional BOQs without the QS bill.</p></div>
      <div class="audience-card fade-in"><div class="audience-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div><h3>Quantity Surveyors</h3><p>Overflow work? Tight deadline? Use AI QS as your back-office to handle the volume while you focus on client relationships.</p></div>
      <div class="audience-card fade-in"><div class="audience-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div><h3>Architects &amp; Designers</h3><p>Give your clients budget confidence from day one. Include feasibility costs with your design proposals to strengthen your pitch.</p></div>
    </div>
  </div>
</section>

<section class="testimonials" id="testimonials">
  <div class="container">
    <div class="testimonials-header">
      <div class="section-label">Testimonials</div>
      <h2 class="section-title">What Our Clients Say</h2>
      <p class="section-sub">Real feedback from builders, contractors and QS professionals across the UK and Ireland.</p>
    </div>
    <div class="testimonial-grid">
      <div class="testimonial-card fade-in"><div class="testimonial-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><blockquote>"Turned around a full BOQ for a two-storey extension in under 2 hours. The Excel was clean, rates were spot on, and my client was impressed with the findings report. Brilliant service."</blockquote><div class="testimonial-author"><div class="testimonial-avatar">PC</div><div><div class="testimonial-name">Glasgow Stone Contracts</div><div class="testimonial-role">Building Contractor, Glasgow</div></div></div></div>
      <div class="testimonial-card fade-in"><div class="testimonial-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><blockquote>"I use AI QS for overflow work when my own pipeline is backed up. The quality is consistent and the turnaround means I never have to turn a client away. It's like having an extra pair of hands."</blockquote><div class="testimonial-author"><div class="testimonial-avatar">H</div><div><div class="testimonial-name">Harry</div><div class="testimonial-role">Quantity Surveyor, London</div></div></div></div>
      <div class="testimonial-card fade-in"><div class="testimonial-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><blockquote>"We needed steelwork priced quickly for a commercial fit-out. Got a detailed BOQ with fabrication rates, installation costs, the lot. Saved us at least a week versus going through a traditional QS."</blockquote><div class="testimonial-author"><div class="testimonial-avatar">BES</div><div><div class="testimonial-name">Cairns Building Contractor</div><div class="testimonial-role">Commercial Contractors</div></div></div></div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="pricing" id="pricing">
  <div class="container">
    <div class="pricing-header">
      <div class="section-label">Pricing</div>
      <h2 class="section-title">Simple, Transparent Pricing</h2>
      <p class="section-sub">Start chatting for free. Pay as you go, or save with a bundle — the more you buy, the less each BOQ costs. No subscriptions, no lock-in.</p>
    </div>
    <div class="pricing-grid three-col">
      <!-- SINGLE BOQ — £150 -->
      <div class="pricing-card fade-in">
        <div class="pricing-tier">Pay As You Go</div><h3>Single BOQ</h3>
        <p class="pricing-desc">Perfect for one-off jobs. Upload your drawings and only pay when your documents are ready.</p>
        <div class="pricing-amount"><span class="currency">&#163;</span>150<span class="period"> / BOQ</span></div>
        <p class="pricing-note">Chat &amp; measurements are free — you only pay when you generate documents.</p>
        <ul class="pricing-features">
          <li>Full Excel Bill of Quantities</li>
          <li>Word Findings Report</li>
          <li>Current UK &amp; Ireland market rates</li>
          <li>Location-adjusted pricing</li>
          <li>1 revision included</li>

        </ul>
        <div style="margin-top:auto;"><a href="https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g" class="btn-primary" target="_blank" rel="noopener">Get Your BOQ &#8250;</a></div>
      </div>
      <!-- 5 BOQ BUNDLE — £349 -->
      <div class="pricing-card popular fade-in">
        <span class="pricing-badge">&#9733; Most Popular &#9733;</span>
        <div class="pricing-tier">Bundle</div><h3>5 BOQ Bundle</h3>
        <p class="pricing-desc">For builders and contractors pricing jobs regularly. Five BOQs, one simple price.</p>
        <div class="pricing-amount"><span class="currency">&#163;</span>349<span class="period"> / 5 BOQs</span></div>
        <p class="pricing-note" style="color:var(--accent);font-weight:600;">Just &#163;69.80 per BOQ — save &#163;401</p>
        <ul class="pricing-features">
          <li>5 &#215; Excel BOQ + Word Findings Report</li>
          <li>Current UK &amp; Ireland market rates</li>
          <li>Location-adjusted pricing</li>
          <li>1 revision per document</li>
          <li>Credits never expire</li>
          <li>Priority support</li>
        </ul>
        <div style="margin-top:auto;"><a href="https://buy.stripe.com/00w7sLgjSenSdZ6aig73G0h" class="btn-primary" target="_blank" rel="noopener">Get the Bundle &#8250;</a></div>
      </div>
      <!-- 10 BOQ BUNDLE — £580 -->
      <div class="pricing-card popular fade-in">
        <span class="pricing-badge">&#9733; Best Value &#9733;</span>
        <div class="pricing-tier">Bundle</div><h3>10 BOQ Bundle</h3>
        <p class="pricing-desc">Our best per-BOQ rate. For busy builders and QS firms pricing jobs week in, week out.</p>
        <div class="pricing-amount"><span class="currency">&#163;</span>580<span class="period"> / 10 BOQs</span></div>
        <p class="pricing-note" style="color:var(--accent);font-weight:600;">Just &#163;58 per BOQ — save &#163;920</p>
        <ul class="pricing-features">
          <li>10 &#215; Excel BOQ + Word Findings Report</li>
          <li>Current UK &amp; Ireland market rates</li>
          <li>Location-adjusted pricing</li>
          <li>1 revision per document</li>
          <li>Credits never expire</li>
          <li>Priority support</li>
        </ul>
        <div style="margin-top:auto;"><a href="https://buy.stripe.com/9B628raZy2Fa4ow62073G0f" class="btn-primary" target="_blank" rel="noopener">Get the Bundle &#8250;</a></div>
      </div>
    </div>
    <p class="pricing-footnote">Need higher volume or bespoke features? <a href="mailto:hello@crmwizardai.com?subject=Custom%20plan%20enquiry%20%E2%80%94%20AI%20QS">Get in touch</a> for a custom plan.</p>
  </div>
</section>

<!-- FAQ -->
<section class="faq" id="faq">
  <div class="container">
    <div class="faq-header">
      <div class="section-label">FAQ</div>
      <h2 class="section-title">Common Questions</h2>
      <p class="section-sub">Everything you need to know before getting started.</p>
    </div>
    <div class="faq-list">
      <div class="faq-item"><button class="faq-question" aria-expanded="false">What types of projects can you price?<span class="faq-icon">+</span></button><div class="faq-answer"><p>We handle residential extensions, new builds, loft conversions, commercial fit-outs, refurbishments, structural steelwork, metalwork fabrication, heritage conversions, and more. If you can draw it, we can price it. For unusual project types, just ask -- we'll let you know straight away.</p></div></div>
      <div class="faq-item"><button class="faq-question" aria-expanded="false">How accurate are the rates?<span class="faq-icon">+</span></button><div class="faq-answer"><p>We use current UK and Ireland market rates, adjusted for location. Rates are benchmarked against live supplier pricing, industry data, and our own rate library built from hundreds of real projects. Every BOQ is sense-checked against real-world cost benchmarks before delivery.</p></div></div>
      <div class="faq-item"><button class="faq-question" aria-expanded="false">What format do I receive the BOQ in?<span class="faq-icon">+</span></button><div class="faq-answer"><p>You receive a professionally formatted Excel spreadsheet (.xlsx) with your BOQ, plus a Word document (.docx) findings report. Both are ready to use -- you can edit them, add your own branding, or send them straight to your client or subcontractors.</p></div></div>
      <div class="faq-item"><button class="faq-question" aria-expanded="false">What drawings or information do you need?<span class="faq-icon">+</span></button><div class="faq-answer"><p>Plans, elevations, and sections are ideal. But we can work with whatever you have -- sketches, photos, even a written brief. The more detail you provide, the more accurate the BOQ. We'll flag anything we need clarification on before pricing.</p></div></div>
      <div class="faq-item"><button class="faq-question" aria-expanded="false">Is this fully AI or do humans review it?<span class="faq-icon">+</span></button><div class="faq-answer"><p>Both. AI handles the heavy lifting -- quantity extraction, rate matching, document generation. But every BOQ is reviewed by a human with construction industry experience to catch anything the AI might miss and ensure the output makes sense in the real world.</p></div></div>
      <div class="faq-item"><button class="faq-question" aria-expanded="false">Can I get a sample BOQ before committing?<span class="faq-icon">+</span></button><div class="faq-answer"><p>Absolutely. We can share example deliverables so you can see the quality and format before placing an order. Just get in touch and we'll send you a sample pack.</p></div></div>
    </div>
  </div>
</section>

<!-- FINAL CTA -->
<section class="final-cta" id="start">
  <div class="container">
    <div class="badge">Ready to Get Started?</div>
    <h2 class="section-title" style="margin-top:20px;">Get Your First BOQ<br>Today</h2>
    <p class="section-sub">Upload your drawings, tell us about the project, and we'll get your professional BOQ pack started immediately.</p>
    <div class="final-cta-actions">
      <a href="/send-drawings.html" class="btn-primary">Send Your Drawings <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg></a>
      <a href="/send-drawings.html" class="btn-secondary">Request a Sample BOQ</a>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer class="footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <a href="#" class="nav-logo" aria-label="AI QS Home">
          <svg class="logo-svg" width="160" height="40" viewBox="0 0 156 60" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AI QS — Quantity Surveying">
            <text x="2" y="36" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="40" font-weight="800" letter-spacing="0.5"><tspan fill="#F8FAFC">AI</tspan><tspan fill="#F59E0B"> QS</tspan></text>
            <text x="3" y="54" textLength="150" lengthAdjust="spacingAndGlyphs" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="11" font-weight="600" fill="#94A3B8">QUANTITY SURVEYING</text>
          </svg>
        </a>
        <p>AI-powered quantity surveying for the UK and Ireland construction industry. Professional BOQs, cost estimates, and feasibility reports -- delivered fast.</p>
      </div>
      <div class="footer-col"><h4>Service</h4><a href="#how">How It Works</a><a href="#deliverables">Deliverables</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></div>
      <div class="footer-col"><h4>Project Types</h4><a href="#">Residential Extensions</a><a href="#">New Builds</a><a href="#">Commercial Fit-Outs</a><a href="#">Structural Steelwork</a><a href="#">Refurbishments</a></div>
      <div class="footer-col"><h4>Contact</h4><a href="/cdn-cgi/l/email-protection#bed6dbd2d2d1feddccd3c9d7c4dfccdadfd790ddd1d3"><span class="__cf_email__" data-cfemail="c4aca1a8a8ab84a7b6a9b3adbea5b6a0a5adeaa7aba9">[email&#160;protected]</span></a><a href="#">TheAIQS Ltd</a><a href="#">UK &amp; Ireland</a></div>
    </div>
    <p class="footer-legal">THEAIQS Ltd is a company registered in Scotland, company number SC879185. Registered office: 270a Cumbernauld Road, Glasgow, United Kingdom, G31 2UL.</p>
    <div class="footer-bottom">
      <p>&copy; 2026 AI QS -- TheAIQS Ltd. All rights reserved.</p>
      <div class="footer-bottom-links"><a href="/privacy.html">Privacy Policy</a><a href="/terms.html">Terms of Service</a></div>
    </div>
  </div>
</footer>

<!-- Cookie consent banner -->
<div class="cookie-banner" id="cookie-banner" role="dialog" aria-live="polite" aria-label="Cookie consent">
  <p>We use cookies to measure our advertising and improve your experience. You can accept analytics &amp; marketing cookies, or continue with essential cookies only. See our <a href="/privacy.html">Privacy Policy</a>.</p>
  <div class="cookie-banner-actions">
    <button type="button" class="cookie-btn accept" onclick="AIQS_grantConsent()">Accept all</button>
    <button type="button" class="cookie-btn decline" onclick="AIQS_denyConsent()">Essential only</button>
  </div>
</div>

<!-- WHATSAPP WIDGET -->
<div id="wa-widget" style="position:fixed;bottom:24px;right:24px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
  <div id="wa-panel" style="display:none;position:absolute;bottom:72px;right:0;width:360px;max-height:520px;background:#131B2E;border:1px solid #1C2A44;border-radius:20px;box-shadow:0 16px 48px rgba(0,0,0,0.3);flex-direction:column;overflow:hidden">
    <div style="background:#25D366;padding:18px 20px;display:flex;align-items:center;gap:12px">
      <div style="width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      </div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:700;color:#FFF">AI QS</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.8);display:flex;align-items:center;gap:4px">
          <span style="width:6px;height:6px;border-radius:50%;background:#FFF;display:inline-block"></span>
          Usually replies within 1 hour
        </div>
      </div>
      <div onclick="toggleWaPanel()" style="background:rgba(255,255,255,0.2);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
    </div>
    <div style="flex:1;padding:16px;overflow-y:auto;background:#0A0F1C">
      <div style="background:#1C2A44;border-radius:4px 12px 12px 12px;padding:12px 16px;margin-bottom:16px;max-width:85%">
        <p style="margin:0;font-size:14px;color:#E8EDF5;line-height:1.5">Hey! 👋</p>
        <p style="margin:8px 0 0;font-size:14px;color:#94A3B8;line-height:1.5">How can I help? Pick a quick action below or type your own message.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div onclick="aiqsGo('/send-drawings.html')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:#131B2E;border:1px solid #1C2A44;cursor:pointer;text-align:left" onmouseover="this.style.borderColor='#2563EB'" onmouseout="this.style.borderColor='#1C2A44'">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(37,99,235,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          <span style="font-size:14px;font-weight:600;color:#E8EDF5;flex:1">Get a Quote</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B4D66" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div onclick="waQuick('Hi, I have a question about my Bill of Quantities. Can we discuss?')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:#131B2E;border:1px solid #1C2A44;cursor:pointer;text-align:left" onmouseover="this.style.borderColor='#8B5CF6'" onmouseout="this.style.borderColor='#1C2A44'">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(139,92,246,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <span style="font-size:14px;font-weight:600;color:#E8EDF5;flex:1">Question About My BOQ</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B4D66" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div onclick="aiqsGo('/send-drawings.html')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:#131B2E;border:1px solid #1C2A44;cursor:pointer;text-align:left" onmouseover="this.style.borderColor='#F59E0B'" onmouseout="this.style.borderColor='#1C2A44'">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(245,158,11,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
          <span style="font-size:14px;font-weight:600;color:#E8EDF5;flex:1">Send My Drawings</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B4D66" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div onclick="waQuick('Hi, I have an urgent request regarding a project. Are you available?')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:#131B2E;border:1px solid #1C2A44;cursor:pointer;text-align:left" onmouseover="this.style.borderColor='#EF4444'" onmouseout="this.style.borderColor='#1C2A44'">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg></div>
          <span style="font-size:14px;font-weight:600;color:#E8EDF5;flex:1">Urgent Request</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B4D66" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </div>
    <div style="padding:12px 16px;border-top:1px solid #1C2A44;background:#131B2E;display:flex;gap:8px;align-items:center">
      <input id="wa-input" type="text" placeholder="Type a message..." onkeydown="if(event.key==='Enter')waSend()" style="flex:1;padding:10px 14px;border-radius:20px;border:1px solid #1C2A44;background:#0D1320;color:#E8EDF5;font-size:14px;outline:none;font-family:-apple-system,sans-serif">
      <div onclick="waSend()" style="width:40px;height:40px;border-radius:50%;background:#25D366;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </div>
    </div>
    <div style="padding:8px 16px 12px;text-align:center;border-top:1px solid #0D1320">
      <a href="tel:+447534808399" style="font-size:11px;color:#3B4D66;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:4px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3B4D66" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
        +44 7534 808 399 &#183; Prefer a call? Tap to ring
      </a>
    </div>
  </div>
  <div id="wa-btn" style="width:60px;height:60px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(37,211,102,0.45);touch-action:none;user-select:none;cursor:pointer;position:relative">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="white" style="pointer-events:none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    <span id="wa-pulse" style="position:absolute;inset:-4px;border-radius:50%;border:2px solid #25D366;animation:waPulse 2s ease-in-out infinite;pointer-events:none"></span>
  </div>
</div>

<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script>
document.documentElement.classList.remove('no-js');
var nav = document.getElementById('nav');
window.addEventListener('scroll', function() { nav.classList.toggle('scrolled', window.scrollY > 50); });
var mobileToggle = document.getElementById('mobileToggle');
var navLinks = document.getElementById('navLinks');
var menuOpen = false;
mobileToggle.addEventListener('click', function(e) {
  e.preventDefault(); e.stopPropagation(); menuOpen = !menuOpen;
  navLinks.classList.toggle('open', menuOpen);
  mobileToggle.innerHTML = menuOpen
    ? '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    : '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
});
navLinks.addEventListener('click', function(e) {
  if (e.target.tagName === 'A') { menuOpen = false; navLinks.classList.remove('open');
    mobileToggle.innerHTML = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'; }
});
document.querySelectorAll('.faq-question').forEach(function(btn) {
  btn.addEventListener('click', function() { var item = btn.parentElement; var wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(i) { i.classList.remove('open'); var b = i.querySelector('.faq-question'); if (b) b.setAttribute('aria-expanded', 'false'); });
    if (!wasOpen) { item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); } });
});
var observer = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.fade-in').forEach(function(el) { observer.observe(el); });
document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
  anchor.addEventListener('click', function(e) { var href = this.getAttribute('href'); if (href === '#') return;
    e.preventDefault(); var target = document.querySelector(href);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      menuOpen = false; navLinks.classList.remove('open');
      mobileToggle.innerHTML = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'; }
  });
});
var AIQS_REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function aiqsTrack(name, custom) { try { if (window.AIQS_CAPI) window.AIQS_CAPI.fire(name, {}, custom || {}); } catch (e) {} }
function aiqsGo(url) { aiqsTrack('Lead', { content_name: 'Send Drawings (chat widget)' }); window.location.href = url; }
var waOpen = false;
function toggleWaPanel() { waOpen = !waOpen; var p = document.getElementById('wa-panel'); var pulse = document.getElementById('wa-pulse');
  if (waOpen) { p.classList.add('open'); if (pulse) pulse.style.display = 'none'; } else { p.classList.remove('open'); } }
function waQuick(msg) { aiqsTrack('Contact', { content_name: 'WhatsApp quick action' }); window.open('https://wa.me/447534808399?text=' + encodeURIComponent(msg), '_blank'); toggleWaPanel(); }
function waSend() { var input = document.getElementById('wa-input'); var msg = input.value.trim();
  if (msg) { aiqsTrack('Contact', { content_name: 'WhatsApp message' }); window.open('https://wa.me/447534808399?text=' + encodeURIComponent(msg), '_blank'); input.value = ''; toggleWaPanel(); } }
(function() {
  var canvas = document.createElement('canvas'); canvas.id = 'confetti-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999';
  document.body.appendChild(canvas); var ctx = canvas.getContext('2d'); var particles = []; var animating = false;
  var colors = ['#F59E0B','#FBBF24','#D97706','#FCD34D','#10B981','#F8FAFC','#F59E0B','#FBBF24'];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();
  function Particle(x, y) { this.x = x; this.y = y; this.vx = (Math.random() - 0.5) * 16; this.vy = Math.random() * -18 - 4;
    this.gravity = 0.55; this.drag = 0.98; this.size = Math.random() * 8 + 4;
    this.color = colors[Math.floor(Math.random() * colors.length)]; this.rotation = Math.random() * 360;
    this.rotSpeed = (Math.random() - 0.5) * 12; this.alpha = 1; this.shape = Math.random() > 0.5 ? 'rect' : 'circle'; }
  Particle.prototype.update = function() { this.vy += this.gravity; this.vx *= this.drag; this.x += this.vx; this.y += this.vy;
    this.rotation += this.rotSpeed; this.alpha -= 0.008; return this.alpha > 0 && this.y < canvas.height + 20; };
  Particle.prototype.draw = function() { ctx.save(); ctx.globalAlpha = this.alpha; ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation * Math.PI / 180); ctx.fillStyle = this.color;
    if (this.shape === 'rect') { ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size * 0.6); }
    else { ctx.beginPath(); ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); };
  function animate() { if (!animating) return; ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(function(p) { var alive = p.update(); if (alive) p.draw(); return alive; });
    if (particles.length > 0) requestAnimationFrame(animate); else animating = false; }
  function burst(x, y, count) { for (var i = 0; i < (count || 80); i++) particles.push(new Particle(x, y));
    if (!animating) { animating = true; animate(); } }
  if (!AIQS_REDUCE_MOTION) {
    document.querySelectorAll('.btn-primary').forEach(function(btn) {
      btn.addEventListener('click', function(e) { var rect = btn.getBoundingClientRect(); burst(rect.left + rect.width / 2, rect.top + rect.height / 2); }); });
  }
})();
document.getElementById('wa-btn').addEventListener('click', function(e) { if (!e.target.closest('#wa-panel')) toggleWaPanel(); });
var signupShown = false; function showSignupPopup() { if (signupShown) return; signupShown = true; }

// ---- Conversion tracking (consent-gated via AIQS_CAPI.fire) ----
document.addEventListener('click', function(e) {
  var a = e.target.closest('a'); if (!a) return;
  var href = a.getAttribute('href') || '';
  if (href.indexOf('send-drawings') !== -1) {
    aiqsTrack('Lead', { content_name: 'Send Drawings' });
  } else if (href.indexOf('buy.stripe.com') !== -1) {
    var val = 150, name = 'Single BOQ (PAYG)';
    if (href.indexOf('00w7sL') !== -1) { val = 349; name = '5 BOQ Bundle'; }
    else if (href.indexOf('9B628r') !== -1) { val = 580; name = '10 BOQ Bundle'; }
    aiqsTrack('InitiateCheckout', { currency: 'GBP', value: val, content_name: name });
  }
});

// ANIMATED DEMO
(function() {
  var chat = document.getElementById('demoMessages'); var inputEl = document.getElementById('demoInput');
  if (!chat || !inputEl) return;
  var started = false, stageVisible = false, pendingRestart = false;
  var stageObs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) { stageVisible = e.isIntersecting;
      if (e.isIntersecting) { e.target.classList.add('visible');
        if (!started) { started = true; setTimeout(runDemo, 600); }
        else if (pendingRestart) { pendingRestart = false; if (!AIQS_REDUCE_MOTION) runDemo(); } } }); }, { threshold: 0.2 });
  stageObs.observe(document.getElementById('demoStage'));
  document.addEventListener('visibilitychange', function() { if (!document.hidden && stageVisible && pendingRestart) { pendingRestart = false; if (!AIQS_REDUCE_MOTION) runDemo(); } });
  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function addMsg(type, html) {
    var msg = document.createElement('div'); msg.className = 'demo-msg ' + type;
    var av = document.createElement('div'); av.className = 'demo-avatar'; av.textContent = type === 'user' ? 'SC' : 'QS';
    var bub = document.createElement('div'); bub.className = 'demo-bubble'; bub.innerHTML = html;
    msg.appendChild(av); msg.appendChild(bub); chat.appendChild(msg);
    requestAnimationFrame(function() { msg.style.transition = 'opacity 0.5s ease, transform 0.5s ease'; msg.style.opacity = '1'; msg.style.transform = 'translateY(0)'; });
    chat.scrollTop = chat.scrollHeight; return msg; }
  function addTyping() {
    var msg = document.createElement('div'); msg.className = 'demo-msg ai'; msg.id = 'demoTyping';
    msg.innerHTML = '<div class="demo-avatar">QS</div><div class="demo-bubble"><div class="demo-typing"><div class="demo-typing-dot"></div><div class="demo-typing-dot"></div><div class="demo-typing-dot"></div></div></div>';
    msg.style.opacity = '0'; msg.style.transform = 'translateY(16px)'; chat.appendChild(msg);
    requestAnimationFrame(function() { msg.style.transition = 'opacity 0.4s ease, transform 0.4s ease'; msg.style.opacity = '1'; msg.style.transform = 'translateY(0)'; });
    chat.scrollTop = chat.scrollHeight; }
  function removeTyping() { var el = document.getElementById('demoTyping'); if (el) el.remove(); }
  function typeInput(text) { return new Promise(function(resolve) { inputEl.value = ''; var i = 0;
    var iv = setInterval(function() { if (i < text.length) { inputEl.value += text[i]; i++; }
      else { clearInterval(iv); setTimeout(function() { inputEl.value = ''; resolve(); }, 300); } }, 35); }); }
  function markStep(n) { document.getElementById('dStep' + n).classList.add('done');
    if (n > 1) document.getElementById('dConn' + (n - 1)).classList.add('done'); }
  function resetSteps() { [1,2,3].forEach(function(n) { document.getElementById('dStep' + n).classList.remove('done'); });
    [1,2].forEach(function(n) { document.getElementById('dConn' + n).classList.remove('done'); }); }
  var boqHTML = '<div class="demo-boq"><div class="demo-boq-hdr"><span>Item</span><span>Description</span><span>Unit</span><span>Qty</span><span>Total</span></div>'
    + '<div class="demo-boq-row sec">3. Substructure</div>'
    + '<div class="demo-boq-row"><span>3.1</span><span>Strip foundations 600×250 <span class="demo-rbadge v">Verified</span></span><span>m</span><span>18.4</span><span>£1,601</span></div>'
    + '<div class="demo-boq-row"><span>3.2</span><span>Concrete slab 150mm reinforced</span><span>m²</span><span>24.0</span><span>£1,320</span></div>'
    + '<div class="demo-boq-row"><span>3.3</span><span>DPM 1200g polyethylene</span><span>m²</span><span>24.0</span><span>£240</span></div>'
    + '<div class="demo-boq-row sec">4. Superstructure</div>'
    + '<div class="demo-boq-row"><span>4.1</span><span>Cavity wall construction <span class="demo-rbadge v">Verified</span></span><span>m²</span><span>42.6</span><span>£4,601</span></div>'
    + '<div class="demo-boq-row"><span>4.2</span><span>Steel beam UB 203×133 <span class="demo-rbadge g">Generic</span></span><span>nr</span><span>1</span><span>£680</span></div>'
    + '<div class="demo-boq-row sub"><span></span><span></span><span></span><span></span><span>£67,284</span></div></div>';
  var dlHTML = '<div class="demo-dl"><div class="demo-dl-btn xl"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h2M8 17h2M14 13h2M14 17h2"/></svg> BOQ-4-Acresfield.xlsx</div>'
    + '<div class="demo-dl-btn wd"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg> Findings-Report.docx</div></div>';
  async function runDemo() { chat.innerHTML = ''; resetSteps(); await sleep(800);
    await typeInput('Here are the drawings for 4 Acresfield Road');
    addMsg('user', 'Here are the drawings for 4 Acresfield Road — single storey rear extension, cavity wall, flat roof.'
      + '<div class="demo-upload"><div class="demo-upload-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></div>'
      + '<div><div class="demo-upload-name">4-Acresfield-Plans.pdf</div><div class="demo-upload-size">2.4 MB — Floor plan, elevations, sections</div></div></div>');
    markStep(1); await sleep(1400);
    addTyping(); markStep(2); await sleep(3000); removeTyping();
    addMsg('ai', 'I’ve measured the extension at approximately 24.0m² ground floor area with cavity wall construction to three elevations and a flat roof with parapet detail.'
      + '<br><br>External walls total 42.6m² net of openings. I’ve assumed strip foundations at 600×250mm, 18.4m run, with a 150mm reinforced concrete slab.'
      + '<br><br>The total net construction cost comes to <strong>£67,284</strong> with 7.5% contingency and 12% OH&P bringing it to <strong style="color:var(--accent)">£80,856 excluding VAT</strong>.'
      + '<br><br>86 line items across 15 sections. 34 items used your verified rates, the remainder use current UK generic rates.');
    await sleep(2200);
    await typeInput('Generate documents'); addMsg('user', 'Generate documents'); await sleep(900);
    addTyping(); await sleep(2400); removeTyping(); markStep(3);
    addMsg('ai', 'Your documents have been generated for <strong>4 Acresfield Road</strong>. 86 line items across 15 sections, total project value £80,856 (excl. VAT).'
      + '<br><br>Download your Excel BOQ and Findings Report below.' + boqHTML + dlHTML);
    await sleep(9000);
    if (AIQS_REDUCE_MOTION) return;
    if (stageVisible && !document.hidden) { runDemo(); } else { pendingRestart = true; } }
})();
</script>
<script src="/assets/theme.js" defer></script>
</body>
</html>
