<?php
// Visitor country from the hosting layer, used by the country script in
// <head>. Cloudflare sends CF-IPCountry; Apache/nginx GeoIP modules and some
// hosts set their own variable. Nothing set -> the browser works it out from
// its timezone instead.
$aiqsCountry = '';
foreach (['HTTP_CF_IPCOUNTRY', 'GEOIP_COUNTRY_CODE', 'HTTP_X_COUNTRY_CODE', 'HTTP_CLOUDFRONT_VIEWER_COUNTRY'] as $aiqsKey) {
  $aiqsVal = strtoupper(trim((string)($_SERVER[$aiqsKey] ?? '')));
  if (preg_match('/^[A-Z]{2}$/', $aiqsVal) && $aiqsVal !== 'XX' && $aiqsVal !== 'T1') { $aiqsCountry = $aiqsVal; break; }
}
// Exchange rates for the pricing section: live, refreshed once a day and
// cached on disk by fx-rates.php, with its static table as the fallback.
// Printed into the FX table in the country script at the end of <body>.
require_once __DIR__ . '/fx-rates.php';
$aiqsFx = aiqs_fx();
// The page now differs per visitor, so no shared cache may store one
// visitor's copy and serve it to everyone else.
if (!headers_sent()) { header('Cache-Control: private, max-age=0'); }
?>
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
<!-- Country: resolved before paint so a visitor never sees a flash of the
     wrong currency. Order of precedence:
       1. ?country=XX in the URL (also the legacy ?region=uk|au) - remembered
       2. a country the visitor picked from the flag menu before
       3. the country the server saw the request come from (index.php top)
       4. the browser's timezone (reliable, needs no network call)
       5. the browser's language region (en-US -> US)
     Only a manual pick is remembered, so an auto-detected visitor who travels
     is re-detected. Search engine crawlers always get the UK page, so Google
     keeps indexing the site as a UK business whatever its crawler's timezone.
     The page itself is localised by AIQS_setCountry() at the end of <body>. -->
<script>
(function () {
  var Z = {
    'Europe/': 'London GB,Belfast GB,Guernsey GB,Jersey GB,Isle_of_Man GB,Dublin IE,Berlin DE,Busingen DE,Paris FR,Amsterdam NL,Brussels BE,Madrid ES,Ceuta ES,Lisbon PT,Rome IT,Vienna AT,Luxembourg LU,Helsinki FI,Athens GR,Malta MT,Bratislava SK,Ljubljana SI,Tallinn EE,Riga LV,Vilnius LT,Zagreb HR,Zurich CH,Stockholm SE,Oslo NO,Copenhagen DK,Warsaw PL,Prague CZ,Budapest HU,Bucharest RO,Sofia BG,Monaco MC,Andorra AD,Gibraltar GI,Belgrade RS,Sarajevo BA,Skopje MK,Podgorica ME,Tirane AL,Kiev UA,Kyiv UA,Istanbul TR,Chisinau MD,Vaduz LI,San_Marino SM,Vatican VA,Nicosia CY',
    'America/': 'New_York US,Detroit US,Chicago US,Denver US,Phoenix US,Los_Angeles US,Anchorage US,Juneau US,Sitka US,Nome US,Adak US,Boise US,Indianapolis US,Indiana/Indianapolis US,Indiana/Knox US,Kentucky/Louisville US,Louisville US,Menominee US,North_Dakota/Center US,Puerto_Rico US,Toronto CA,Montreal CA,Vancouver CA,Edmonton CA,Winnipeg CA,Regina CA,Swift_Current CA,Halifax CA,Glace_Bay CA,Moncton CA,Goose_Bay CA,St_Johns CA,Whitehorse CA,Dawson_Creek CA,Fort_Nelson CA,Yellowknife CA,Iqaluit CA,Mexico_City MX,Monterrey MX,Cancun MX,Tijuana MX,Merida MX,Chihuahua MX,Hermosillo MX,Mazatlan MX,Matamoros MX,Bahia_Banderas MX,Sao_Paulo BR,Rio_Branco BR,Manaus BR,Fortaleza BR,Recife BR,Bahia BR,Belem BR,Cuiaba BR,Campo_Grande BR,Porto_Velho BR,Maceio BR,Argentina/Buenos_Aires AR,Buenos_Aires AR,Argentina/Cordoba AR,Santiago CL,Bogota CO,Lima PE,Caracas VE,Montevideo UY,Asuncion PY,La_Paz BO,Guayaquil EC,Panama PA,Costa_Rica CR,Guatemala GT,El_Salvador SV,Tegucigalpa HN,Managua NI,Santo_Domingo DO,Jamaica JM,Port_of_Spain TT,Barbados BB,Nassau BS,Cayman KY,Belize BZ,Havana CU',
    'Asia/': 'Dubai AE,Riyadh SA,Qatar QA,Kuwait KW,Bahrain BH,Muscat OM,Singapore SG,Kuala_Lumpur MY,Kuching MY,Hong_Kong HK,Kolkata IN,Calcutta IN,Karachi PK,Manila PH,Jakarta ID,Makassar ID,Jayapura ID,Pontianak ID,Bangkok TH,Ho_Chi_Minh VN,Saigon VN,Tokyo JP,Seoul KR,Shanghai CN,Chongqing CN,Urumqi CN,Taipei TW,Jerusalem IL,Tel_Aviv IL,Dhaka BD,Colombo LK,Kathmandu NP,Katmandu NP,Amman JO,Beirut LB,Baghdad IQ,Tehran IR,Tashkent UZ,Almaty KZ,Baku AZ,Tbilisi GE,Yerevan AM,Macau MO,Brunei BN,Phnom_Penh KH,Yangon MM,Nicosia CY,Famagusta CY,Aden YE',
    'Africa/': 'Johannesburg ZA,Lagos NG,Nairobi KE,Accra GH,Cairo EG,Casablanca MA,Algiers DZ,Tunis TN,Kampala UG,Dar_es_Salaam TZ,Addis_Ababa ET,Kigali RW,Lusaka ZM,Harare ZW,Gaborone BW,Windhoek NA,Maputo MZ,Luanda AO,Abidjan CI,Dakar SN,Douala CM,Kinshasa CD,Khartoum SD,Tripoli LY,Maseru LS,Mbabane SZ,Blantyre MW',
    'Pacific/': 'Auckland NZ,Chatham NZ,Honolulu US,Fiji FJ,Port_Moresby PG,Guam GU,Tahiti PF,Noumea NC,Apia WS,Tongatapu TO',
    'Atlantic/': 'Canary ES,Madeira PT,Azores PT,Reykjavik IS,Bermuda BM',
    'Indian/': 'Mauritius MU,Maldives MV'
  };
  function fromTimezone(tz) {
    if (!tz) return null;
    if (tz.indexOf('Australia/') === 0) return 'AU';
    if (tz.indexOf('US/') === 0) return 'US';
    if (tz.indexOf('Canada/') === 0) return 'CA';
    if (tz === 'NZ') return 'NZ';
    for (var prefix in Z) {
      if (tz.indexOf(prefix) !== 0) continue;
      var list = Z[prefix].split(','), city = tz.slice(prefix.length);
      for (var i = 0; i < list.length; i++) {
        var pair = list[i].split(' ');
        if (pair[0] === city) return pair[1];
      }
    }
    return null;
  }
  function fromLanguage() {
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) {
      var parts = String(langs[i]).split(/[-_]/);
      for (var j = 1; j < parts.length; j++) {
        if (/^[a-zA-Z]{2}$/.test(parts[j])) return parts[j].toUpperCase();
      }
    }
    return null;
  }
  var SERVER_COUNTRY = '<?php echo $aiqsCountry; ?>';   // from the server's IP lookup, may be empty
  var country = null, how = 'default';
  var bot = /bot|crawl|spider|slurp|lighthouse|facebookexternalhit|embedly|preview/i.test(navigator.userAgent || '');
  try {
    var qs = window.location.search;
    var q = (qs.match(/[?&]country=([a-zA-Z]{2})\b/) || [])[1];
    var legacy = (qs.match(/[?&]region=(uk|au)\b/) || [])[1];
    if (!q && legacy) q = legacy === 'au' ? 'AU' : 'GB';
    if (q) { country = q.toUpperCase(); how = 'url'; localStorage.setItem('aiqs_country', country); }
    if (!country) {
      var stored = localStorage.getItem('aiqs_country');
      if (/^[A-Z]{2}$/.test(stored || '')) { country = stored; how = 'picked'; }
      else if (localStorage.getItem('aiqs_region') === 'au') { country = 'AU'; how = 'picked'; }
    }
    if (!country && bot) { country = 'GB'; how = 'bot'; }
    if (!country && /^[A-Z]{2}$/.test(SERVER_COUNTRY)) { country = SERVER_COUNTRY; how = 'ip'; }
    if (!country) {
      country = fromTimezone((window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || '');
      if (country) how = 'timezone';
    }
    if (!country) { country = fromLanguage(); if (country) how = 'language'; }
  } catch (e) { country = null; }
  if (!/^[A-Z]{2}$/.test(country || '')) { country = 'GB'; how = 'default'; }
  window.AIQS_GEO = { country: country, how: how };
  var html = document.documentElement;
  html.setAttribute('data-country', country);
  // Everything that gets localised stays invisible until the body script has
  // filled it in, so a non-UK visitor never sees pounds first. The timeout is
  // a safety net: if that script ever fails, the UK copy shows rather than
  // nothing.
  if (country !== 'GB') {
    html.classList.add('l10n-pending');
    setTimeout(function () { html.classList.remove('l10n-pending'); }, 2500);
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
<meta name="description" content="Get professional Bills of Quantities, cost estimates and feasibility reports powered by AI. Trusted by builders, QS firms and contractors worldwide — priced in your local currency with local market rates and building codes.">
<link rel="canonical" href="https://theaiqs.co.uk/">
<!-- Open Graph / social sharing -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="AI QS">
<meta property="og:title" content="AI QS — Professional BOQs in Minutes, Not Weeks">
<meta property="og:description" content="Upload your drawings and get a professionally formatted Bill of Quantities with accurate local market rates — in your currency, measured to your rules, ready to price, tender, or send to your client.">
<meta property="og:url" content="https://theaiqs.co.uk/">
<meta property="og:image" content="https://theaiqs.co.uk/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="AI QS — Professional BOQs in Minutes, Not Weeks">
<meta name="twitter:description" content="AI-powered quantity surveying worldwide. Professional Excel BOQs and Word findings reports in your local currency, delivered fast.">
<meta name="twitter:image" content="https://theaiqs.co.uk/og-image.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<!-- TrustBox script -->
<script type="text/javascript" src="//widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js" async></script>
<!-- End TrustBox script -->
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
  "sameAs": ["https://aitradespilot.com/", "https://uk.trustpilot.com/review/theaiqs.co.uk"],
  "logo": "https://theaiqs.co.uk/apple-touch-icon.png",
  "description": "AI-powered quantity surveying for construction worldwide. Professional Bills of Quantities, cost estimates and feasibility reports priced in local currency with local market rates.",
  "areaServed": "Worldwide",
  "telephone": "+44-7534-808399",
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+44-7534-808399",
    "contactType": "sales",
    "areaServed": "Worldwide",
    "availableLanguage": "English"
  }
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "serviceType": "Quantity surveying",
  "name": "AI-powered Bills of Quantities, cost estimates and feasibility reports",
  "description": "Upload construction drawings and receive a professionally formatted Bill of Quantities with current local market rates, plus a findings report — same day.",
  "url": "https://theaiqs.co.uk/",
  "provider": { "@type": "Organization", "name": "AI QS", "url": "https://theaiqs.co.uk/" },
  "areaServed": "Worldwide"
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
      "acceptedAnswer": { "@type": "Answer", "text": "We use current local market rates for the country the job is in, adjusted for location. Rates are benchmarked against live supplier pricing, industry data, and our own rate library built from hundreds of real projects. Every BOQ is sense-checked against real-world cost benchmarks before delivery." }
    },
    {
      "@type": "Question",
      "name": "Do you work outside the UK?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. We price projects worldwide, including Ireland, Australia, New Zealand, the US, Canada, South Africa, the Gulf and Europe. Each BOQ is priced in local currency with local market rates, measured to the rules your market uses, and the findings report references your local building codes. Pick your country from the flag menu at the top of the page." }
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
.app-banner { padding: 120px 0 40px; }
.app-banner-inner { max-width: 1200px; margin: 0 auto; padding: 44px 0 0 56px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: center; border-radius: 24px; position: relative; overflow: hidden; min-height: 380px; background: linear-gradient(135deg, #B45309 0%, #D97706 45%, #F59E0B 100%); }
.app-banner-inner::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px); background-size: 56px 56px; pointer-events: none; }

.app-banner-text { position: relative; z-index: 2; padding-bottom: 72px; }
.app-banner-badge { display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; border-radius: 100px; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.28); color: #fff; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 22px; }
.app-banner-text h2 { font-family: var(--font-display); font-size: 2.7rem; line-height: 1.06; letter-spacing: -0.025em; margin-bottom: 14px; color: #fff; }
.app-banner-text h2 em { font-style: italic; color: #FEF3C7; }
.app-banner-text p { color: rgba(255,255,255,0.88); font-size: 1.05rem; line-height: 1.6; max-width: 38ch; margin-bottom: 28px; }

.app-store-btn { display: inline-flex; align-items: center; gap: 12px; padding: 13px 26px; border-radius: 12px; background: #0A0F1C; color: #fff; text-decoration: none; transition: transform 0.2s ease, box-shadow 0.2s ease; }
.app-store-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
.app-store-btn svg { width: 26px; height: 26px; flex-shrink: 0; }
.app-store-btn span { display: flex; flex-direction: column; line-height: 1.15; font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.app-store-btn small { font-size: 0.68rem; font-weight: 500; opacity: 0.85; letter-spacing: 0.02em; }

.app-banner-visual { position: relative; z-index: 2; display: flex; justify-content: center; align-self: end; }
.app-phone { position: relative; width: 260px; margin-bottom: -90px; padding: 12px 12px 0; border-radius: 46px 46px 0 0; background: #1c1c1e; box-shadow: -18px 20px 50px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.12); transform: rotate(-4deg); }
.app-phone img { display: block; width: 100%; height: auto; border-radius: 35px 35px 0 0; }

@media (max-width: 900px) {
  .app-banner { padding: 130px 0 24px; }
  .app-banner-inner { grid-template-columns: 1fr; gap: 8px; padding: 40px 26px 0; text-align: center; min-height: 0; }
  .app-banner-text { padding-bottom: 32px; }
  .app-banner-text p { margin-left: auto; margin-right: auto; }
  .app-banner-text h2 { font-size: 2.1rem; }
  .app-phone { width: 250px; margin-bottom: -40px; transform: rotate(-2deg); }
}
.app-banner { padding: 100px 0 0; }
.app-banner img { display: block; width: 100%; height: auto; border-radius: var(--radius-lg); }
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
.hero { padding: 48px 0 100px; position: relative; overflow: hidden; }
.hero::before { content: ''; position: absolute; top: -200px; right: -200px; width: 800px; height: 800px; background: radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%); pointer-events: none; }
.hero::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent 0%, var(--border) 50%, transparent 100%); }
.hero-content { max-width: 1200px; margin: 0 auto; padding: 0 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
.hero-text { position: relative; z-index: 2; }
.hero h1 { font-family: var(--font-display); font-size: 3.8rem; line-height: 1.1; margin: 20px 0 24px; letter-spacing: -0.02em; }
.hero h1 em { font-style: italic; color: var(--accent); position: relative; }
.hero h1 em::after { content: ''; position: absolute; bottom: 4px; left: 0; right: 0; height: 3px; background: var(--gradient-amber); border-radius: 2px; opacity: 0.4; }
.hero-sub { font-size: 1.15rem; color: var(--text-secondary); max-width: 520px; line-height: 1.75; margin-bottom: 36px; }
.hero-actions { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 48px; }
.btn-primary { display: inline-flex; align-items: center; gap: 10px; padding: 16px 32px; border-radius: 10px; background: var(--gradient-amber); color: var(--bg-primary); font-weight: 700; font-size: 1rem; text-decoration: none; border: none; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 2px 20px rgba(245,158,11,0.2); }
.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(245,158,11,0.35); }
.btn-primary svg { width: 18px; height: 18px; }
.btn-secondary { display: inline-flex; align-items: center; gap: 10px; padding: 16px 32px; border-radius: 10px; background: transparent; color: var(--text-primary); font-weight: 600; font-size: 1rem; text-decoration: none; border: 1px solid var(--border); cursor: pointer; transition: all 0.25s ease; }
.btn-secondary:hover { border-color: var(--text-muted); background: var(--surface-subtle); }
.btn-secondary svg { width: 18px; height: 18px; flex-shrink: 0; }
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
.boq-subtotal span:first-child small { font-weight: 400; color: var(--text-muted); }
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
.demo-boq-hdr { display: grid; grid-template-columns: 36px 1fr 36px 46px 66px; background: #1B2A4A; padding: 5px 10px; color: rgba(255,255,255,0.85); font-weight: 600; }
.demo-boq-row { display: grid; grid-template-columns: 36px 1fr 36px 46px 66px; padding: 4px 10px; background: var(--bg-card); border-bottom: 1px solid rgba(255,255,255,0.02); color: var(--text-muted); }
.demo-boq-row.sec { background: rgba(214,228,240,0.05); color: var(--text-secondary); font-weight: 600; grid-template-columns: 1fr; }
.demo-boq-row.sub { background: rgba(255,242,204,0.05); color: var(--accent); font-weight: 600; }
.demo-rbadge { display: inline-flex; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: 600; margin-left: 4px; vertical-align: middle; }
.demo-rbadge.v { background: rgba(16,185,129,0.12); color: #10B981; }
.demo-rbadge.g { background: rgba(148,163,184,0.12); color: #94A3B8; }
.demo-dl { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.demo-dl-btn { display: flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 7px; font-size: 11px; font-weight: 600; border: none; }
.demo-dl-btn.xl { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.15); color: #10B981; }
.demo-dl-btn.wd { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.15); color: #3B82F6; }
.demo-dl-btn.cc { background: rgba(168,85,247,0.08); border: 1px solid rgba(168,85,247,0.15); color: #A855F7; }
.demo-status { display: inline-flex; align-items: center; gap: 7px; margin-top: 10px; padding: 6px 12px; border-radius: 7px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.15); font-size: 11px; font-weight: 600; color: var(--accent); }
.demo-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: demoPulse 1.4s ease infinite; }
.demo-timeskip { display: flex; align-items: center; gap: 10px; align-self: stretch; max-width: 100%; margin: 2px 0; }
.demo-timeskip::before, .demo-timeskip::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.demo-timeskip span { font-family: var(--font-mono); font-size: 9.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
.demo-input-bar { display: flex; align-items: center; gap: 10px; padding: 11px 14px; margin-top: 14px; border-radius: 10px; background: var(--surface-subtle); border: 1px solid var(--border); }
.demo-input-bar input { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-family: var(--font-body); font-size: 12.5px; }
.demo-input-bar input::placeholder { color: var(--text-muted); }
.demo-send { width: 30px; height: 30px; border-radius: 8px; background: var(--accent); border: none; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.demo-send svg { width: 14px; height: 14px; color: var(--on-accent); }
.demo-steps { display: flex; justify-content: center; margin-top: 48px; position: relative; }
.demo-step { display: flex; flex-direction: column; align-items: center; width: 180px; position: relative; z-index: 1; }
.demo-step-num { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; font-family: var(--font-mono); background: var(--bg-card); border: 2px solid var(--border); color: var(--text-muted); transition: all 0.6s ease; z-index: 2; position: relative; }
.demo-step.done .demo-step-num { background: rgba(245,158,11,0.12); border-color: var(--accent); color: var(--accent); box-shadow: 0 0 30px rgba(245,158,11,0.1); }
.demo-step-label { margin-top: 12px; font-size: 13px; font-weight: 600; color: var(--text-muted); transition: color 0.6s; }
.demo-step.done .demo-step-label { color: var(--text-primary); }
.demo-step-desc { margin-top: 4px; font-size: 11px; color: var(--text-muted); text-align: center; opacity: 0.6; }
.demo-connector { position: absolute; top: 22px; height: 2px; background: var(--border); z-index: 0; transition: all 0.6s; }
.demo-connector.c1 { left: calc(50% - 270px + 22px); width: 136px; }
.demo-connector.c2 { left: calc(50% - 90px + 22px); width: 136px; }
.demo-connector.c3 { left: calc(50% + 90px + 22px); width: 136px; }
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
.pricing-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; align-items: stretch; max-width: 1360px; margin: 0 auto; }
.pricing-grid.two-col { grid-template-columns: repeat(2, 1fr); max-width: 820px; margin: 0 auto; gap: 24px; }
.pricing-grid.three-col { grid-template-columns: repeat(3, 1fr); max-width: 1080px; margin: 0 auto; gap: 24px; }
.pricing-card { padding: 32px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); display: flex; flex-direction: column; transition: all 0.3s ease; }
.pricing-card.featured { border-color: var(--accent); position: relative; box-shadow: 0 0 40px rgba(245,158,11,0.1); }
.pricing-card.featured::before { content: '\2605 MOST POPULAR \2605'; position: absolute; top: -13px; left: 50%; transform: translateX(-50%); padding: 5px 16px; background: var(--gradient-amber); color: var(--on-accent); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-radius: 6px; white-space: nowrap; }
.pricing-card.popular { border-color: var(--accent); position: relative; box-shadow: 0 0 40px rgba(245,158,11,0.1); }
.pricing-card.popular .pricing-badge { position: absolute; top: -13px; left: 50%; transform: translateX(-50%); padding: 5px 16px; background: var(--gradient-amber); color: var(--on-accent); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-radius: 6px; white-space: nowrap; }
.pricing-card.premium { position: relative; border: none; overflow: visible; background: linear-gradient(180deg, rgba(245,158,11,0.06), var(--bg-card) 40%); transform: scale(1.04); z-index: 1; isolation: isolate; }
.pricing-card.premium::after {
  content: ''; position: absolute; inset: -2px; z-index: -1;
  border-radius: calc(var(--radius-lg) + 2px);
  background: conic-gradient(from var(--prem-angle, 0deg), #FBBF24, #D97706, #78350F, #FBBF24, #F59E0B, #FBBF24);
  animation: premSpin 8s linear infinite;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  padding: 2px;
}
.pricing-card.premium::before {
  content: ''; position: absolute; inset: -18px; z-index: -2;
  border-radius: 32px;
  background: radial-gradient(ellipse at center, rgba(245,158,11,0.25), transparent 70%);
  filter: blur(12px);
}
.pricing-card.premium .pricing-badge { padding: 6px 18px; background: linear-gradient(135deg, #78350F, #1C1207 55%, #78350F); color: #FCD34D; border: 1px solid rgba(251,191,36,0.55); box-shadow: 0 4px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(251,191,36,0.25); text-shadow: 0 1px 2px rgba(0,0,0,0.4); letter-spacing: 0.1em; }
.pricing-card.premium .btn-primary {
  background: linear-gradient(135deg, #78350F, #1C1207 55%, #78350F);
  color: #FCD34D;
  border: 1px solid rgba(251,191,36,0.55);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(251,191,36,0.25);
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.pricing-card.premium .btn-primary:hover {
  box-shadow: 0 8px 30px rgba(0,0,0,0.4), inset 0 1px 0 rgba(251,191,36,0.35);
  border-color: rgba(251,191,36,0.8);
}
@property --prem-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@keyframes premSpin { to { --prem-angle: 360deg; } }
.pricing-card.premium:hover { transform: scale(1.04) translateY(-4px); }
.pricing-tier { font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
.pricing-card h3 { font-family: var(--font-display); font-size: 1.25rem; margin-bottom: 6px; }
.pricing-desc { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 20px; line-height: 1.6; min-height: 4.8em; }
.pricing-amount { font-family: var(--font-display); font-size: 2.2rem; margin-bottom: 4px; white-space: nowrap; }
.pricing-amount .currency { font-size: 1.1rem; vertical-align: top; color: var(--text-muted); margin-right: 1px; }
.pricing-amount .period { font-size: 0.82rem; color: var(--text-muted); font-family: var(--font-body); }
.pricing-note { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 20px; min-height: 2.6em; }
.pricing-features { list-style: none; flex: 1; margin-bottom: 24px; }
.pricing-features li { padding: 6px 0; font-size: 0.84rem; color: var(--text-secondary); display: flex; align-items: flex-start; gap: 10px; }
.pricing-features li::before { content: '\2713'; color: var(--accent); font-weight: 700; flex-shrink: 0; }
.pricing-features li.excluded { color: var(--text-muted); opacity: 0.5; }
.pricing-features li.excluded::before { content: '\2014'; color: var(--text-muted); }
.pricing-card .btn-primary, .pricing-card .btn-secondary { text-align: center; justify-content: center; width: 100%; padding: 14px 24px; }
.pricing-footnote { text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: 28px; }
.pricing-footnote a { color: var(--accent); text-decoration: none; font-weight: 600; }
.pricing-footnote a:hover { text-decoration: underline; }
.pricing-billing { font-size: 0.72rem; color: var(--text-muted); text-align: center; margin-top: 10px; line-height: 1.5; }
.pricing-billing[hidden] { display: none; }
/* Exchange-rate note under the prices, non-GBP visitors only. */
.pricing-fx { max-width: 640px; margin: 14px auto 0; text-align: center; color: var(--text-muted); font-size: 0.76rem; line-height: 1.6; }
.pricing-fx a { color: var(--text-secondary); text-decoration: underline; }
.pricing-fx a:hover { color: var(--accent); }
.pricing-fx[hidden] { display: none; }
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
.faq-item.open .faq-answer { max-height: 400px; padding-bottom: 24px; }
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
@media (max-width: 1200px) {
  .hero h1 { font-size: 3rem; }
  .hero-content { grid-template-columns: 1fr; gap: 48px; }
  .hero-visual { max-width: 640px; }
  .pricing-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .pricing-card.featured { order: -1; }
  .footer-inner { grid-template-columns: 1fr 1fr; }
}
/* The full link row needs ~1000px next to the logo and tools; below that
   it switches to the hamburger menu rather than spilling off the right. */
@media (max-width: 1024px) {
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
}
@media (max-width: 768px) {
  .hero { padding: 24px 0 60px; }
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
  .pricing-grid { max-width: 420px; }
  .demo-sidebar { display: none; }
  .demo-body { min-height: 380px; }
  .demo-steps { flex-direction: column; align-items: center; gap: 20px; }
  .demo-step { flex-direction: row; width: auto; gap: 14px; }
  .demo-step-label { margin-top: 0; }
  .demo-step-desc { display: none; }
  .demo-connector { display: none; }
}
/* ── AI chat widget ──────────────────────────────────────────────────────── */
.aiqs-chat { position: fixed; bottom: calc(24px + var(--aiqs-lift, 0px)); right: 24px; z-index: 100001; font-family: var(--font-body); }
.aiqs-chat-launcher { display: flex; align-items: center; justify-content: center; width: 60px; height: 60px; border: none; border-radius: 50%; background: var(--gradient-amber); color: var(--on-accent); cursor: pointer; box-shadow: 0 6px 24px rgba(245,158,11,0.4); position: relative; transition: transform 0.2s ease, box-shadow 0.2s ease; }
.aiqs-chat-launcher:hover { transform: translateY(-2px); box-shadow: 0 10px 32px rgba(245,158,11,0.5); }
.aiqs-chat-launcher svg { width: 28px; height: 28px; pointer-events: none; }
.aiqs-chat-launcher .icon-close { display: none; }
.aiqs-chat.open .aiqs-chat-launcher .icon-chat { display: none; }
.aiqs-chat.open .aiqs-chat-launcher .icon-close { display: block; }
.aiqs-chat-pulse { position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--accent); animation: aiqsPulse 2.4s ease-in-out infinite; pointer-events: none; }
.aiqs-chat.open .aiqs-chat-pulse { display: none; }
@keyframes aiqsPulse { 0%, 100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.28); opacity: 0; } }
.aiqs-chat-panel { position: absolute; bottom: 76px; right: 0; width: 380px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 140px); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: 0 20px 60px rgba(0,0,0,0.35); display: flex; flex-direction: column; overflow: hidden; opacity: 0; visibility: hidden; transform: translateY(12px) scale(0.98); transform-origin: bottom right; transition: opacity 0.22s ease, transform 0.22s ease, visibility 0.22s; }
.aiqs-chat.open .aiqs-chat-panel { opacity: 1; visibility: visible; transform: translateY(0) scale(1); }
.aiqs-chat-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px; background: var(--gradient-amber); color: var(--on-accent); flex-shrink: 0; }
.aiqs-chat-head-avatar { width: 40px; height: 40px; border-radius: 12px; background: rgba(255,255,255,0.22); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.aiqs-chat-head-avatar svg { width: 22px; height: 22px; }
.aiqs-chat-head-title { font-weight: 700; font-size: 0.98rem; line-height: 1.3; }
.aiqs-chat-head-sub { font-size: 0.75rem; opacity: 0.85; display: flex; align-items: center; gap: 6px; }
.aiqs-chat-head-sub::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #10B981; flex-shrink: 0; }
.aiqs-chat-close { margin-left: auto; width: 32px; height: 32px; border: none; border-radius: 50%; background: rgba(255,255,255,0.2); color: var(--on-accent); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.aiqs-chat-close svg { width: 16px; height: 16px; }
.aiqs-chat-log { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.aiqs-msg { display: flex; gap: 9px; max-width: 92%; }
.aiqs-msg.you { align-self: flex-end; flex-direction: row-reverse; }
.aiqs-msg-avatar { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; letter-spacing: -0.02em; flex-shrink: 0; font-family: var(--font-mono); }
.aiqs-msg.ai .aiqs-msg-avatar { background: rgba(245,158,11,0.14); color: var(--accent); }
.aiqs-msg.you .aiqs-msg-avatar { background: rgba(59,130,246,0.14); color: #3B82F6; }
.aiqs-msg-bubble { padding: 10px 14px; border-radius: 12px; font-size: 0.87rem; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.aiqs-msg.ai .aiqs-msg-bubble { background: var(--surface-subtle); border: 1px solid var(--border); border-bottom-left-radius: 4px; color: var(--text-secondary); }
.aiqs-msg.you .aiqs-msg-bubble { background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.18); border-bottom-right-radius: 4px; color: var(--text-primary); }
.aiqs-typing { display: flex; gap: 4px; padding: 4px 2px; }
.aiqs-typing span { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: 0.3; animation: aiqsBlink 1.4s ease infinite; }
.aiqs-typing span:nth-child(2) { animation-delay: 0.2s; }
.aiqs-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes aiqsBlink { 0%, 100% { opacity: 0.2; transform: scale(1); } 50% { opacity: 0.85; transform: scale(1.3); } }
.aiqs-chat-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 18px 12px; flex-shrink: 0; }
.aiqs-chip { padding: 7px 13px; border-radius: 100px; border: 1px solid var(--border-accent); background: rgba(245,158,11,0.07); color: var(--accent); font-family: var(--font-body); font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: background 0.2s ease; }
.aiqs-chip:hover { background: rgba(245,158,11,0.16); }
.aiqs-chip[hidden] { display: none; }
.aiqs-chat-form { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--border); flex-shrink: 0; }
.aiqs-chat-form input { flex: 1; min-width: 0; padding: 11px 15px; border-radius: 100px; border: 1px solid var(--border); background: var(--surface-subtle); color: var(--text-primary); font-family: var(--font-body); font-size: 0.87rem; outline: none; }
.aiqs-chat-form input::placeholder { color: var(--text-muted); }
.aiqs-chat-form input:focus { border-color: var(--border-accent); }
.aiqs-chat-send { width: 40px; height: 40px; border: none; border-radius: 50%; background: var(--gradient-amber); color: var(--on-accent); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 0.2s ease; }
.aiqs-chat-send svg { width: 16px; height: 16px; }
.aiqs-chat-send:disabled { opacity: 0.45; cursor: default; }
.aiqs-chat-foot { padding: 0 14px 12px; text-align: center; flex-shrink: 0; }
.aiqs-chat-foot a { color: var(--text-muted); font-size: 0.7rem; text-decoration: none; }
.aiqs-chat-foot a:hover { color: var(--accent); }
@media (max-width: 480px) {
  .aiqs-chat { bottom: calc(16px + var(--aiqs-lift, 0px)); right: 16px; }
  .aiqs-chat-panel { position: fixed; bottom: calc(88px + var(--aiqs-lift, 0px)); right: 16px; left: 16px; width: auto; max-width: none; height: auto; top: 76px; }
}
/* ── Free first job popup ────────────────────────────────────────────────── */
.aiqs-offer { position: fixed; inset: 0; z-index: 100002; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(3,7,18,0.72); backdrop-filter: blur(4px); opacity: 0; visibility: hidden; transition: opacity 0.3s ease, visibility 0.3s; }
.aiqs-offer.show { opacity: 1; visibility: visible; }
.aiqs-offer-card { position: relative; width: 100%; max-width: 460px; max-height: calc(100vh - 48px); overflow-y: auto; background: var(--bg-card); border: 1px solid var(--border-accent); border-radius: var(--radius-lg); box-shadow: 0 30px 80px rgba(0,0,0,0.5); padding: 40px 36px 32px; text-align: center; transform: translateY(16px) scale(0.97); transition: transform 0.3s ease; }
.aiqs-offer.show .aiqs-offer-card { transform: translateY(0) scale(1); }
.aiqs-offer-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--gradient-amber); border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.aiqs-offer-close { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border: none; border-radius: 50%; background: var(--surface-subtle); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.aiqs-offer-close:hover { color: var(--text-primary); }
.aiqs-offer-close svg { width: 15px; height: 15px; }
.aiqs-offer-badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 14px; border-radius: 100px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.28); color: #10B981; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 18px; }
.aiqs-offer-card h2 { font-family: var(--font-display); font-size: 2rem; line-height: 1.15; letter-spacing: -0.01em; margin-bottom: 14px; }
.aiqs-offer-card h2 em { font-style: italic; color: var(--accent); }
.aiqs-offer-card p { color: var(--text-secondary); font-size: 0.94rem; line-height: 1.7; margin-bottom: 22px; }
.aiqs-offer-list { list-style: none; text-align: left; margin: 0 auto 26px; max-width: 320px; }
.aiqs-offer-list li { display: flex; align-items: flex-start; gap: 10px; padding: 5px 0; font-size: 0.87rem; color: var(--text-secondary); }
.aiqs-offer-list li::before { content: '\2713'; color: var(--accent); font-weight: 700; flex-shrink: 0; }
.aiqs-offer-cta { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 16px 28px; border-radius: 10px; background: var(--gradient-amber); color: var(--on-accent); font-weight: 700; font-size: 1rem; text-decoration: none; box-shadow: 0 2px 20px rgba(245,158,11,0.25); transition: transform 0.2s ease, box-shadow 0.2s ease; }
.aiqs-offer-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(245,158,11,0.4); }
.aiqs-offer-cta svg { width: 18px; height: 18px; }
.aiqs-offer-dismiss { display: block; margin: 14px auto 0; background: none; border: none; color: var(--text-muted); font-family: var(--font-body); font-size: 0.82rem; cursor: pointer; text-decoration: underline; }
.aiqs-offer-dismiss:hover { color: var(--text-secondary); }
.aiqs-offer-fine { margin: 16px 0 0; font-size: 0.72rem; color: var(--text-muted); line-height: 1.5; }
@media (max-width: 480px) {
  .aiqs-offer { padding: 16px; }
  .aiqs-offer-card { padding: 34px 22px 26px; }
  .aiqs-offer-card h2 { font-size: 1.6rem; }
}
/* Respect reduced-motion preferences */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
  .fade-in, .demo-stage { opacity: 1 !important; transform: none !important; }
}
/* ── Trustpilot reviews carousel ───────────────────────────────── */
.tp-reviews { padding: 84px 0 64px; background: var(--bg-secondary); position: relative; overflow: hidden; }
.tp-reviews::before, .tp-reviews::after { content: ''; position: absolute; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); z-index: 4; }
.tp-reviews::before { top: 0; } .tp-reviews::after { bottom: 0; }
.tp-reviews-header { text-align: center; margin-bottom: 36px; }
.tp-reviews-header .section-title { font-size: 2rem; margin-bottom: 10px; }
.tp-reviews-header .section-sub { margin: 0 auto; max-width: 560px; font-size: 0.92rem; }
.tp-reviews-score { display: flex; flex-direction: column; align-items: center; gap: 0; margin-bottom: 16px; min-height: 28px; }
/* The inner anchor exists only for the TrustBox to replace when it renders.
   Until then it must not paint as a bare link. */
#tpScore > a { display: none; }
.tp-reviews-score.tp-live .tp-reviews-badge { display: none; }
.tp-reviews-badge { display: inline-flex; align-items: center; gap: 9px; padding: 7px 18px; border-radius: 100px; background: rgba(245,158,11,0.1); border: 1px solid var(--border-accent); color: var(--accent); font-size: 0.82rem; font-weight: 600; text-decoration: none; transition: background 0.2s ease; }
.tp-reviews-badge:hover { background: rgba(245,158,11,0.18); }

/* Scroll-based carousel: the strip is a real scroll container, so the arrows,
   a trackpad swipe and the auto-advance all drive the same scrollLeft. A CSS
   keyframe marquee cannot share an element with manual controls. */
.tp-marquee { position: relative; overflow-x: auto; overflow-y: hidden; padding: 4px 0; scrollbar-width: none; -ms-overflow-style: none; }
.tp-marquee::-webkit-scrollbar { display: none; }
.tp-carousel { position: relative; }
/* Edge fades are overlay gradients, not mask-image: a mask on a container
   with an animating child repaints every frame instead of compositing. */
.tp-carousel::before, .tp-carousel::after { content: ''; position: absolute; top: 0; bottom: 0; width: 90px; z-index: 2; pointer-events: none; }
.tp-carousel::before { left: 0; background: linear-gradient(90deg, var(--bg-secondary), transparent); }
.tp-carousel::after { right: 0; background: linear-gradient(270deg, var(--bg-secondary), transparent); }
.tp-marquee-track { display: flex; align-items: stretch; gap: 20px; width: max-content; will-change: transform; }

.tp-review { flex: 0 0 340px; padding: 22px 22px 20px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; transition: border-color 0.3s ease, box-shadow 0.3s ease; }
.tp-review:hover { border-color: var(--border-accent); box-shadow: var(--shadow-glow); }
.tp-review-stars { color: var(--accent); font-size: 0.88rem; letter-spacing: 2px; margin-bottom: 10px; }
.tp-review h3 { font-family: var(--font-display); font-size: 1.02rem; line-height: 1.25; margin-bottom: 9px; }
.tp-review blockquote { color: var(--text-secondary); font-size: 0.84rem; line-height: 1.6; margin: 0 0 18px; }
.tp-review-author { display: flex; align-items: center; gap: 11px; margin-top: auto; padding-top: 14px; border-top: 1px solid var(--border); }
.tp-review-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--gradient-amber); color: var(--on-accent); display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; flex-shrink: 0; }
.tp-review-author strong { display: block; font-size: 0.82rem; font-weight: 600; line-height: 1.3; }
.tp-review-author span { font-size: 0.72rem; color: var(--text-muted); }

.tp-arrow { position: absolute; top: 50%; transform: translateY(-50%); z-index: 3; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; box-shadow: 0 4px 18px rgba(0,0,0,0.18); transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease; }
.tp-arrow:hover { color: var(--accent); border-color: var(--border-accent); background: var(--bg-card-hover); }
.tp-arrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.tp-arrow svg { width: 17px; height: 17px; pointer-events: none; }
.tp-arrow.prev { left: 14px; } .tp-arrow.next { right: 14px; }
.no-js .tp-arrow { display: none; }

.tp-reviews-foot { text-align: center; margin-top: 34px; }
.tp-reviews-foot .btn-secondary { white-space: nowrap; padding: 14px 28px; }
.tp-reviews-note { font-family: var(--font-mono); font-size: 0.64rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); margin-top: 14px; }
/* On a phone the carousel earns nothing - the arrows are hidden, the fades eat
   a chunk of a narrow screen, and a horizontal scroller depends on JS having
   seated scrollLeft correctly. Stack the four real cards instead and drop the
   duplicates; the JS sees flex-direction:column and stands down. */
@media (max-width: 640px) {
  .tp-reviews { padding: 56px 0 48px; }
  .tp-reviews-header .section-title { font-size: 1.7rem; }
  .tp-arrow { display: none; }
  .tp-carousel::before, .tp-carousel::after { display: none; }
  .tp-marquee { overflow-x: visible; overflow-y: visible; padding: 0 20px; }
  .tp-marquee-track { flex-direction: column; align-items: stretch; width: auto; gap: 14px; will-change: auto; }
  .tp-marquee-track > [aria-hidden="true"] { display: none; }
  .tp-review { flex: 0 0 auto; width: 100%; }
}
/* ── Trustpilot review collector ─────────────────────────────────────────── */
.tp-collect { padding: 56px 0 100px; }
.tp-collect-card { max-width: 720px; margin: 0 auto; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; transition: border-color 0.3s ease, box-shadow 0.3s ease; }
.tp-collect-card:hover { border-color: var(--border-accent); box-shadow: var(--shadow-glow); }
.tp-collect-card::before { content: ''; display: block; height: 3px; background: var(--gradient-amber); }
.tp-collect-body { padding: 40px 36px 34px; text-align: center; }
.tp-collect-label { font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 12px; }
.tp-collect-body h3 { font-family: var(--font-display); font-size: 1.5rem; line-height: 1.2; margin-bottom: 10px; }
.tp-collect-body p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.7; max-width: 46ch; margin: 0 auto 22px; }
.tp-collect-btn { display: inline-flex; align-items: center; gap: 10px; padding: 15px 30px; border-radius: 10px; background: var(--gradient-amber); color: var(--on-accent); font-weight: 700; font-size: 0.98rem; text-decoration: none; box-shadow: 0 2px 20px rgba(245,158,11,0.2); transition: transform 0.2s ease, box-shadow 0.2s ease; }
.tp-collect-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(245,158,11,0.35); }
.tp-collect-btn svg { width: 17px; height: 17px; }
.tp-collect-btn:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: 3px; }
.tp-collect-foot { padding: 11px 20px; border-top: 1px solid var(--border); font-family: var(--font-mono); font-size: 0.66rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); text-align: center; }
@media (max-width: 480px) {
  .tp-collect { padding-bottom: 60px; }
  .tp-collect-body { padding: 26px 20px 22px; }
  .tp-collect-body h3 { font-size: 1.3rem; }
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
.footer-legal { color: var(--text-muted); font-size: 0.75rem; line-height: 1.6; margin-bottom: 16px; }
@media (max-width:480px) { .cookie-banner { left: 12px; right: 12px; bottom: 12px; padding: 16px; } }
/* ── Country / currency ──────────────────────────────────────────────────── */
/* <html data-country="XX"> is set before paint (see the head script) and the
   page is localised by AIQS_setCountry() at the end of <body>. Until then the
   localised bits are held invisible for non-UK visitors so nobody sees GBP
   flash up first. */
.l10n-pending [data-l10n], .l10n-pending .l10n-block { visibility: hidden; }
.nav-tools { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: 20px; }
.nav-links a { white-space: nowrap; }
/* A visible pill (flag + currency) with the real <select> laid invisibly over
   it: the native picker is searchable by typing, works with screen readers and
   gives phones their own wheel/sheet, while the pill stays compact. */
.region-picker { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 100px; border: 1px solid var(--border); background: var(--surface-subtle); color: var(--text-secondary); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; line-height: 1; transition: border-color 0.2s ease, color 0.2s ease; flex-shrink: 0; }
.region-picker:hover { border-color: var(--border-accent); color: var(--text-primary); }
.region-picker:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.region-picker .flag { font-size: 0.95rem; line-height: 1; display: inline-flex; align-items: center; }
.region-picker .flag svg { width: 15px; height: 15px; }
.region-picker .chev { width: 10px; height: 10px; opacity: 0.6; }
.region-picker select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font-size: 16px; border: 0; -webkit-appearance: none; appearance: none; }
.region-picker select option { color: #0A0F1C; background: #fff; }
@media (max-width: 1400px) {
  .nav-links { gap: 20px; }
  .nav-links a { font-size: 0.86rem; }
  .nav-cta { padding: 9px 16px !important; }
}
@media (max-width: 1100px) {
  .nav-links { gap: 14px; }
  .nav-links a { font-size: 0.82rem; }
  .region-picker { padding: 6px 8px; }
}
@media (max-width: 768px) {
  .nav-links.open a { font-size: 1.05rem; }
}
@media (max-width: 480px) {
  .nav-tools { margin-left: 8px; gap: 6px; }
  .region-picker { padding: 6px 8px; gap: 5px; }
}
/* Small phones: shrink the logo and gutters so the menu button stays on screen. */
@media (max-width: 400px) {
  .nav-inner { padding: 0 16px; }
  .nav-logo .logo-svg { height: 40px; }
}
@media (max-width: 340px) {
  .region-picker .cur { display: none; }
}
.mkt-section { padding: 100px 0; background: var(--bg-secondary); position: relative; }
.mkt-section::before, .mkt-section::after { content: ''; position: absolute; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); }
.mkt-section::before { top: 0; } .mkt-section::after { bottom: 0; }
.mkt-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 48px; }
.mkt-card { padding: 28px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); transition: border-color 0.3s ease, transform 0.3s ease; }
.mkt-card:hover { border-color: var(--border-accent); transform: translateY(-2px); }
.mkt-card h3 { font-family: var(--font-display); font-size: 1.15rem; margin-bottom: 8px; }
.mkt-card p { color: var(--text-secondary); font-size: 0.88rem; line-height: 1.7; }
.mkt-card .pain-icon { margin-bottom: 14px; }
.mkt-factors { margin-top: 40px; padding: 28px 32px; background: var(--bg-card); border: 1px solid var(--border-accent); border-radius: var(--radius-lg); display: flex; flex-wrap: wrap; align-items: center; gap: 18px 28px; }
.mkt-factors h3 { font-family: var(--font-display); font-size: 1.15rem; flex: 1 1 260px; }
.mkt-factors h3 small { display: block; font-family: var(--font-body); font-size: 0.82rem; color: var(--text-muted); margin-top: 4px; font-weight: 400; }
.mkt-factor-list { display: flex; flex-wrap: wrap; gap: 8px; flex: 2 1 420px; }
.mkt-factor-list span { padding: 6px 12px; border-radius: 100px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.18); color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.72rem; }
.mkt-switch { margin-top: 22px; font-size: 0.85rem; color: var(--text-muted); }
.mkt-switch button { background: none; border: none; padding: 0; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; }
.mkt-switch button:hover { text-decoration: underline; }
@media (max-width: 900px) { .mkt-grid { grid-template-columns: 1fr; } }
</style>
<link rel="stylesheet" href="/assets/theme.css">
</head>
<body>

<!-- NAV -->
<nav class="nav" id="nav">
  <div class="nav-inner">
    <a href="#" class="nav-logo" aria-label="AI QS Home">
      <svg class="logo-svg" width="160" height="40" viewBox="0 0 156 60" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AI QS — Quantity Surveying">
        <text x="2" y="36" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="40" font-weight="800" letter-spacing="0.5"><tspan fill="currentColor">AI</tspan><tspan fill="#F59E0B"> QS</tspan></text>
        <text x="3" y="54" textLength="150" lengthAdjust="spacingAndGlyphs" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="11" font-weight="600" fill="#94A3B8">QUANTITY SURVEYING</text>
      </svg>
    </a>
    <div class="nav-links" id="navLinks">
      <a href="/send-drawings.html" class="nav-send">Send Drawings</a>
      <a href="#how">How It Works</a>
      <a href="#deliverables">Deliverables</a>
      <a href="#pricing">Pricing</a>
      <a href="/blog/">Blog</a>
      <a href="https://aitradespilot.com/" target="_blank" rel="noopener">AI Trades Pilot</a>
      <a href="#faq">FAQ</a>
      <a href="https://aiqs-portal.onrender.com" class="nav-cta" target="_blank" rel="noopener">Login Portal &#8594;</a>
    </div>
    <div class="nav-tools">
      <label class="region-picker l10n-block" id="regionPicker" title="Your country and currency">
        <span class="flag" id="regionFlag" aria-hidden="true">&#127468;&#127463;</span>
        <span class="cur" id="regionCur" aria-hidden="true">GBP</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        <select id="regionSelect" aria-label="Choose your country and currency">
          <option value="GB" selected>United Kingdom — GBP</option>
        </select>
      </label>
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
<!-- APP BANNER -->
<section class="app-banner">
  <div class="app-banner-inner">
    <div class="app-banner-text">
      <span class="app-banner-badge">Coming Soon</span>
      <h2>The AI QS app is<br>coming to <em>iPhone</em></h2>
      <p>Submit drawings and get your priced BOQ back the same day &#8212; now from your pocket.</p>
      <a href="mailto:hello@theaiqs.com?subject=Notify%20me%20%E2%80%94%20AI%20QS%20iPhone%20app" class="app-store-btn" id="appStoreBtn">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.94c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.42-.14-2.76.83-3.48.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.89-3.75 2.26-1.6 2.78-.41 6.89 1.15 9.14.76 1.1 1.67 2.34 2.86 2.29 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 2.99.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.39-.92-2.41-3.64zM14.76 5.5c.63-.77 1.06-1.83.94-2.9-.91.04-2.01.61-2.67 1.37-.59.68-1.1 1.76-.96 2.8 1.01.08 2.05-.52 2.69-1.27z"/></svg>
        <span><small>Notify me when it's</small>Live on the App Store</span>
      </a>
    </div>
    <div class="app-banner-visual">
      <div class="app-phone">
        <img src="/app-screen.png" alt="The AI QS app showing a project dashboard with documents ready to download">
      </div>
    </div>
  </div>
</section>
<!-- HERO -->
<section class="hero" id="hero">
  <div class="hero-content">
    <div class="hero-text">
      <div class="badge">AI-Powered Quantity Surveying</div>
      <h1>Professional BOQs<br>in Minutes, <em>Not Weeks</em></h1>
      <p class="hero-sub">Upload your drawings. Get a detailed, professionally formatted Bill of Quantities with accurate <span data-l10n="heroRates">UK market rates</span> -- ready to price, tender, or send to your client.</p>
      <div class="hero-actions">
        <a href="/send-drawings.html" class="btn-primary">Get Your BOQ Now <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg></a>
        <a href="#how" class="btn-secondary">See How It Works</a>
      </div>
      <div class="hero-proof">
        <div class="hero-proof-stat"><span class="num">10,000+</span><span class="label">BOQs Delivered</span></div>
        <div class="hero-proof-divider"></div>
        <div class="hero-proof-stat"><span class="num">2 Hrs</span><span class="label">Avg Turnaround</span></div>
        <div class="hero-proof-divider"></div>
        <div class="hero-proof-stat"><span class="num">Global</span><span class="label">Local Rates &amp; Codes</span></div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="hero-card">
        <div class="card-header">
          <div class="card-header-left"><span class="card-dot green"></span><span class="card-header-title" data-l10n="heroCardTitle">BOQ -- Residential Extension</span></div>
          <span class="card-status">Complete</span>
        </div>
        <div class="boq-preview-row header"><span>Description</span><span class="qty">Qty</span><span class="rate">Rate</span><span class="total">Total</span></div>
        <!-- Rebuilt for the visitor's country by AIQS_setCountry(); the UK
             example below is what shows without JavaScript. -->
        <div id="heroBoq" class="l10n-block">
          <div class="boq-preview-row"><span class="desc">Strip foundations 600x250mm</span><span class="qty">18 m</span><span class="rate">&#163;84</span><span class="total">&#163;1,512</span></div>
          <div class="boq-preview-row"><span class="desc">Blockwork below DPC</span><span class="qty">32 m&#178;</span><span class="rate">&#163;62</span><span class="total">&#163;1,984</span></div>
          <div class="boq-preview-row"><span class="desc">100mm concrete floor slab</span><span class="qty">28 m&#178;</span><span class="rate">&#163;48</span><span class="total">&#163;1,344</span></div>
          <div class="boq-preview-row"><span class="desc">Cavity wall insulation</span><span class="qty">56 m&#178;</span><span class="rate">&#163;38</span><span class="total">&#163;2,128</span></div>
          <div class="boq-preview-row"><span class="desc">Roof structure &#8212; cut timber</span><span class="qty">28 m&#178;</span><span class="rate">&#163;95</span><span class="total">&#163;2,660</span></div>
          <div class="boq-subtotal"><span>Section Subtotal <small>ex VAT</small></span><span>&#163;9,628.00</span></div>
        </div>
      </div>
      <div class="floating-badge top-right"><span class="fb-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span><span class="fb-text">Rates: </span><span class="fb-highlight" data-l10n="liveData">Live UK Data</span></div>
      <div class="floating-badge bottom-left"><span class="fb-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span><span class="fb-text">Turnaround: </span><span class="fb-highlight">Same Day</span></div>
    </div>
  </div>
</section>

<section class="trust-bar">
  <div class="trust-inner container">
    <div class="trust-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg><span>Trusted by <strong>builders, QS firms &amp; contractors</strong></span></div>
    <div class="trust-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg><span data-l10n="trustRates"><strong>UK</strong> market rates</span></div>
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
      <div class="pain-card fade-in"><span class="pain-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span><h3>QS Fees Eat Your Margin</h3><p>Paying <span data-l10n="qsFee">&#163;1,500&#8211;&#163;5,000</span> for a full QS take-off on a house extension? The maths doesn't work for smaller projects.</p></div>
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
      <h2 class="section-title">Submit Your Drawings.<br>Full BOQ Back Same Day.</h2>
      <p class="section-sub">Send us your construction drawings and we produce a full detailed Bill of Quantities and Findings Report the same day — then generate a polished client copy to send straight on to your client.</p>
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
              <input type="text" placeholder="Submit your drawings to get started..." id="demoInput" readonly>
              <div class="demo-send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></div>
            </div>
          </div>
        </div>
      </div>
      <div class="demo-steps" id="demoSteps">
        <div class="demo-connector c1" id="dConn1"></div>
        <div class="demo-connector c2" id="dConn2"></div>
        <div class="demo-connector c3" id="dConn3"></div>
        <div class="demo-step" id="dStep1"><div class="demo-step-num">1</div><div class="demo-step-label">Submit Drawings</div><div class="demo-step-desc">Plans, elevations & specs</div></div>
        <div class="demo-step" id="dStep2"><div class="demo-step-num">2</div><div class="demo-step-label">We Get to Work</div><div class="demo-step-desc">Full detailed take-off & pricing</div></div>
        <div class="demo-step" id="dStep3"><div class="demo-step-num">3</div><div class="demo-step-label">Same-Day Delivery</div><div class="demo-step-desc">Excel BOQ & Findings Report</div></div>
        <div class="demo-step" id="dStep4"><div class="demo-step-num">4</div><div class="demo-step-label">Client Copy</div><div class="demo-step-desc">Ready to send to your client</div></div>
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
      <div class="del-card fade-in"><div class="del-icon excel"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="10" y1="9" x2="10" y2="21"/></svg></div><h3>Excel Bill of Quantities</h3><p>Fully itemised, professionally formatted BOQ spreadsheet with measured quantities, rates, and section subtotals.</p><ul class="del-features"><li data-l10n="del1">Elemental breakdown to NRM2 (substructure, superstructure, finishes, etc.)</li><li data-l10n="del2">Current UK market rates applied</li><li data-l10n="del3">Location-adjusted pricing</li><li data-l10n="del4">Prelims, contingencies &amp; professional fees included</li></ul></div>
      <div class="del-card fade-in"><div class="del-icon word"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg></div><h3>Findings Report</h3><p>Comprehensive Word document explaining the scope, assumptions, exclusions, and any risks identified during analysis.</p><ul class="del-features"><li>Project scope &amp; specification notes</li><li data-l10n="delCodes">Building Regulations considerations</li><li>Risk flags &amp; procurement advice</li><li>Assumptions &amp; exclusions clearly stated</li></ul></div>
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
        <tr><td>Cost per Project</td><td><span data-l10n="compFee">&#163;1,500&#8211;&#163;5,000+</span></td><td class="highlight"><span data-l10n="compFrom">From &#163;49 per BOQ</span></td></tr>
        <tr><td>Professional Excel BOQ</td><td><span class="check">&#10003;</span></td><td><span class="check">&#10003;</span></td></tr>
        <tr><td>Findings Report</td><td>Sometimes</td><td><span class="check">&#10003;</span> Always included</td></tr>
        <tr><td>Current Market Rates</td><td>Varies by firm</td><td><span class="check">&#10003;</span> <span data-l10n="compLive">Live UK data</span></td></tr>
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

<!-- LOCAL MARKET — rebuilt for the visitor's country by AIQS_setCountry().
     The UK version below is what shows without JavaScript. -->
<section class="mkt-section" id="local">
  <div class="container">
    <div class="section-label" data-l10n="mktLabel">&#127468;&#127463; United Kingdom</div>
    <h2 class="section-title" data-l10n="mktTitle">Built for UK<br>Construction</h2>
    <p class="section-sub" data-l10n="mktSub">Measured, priced and reported the way UK builders, QSs and building control expect &#8212; with rates that know the difference between Kensington and Kendal.</p>
    <div class="mkt-grid l10n-block" id="mktGrid">
      <div class="mkt-card"><h3>Priced in GBP, ex VAT</h3><p>Every rate and total is in pounds sterling. VAT is shown separately, with the reduced and zero rates flagged where conversions and new builds qualify, so the bill drops straight into a JCT contract, a tender or a client budget.</p></div>
      <div class="mkt-card"><h3>Regional Location Factors</h3><p>London and the South East cost more than the North East, and Scotland, Wales and Northern Ireland each price differently. Give us the postcode and the factor is applied for you.</p></div>
      <div class="mkt-card"><h3>Measured to NRM2</h3><p>Quantities follow the RICS New Rules of Measurement, with NRM1 elemental cost categories, so any chartered QS can check the bill line by line.</p></div>
      <div class="mkt-card"><h3>Building Regulations</h3><p>The findings report flags the Approved Documents that drive cost: Part A structure, Part B fire safety, Part L and the Future Homes Standard, Part F ventilation and Part M access.</p></div>
      <div class="mkt-card"><h3>UK Build Methods</h3><p>Cavity wall masonry and timber frame, strip and trench-fill foundations, beam-and-block floors, warm and cold flat roofs, loft conversions and steel beams.</p></div>
      <div class="mkt-card"><h3>Site Conditions Costed In</h3><p>Restricted access, party wall matters, conservation areas and listed buildings, poor ground and drainage diversions all change what a job costs.</p></div>
    </div>
    <div class="mkt-factors fade-in">
      <h3>Location factors we apply <small>Tell us the site address and the right one is applied automatically</small></h3>
      <div class="mkt-factor-list l10n-block" id="mktFactors">
        <span>London</span><span>South East</span><span>East of England</span><span>South West</span><span>Midlands</span><span>North West</span><span>Yorkshire &amp; Humber</span><span>North East</span><span>Wales</span><span>Scotland</span><span>Northern Ireland</span>
      </div>
    </div>
    <p class="mkt-switch">Not in <span data-l10n="mktThe">the UK</span>? <button type="button" id="mktSwitch">Choose your country</button> and the whole site switches to your currency, rates and codes.</p>
  </div>
</section>

<!-- TRUSTPILOT REVIEWS -->
<section class="tp-reviews" id="reviews">

  <div class="container">
    <div class="tp-reviews-header">
      <div class="tp-reviews-score">
        <!-- TrustBox widget - Micro Review Count.
             The "trustpilot-widget" class is added by JS only once a real
             template id is present - the bootstrap script auto-renders anything
             carrying that class, and a placeholder id renders as a broken frame. -->
        <div id="tpScore"
             data-locale="en-GB"
             data-template-id="REPLACE_MICRO_TEMPLATE_ID"
             data-businessunit-id="6a8dae58312dbcc386ebcad8"
             data-style-height="28px"
             data-style-width="260px">
          <a href="https://uk.trustpilot.com/review/theaiqs.co.uk" target="_blank" rel="noopener">Trustpilot</a>
        </div>
        <a class="tp-reviews-badge" href="https://uk.trustpilot.com/review/theaiqs.co.uk" target="_blank" rel="noopener">Rated on Trustpilot &#8594;</a>
      </div>
      <h2 class="section-title">Trusted by Construction Professionals</h2>
      <p class="section-sub">Every review below is public on Trustpilot &#8212; we can't edit or remove any of it.</p>
    </div>
  </div>

  <div class="tp-carousel">
    <button type="button" class="tp-arrow prev" id="tpPrev" aria-label="Previous reviews">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>

    <div class="tp-marquee" id="tpMarquee" tabindex="0" role="region" aria-label="Customer reviews">
      <div class="tp-marquee-track" id="tpTrack">
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Highly Recommend</h3>
          <blockquote>At first I was curious to see how it was going to work, so I cross-referenced the first job against another QS and my own calculations. The results were practically identical, but much cheaper and with a far better service. The turnaround time is incredible.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">RS</span>
            <span><strong>Russell Stewart</strong><span>Building Contractor</span></span>
          </div>
        </div>
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Superb Service &amp; System</h3>
          <blockquote>AI QS have been fantastic to work with and even implemented specific features we requested. Everything is turned around incredibly quickly.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">LS</span>
            <span><strong>Lee Scroxton</strong><span>Construction Company Owner</span></span>
          </div>
        </div>
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Takes The Pressure Off</h3>
          <blockquote>The guys at AI QS provide a great service. They've genuinely taken the pressure off my company and allowed us to price more work faster.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">CU</span>
            <span><strong>Verified Customer</strong><span>Builder</span></span>
          </div>
        </div>
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>One Of The Best Services</h3>
          <blockquote>One of the best services I have ever used. Fast, accurate and exactly what we needed to streamline our quoting process.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">PW</span>
            <span><strong>Paul Woolfit</strong><span>Contractor</span></span>
          </div>
        </div>
        <div class="tp-review">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Highly Recommend</h3>
          <blockquote>At first I was curious to see how it was going to work, so I cross-referenced the first job against another QS and my own calculations. The results were practically identical, but much cheaper and with a far better service. The turnaround time is incredible.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">RS</span>
            <span><strong>Russell Stewart</strong><span>Building Contractor</span></span>
          </div>
        </div>
        <div class="tp-review">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Superb Service &amp; System</h3>
          <blockquote>AI QS have been fantastic to work with and even implemented specific features we requested. Everything is turned around incredibly quickly.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">LS</span>
            <span><strong>Lee Scroxton</strong><span>Construction Company Owner</span></span>
          </div>
        </div>
        <div class="tp-review">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Takes The Pressure Off</h3>
          <blockquote>The guys at AI QS provide a great service. They've genuinely taken the pressure off my company and allowed us to price more work faster.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">CU</span>
            <span><strong>Verified Customer</strong><span>Builder</span></span>
          </div>
        </div>
        <div class="tp-review">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>One Of The Best Services</h3>
          <blockquote>One of the best services I have ever used. Fast, accurate and exactly what we needed to streamline our quoting process.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">PW</span>
            <span><strong>Paul Woolfit</strong><span>Contractor</span></span>
          </div>
        </div>
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Highly Recommend</h3>
          <blockquote>At first I was curious to see how it was going to work, so I cross-referenced the first job against another QS and my own calculations. The results were practically identical, but much cheaper and with a far better service. The turnaround time is incredible.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">RS</span>
            <span><strong>Russell Stewart</strong><span>Building Contractor</span></span>
          </div>
        </div>
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Superb Service &amp; System</h3>
          <blockquote>AI QS have been fantastic to work with and even implemented specific features we requested. Everything is turned around incredibly quickly.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">LS</span>
            <span><strong>Lee Scroxton</strong><span>Construction Company Owner</span></span>
          </div>
        </div>
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>Takes The Pressure Off</h3>
          <blockquote>The guys at AI QS provide a great service. They've genuinely taken the pressure off my company and allowed us to price more work faster.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">CU</span>
            <span><strong>Verified Customer</strong><span>Builder</span></span>
          </div>
        </div>
        <div class="tp-review" aria-hidden="true">
          <div class="tp-review-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <h3>One Of The Best Services</h3>
          <blockquote>One of the best services I have ever used. Fast, accurate and exactly what we needed to streamline our quoting process.</blockquote>
          <div class="tp-review-author">
            <span class="tp-review-avatar">PW</span>
            <span><strong>Paul Woolfit</strong><span>Contractor</span></span>
          </div>
        </div>
      </div>
    </div>

    <button type="button" class="tp-arrow next" id="tpNext" aria-label="More reviews">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>

  <div class="container">
    <div class="tp-reviews-foot">
      <a href="https://uk.trustpilot.com/review/theaiqs.co.uk" class="btn-secondary" target="_blank" rel="noopener">Read every review on Trustpilot <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg></a>
      <p class="tp-reviews-note">Individual reviews shown &#183; See the profile for our current rating</p>
    </div>
  </div>

</section>

<!-- TRUSTPILOT REVIEW COLLECTOR -->
<section class="tp-collect" id="leave-review">
  <div class="container">
    <div class="tp-collect-card fade-in" id="tpCollectCard">

      <div class="tp-collect-body">
        <div class="tp-collect-label">Leave a review</div>
        <h3>Had a BOQ off us?</h3>
        <p>Reviews go straight to Trustpilot &#8212; we can't edit them, delete them or choose which ones show. Takes a minute, and it helps the next builder deciding whether we're worth a go.</p>

        <div class="tp-collect-widget">
          <a class="tp-collect-btn" href="https://uk.trustpilot.com/evaluate/theaiqs.co.uk" target="_blank" rel="noopener">
            Review us on Trustpilot
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
          </a>

        </div>
      </div>

      <div class="tp-collect-foot">Independently verified &middot; Not editable by us</div>

    </div>
  </div>
</section>

<!-- PRICING — amounts, per-BOQ notes and billing notes are filled in for the
     visitor's currency by AIQS_setCountry(), converting the GBP prices at the
     live exchange rate fx-rates.php printed into the page. The GBP figures
     below are the no-JavaScript fallback and the price actually charged at
     checkout. -->
<section class="pricing" id="pricing">
  <div class="container">
    <div class="pricing-header">
      <div class="section-label">Pricing</div>
      <h2 class="section-title">Simple, Transparent Pricing</h2>
      <p class="section-sub" data-l10n="pricingSub">Start chatting for free. Pay as you go, or save with a bundle — the more you buy, the less each BOQ costs. No subscriptions, no lock-in.</p>
    </div>
    <div class="pricing-grid">
      <!-- SINGLE Job — £150 -->
      <div class="pricing-card fade-in">
        <div class="pricing-tier">Pay As You Go</div><h3>Single Job</h3>
        <p class="pricing-desc">Perfect for one-off jobs. Upload your drawings and only pay when your documents are ready.</p>
        <div class="pricing-amount l10n-block" data-tier="0"><span class="currency">&#163;</span><span class="amt">150</span><span class="period"> / BOQ</span></div>
        <p class="pricing-note">Chat &amp; measurements are free — you only pay when you generate documents.</p>
        <ul class="pricing-features">
          <li>Full Excel Bill of Quantities</li>
          <li>Word Findings Report</li>
          <li data-l10n="featRates">Current UK market rates</li>
          <li data-l10n="featLoc">Location-adjusted pricing</li>
          <li>1 revision included</li>
        </ul>
        <div style="margin-top:auto;"><a href="https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g" data-tier="0" data-plan="Single BOQ (PAYG)" class="btn-primary" target="_blank" rel="noopener">Get Your BOQ &#8250;</a><p class="pricing-billing" data-tier="0" hidden></p></div>
      </div>
      <!-- 5 Job Package — £349 -->
      <div class="pricing-card popular fade-in">
        <span class="pricing-badge">&#9733; Most Popular &#9733;</span>
        <div class="pricing-tier">Bundle</div><h3>5 Job Package</h3>
        <p class="pricing-desc">For builders and contractors pricing jobs regularly. Five BOQs, one simple price.</p>
        <div class="pricing-amount l10n-block" data-tier="1"><span class="currency">&#163;</span><span class="amt">349</span><span class="period"> / 5 BOQs</span></div>
        <p class="pricing-note l10n-block" style="color:var(--accent);font-weight:600;" data-tier="1">Just &#163;69.80 per BOQ — save &#163;401</p>
        <ul class="pricing-features">
          <li>5 &#215; Excel BOQ + Word Findings Report</li>
          <li data-l10n="featRates">Current UK market rates</li>
          <li data-l10n="featLoc">Location-adjusted pricing</li>
          <li>Unlimited revisions per job</li>
          <li>Credits never expire</li>
          <li>Access to our AI QS portal</li>
          <li>Generate client copies with your own colours &amp; logo</li>
          <li>Priority support</li>
        </ul>
        <div style="margin-top:auto;"><a href="https://buy.stripe.com/00w7sLgjSenSdZ6aig73G0h" data-tier="1" data-plan="5 BOQ Bundle" class="btn-primary" target="_blank" rel="noopener">Get the Bundle &#8250;</a><p class="pricing-billing" data-tier="1" hidden></p></div>
      </div>
      <!-- 10 Job Package — £580 -->
      <div class="pricing-card popular fade-in">
        <span class="pricing-badge">&#9733; Best Value &#9733;</span>
        <div class="pricing-tier">Bundle</div><h3>10 Job Package</h3>
        <p class="pricing-desc">For busy builders and QS firms pricing jobs week in, week out.</p>
        <div class="pricing-amount l10n-block" data-tier="2"><span class="currency">&#163;</span><span class="amt">580</span><span class="period"> / 10 BOQs</span></div>
        <p class="pricing-note l10n-block" style="color:var(--accent);font-weight:600;" data-tier="2">Just &#163;58 per BOQ — save &#163;920</p>
        <ul class="pricing-features">
          <li>10 &#215; Excel BOQ + Word Findings Report</li>
          <li data-l10n="featRates">Current UK market rates</li>
          <li data-l10n="featLoc">Location-adjusted pricing</li>
          <li>Unlimited revisions per job</li>
          <li>Credits never expire</li>
          <li>Access to our AI QS portal</li>
          <li>Generate client copies with your own colours &amp; logo</li>
          <li>Priority support</li>
        </ul>
        <div style="margin-top:auto;"><a href="https://buy.stripe.com/9B628raZy2Fa4ow62073G0f" data-tier="2" data-plan="10 BOQ Bundle" class="btn-primary" target="_blank" rel="noopener">Get the Bundle &#8250;</a><p class="pricing-billing" data-tier="2" hidden></p></div>
      </div>
      <!-- 20 Job Package — £980 -->
      <div class="pricing-card popular premium fade-in">
        <span class="pricing-badge">&#9733; Most For Your Money &#9733;</span>
        <div class="pricing-tier">Bundle</div><h3>20 Job Package</h3>
        <p class="pricing-desc">For firms with a steady pipeline of jobs to price</p>
        <div class="pricing-amount l10n-block" data-tier="3"><span class="currency">&#163;</span><span class="amt">980</span><span class="period"> / 20 BOQs</span></div>
        <p class="pricing-note l10n-block" style="color:var(--accent);font-weight:600;" data-tier="3">Just &#163;49 per BOQ — save &#163;2,020</p>
        <ul class="pricing-features">
          <li>20 &#215; Excel BOQ + Word Findings Report</li>
          <li data-l10n="featRates">Current UK market rates</li>
          <li data-l10n="featLoc">Location-adjusted pricing</li>
          <li>Unlimited revisions per job</li>
          <li>Credits never expire</li>
          <li>Access to our AI QS portal</li>
          <li>Generate client copies with your own colours &amp; logo</li>
          <li>Priority support</li>
        </ul>
        <div style="margin-top:auto;"><a href="https://buy.stripe.com/cNi4gz6Ji4Ni3ks2PO73G0l" data-tier="3" data-plan="20 BOQ Bundle" class="btn-primary" target="_blank" rel="noopener">Get the Bundle &#8250;</a><p class="pricing-billing" data-tier="3" hidden></p></div>
      </div>
    </div>
    <p class="pricing-footnote">Need higher volume or bespoke features? <a href="mailto:hello@theaiqs.com?subject=Custom%20plan%20enquiry%20%E2%80%94%20AI%20QS">Get in touch</a> for a custom plan.</p>
    <!-- Exchange-rate note, filled in by renderPricing() for non-GBP visitors. -->
    <p class="pricing-fx l10n-block" id="fxNote" hidden></p>
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
      <div class="faq-item"><button class="faq-question" aria-expanded="false">How accurate are the rates?<span class="faq-icon">+</span></button><div class="faq-answer"><p>We use current <span data-l10n="faqRates">UK market rates, adjusted for location</span>. Rates are benchmarked against live supplier pricing, industry data, and our own rate library built from hundreds of real projects. Every BOQ is sense-checked against real-world cost benchmarks before delivery.</p></div></div>
      <div class="faq-item"><button class="faq-question" aria-expanded="false"><span data-l10n="faqCoverQ">Do you work outside the UK?</span><span class="faq-icon">+</span></button><div class="faq-answer"><p data-l10n="faqCoverA">Yes. We price projects worldwide. Pick your country from the flag menu at the top of the page and the site switches to your currency &#8212; and every BOQ is priced with local market rates, measured to the rules your market uses and checked against your local building codes.</p></div></div>
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
            <text x="2" y="36" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="40" font-weight="800" letter-spacing="0.5"><tspan fill="currentColor">AI</tspan><tspan fill="#F59E0B"> QS</tspan></text>
            <text x="3" y="54" textLength="150" lengthAdjust="spacingAndGlyphs" font-family="'Instrument Sans', Arial, Helvetica, sans-serif" font-size="11" font-weight="600" fill="#94A3B8">QUANTITY SURVEYING</text>
          </svg>
        </a>
        <p>AI-powered quantity surveying for construction worldwide. Professional BOQs, cost estimates, and feasibility reports -- delivered fast, priced in your local currency with local rates and codes.</p>
      </div>
      <div class="footer-col"><h4>Service</h4><a href="#how">How It Works</a><a href="#deliverables">Deliverables</a><a href="#pricing">Pricing</a><a href="#reviews">Reviews</a><a href="#leave-review">Leave a Review</a><a href="#faq">FAQ</a><a href="https://aitradespilot.com/">AI Trades Pilot — for builders</a></div>
      <div class="footer-col"><h4>Project Types</h4><a href="#">Residential Extensions</a><a href="#">New Builds</a><a href="#">Commercial Fit-Outs</a><a href="#">Structural Steelwork</a><a href="#">Refurbishments</a></div>
      <div class="footer-col"><h4>Contact</h4><a href="mailto:hello@theaiqs.com">hello@theaiqs.com</a><a href="#">TheAIQS Ltd</a><a href="#local">UK-based &#183; Serving clients worldwide</a></div>
    </div>
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

<!-- FREE FIRST JOB POPUP -->
<div class="aiqs-offer" id="aiqsOffer" role="dialog" aria-modal="true" aria-labelledby="aiqsOfferTitle" aria-hidden="true">
  <div class="aiqs-offer-card">
    <button type="button" class="aiqs-offer-close" id="aiqsOfferClose" aria-label="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="aiqs-offer-badge">First job free</div>
    <h2 id="aiqsOfferTitle">Your first BOQ is <em>on us</em></h2>
    <p>Send us one set of drawings and we'll price the job free &#8212; the full pack, not a sample. No card, no subscription, no catch.</p>
    <ul class="aiqs-offer-list">
      <li>Full Excel Bill of Quantities</li>
      <li>Word findings report</li>
      <li data-l10n="offerRates">Current UK market rates</li>
      <li>Back to you the same day</li>
    </ul>
    <a href="/send-drawings.html?offer=free-first-boq" class="aiqs-offer-cta" id="aiqsOfferCta">Claim My Free BOQ <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg></a>
    <button type="button" class="aiqs-offer-dismiss" id="aiqsOfferDismiss">No thanks, I'm just looking</button>
    <p class="aiqs-offer-fine">One free BOQ per new customer. We'll confirm scope before we start.</p>
  </div>
</div>

<!-- AI CHAT WIDGET — talks to /api/public/site-chat on the portal -->
<div class="aiqs-chat" id="aiqsChat">
  <div class="aiqs-chat-panel" id="aiqsChatPanel" role="dialog" aria-modal="false" aria-label="Chat with the AI QS assistant" aria-hidden="true">
    <div class="aiqs-chat-head">
      <div class="aiqs-chat-head-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z"/></svg>
      </div>
      <div>
        <div class="aiqs-chat-head-title">AI QS Assistant</div>
        <div class="aiqs-chat-head-sub">Answers in seconds</div>
      </div>
      <button type="button" class="aiqs-chat-close" id="aiqsChatClose" aria-label="Close chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="aiqs-chat-log" id="aiqsChatLog" role="log" aria-live="polite" aria-atomic="false"></div>
    <div class="aiqs-chat-chips" id="aiqsChatChips">
      <button type="button" class="aiqs-chip">What do I actually get?</button>
      <button type="button" class="aiqs-chip">How much does it cost?</button>
      <button type="button" class="aiqs-chip">Is my first job really free?</button>
      <button type="button" class="aiqs-chip">What drawings do you need?</button>
      <button type="button" class="aiqs-chip" data-l10n="chip" hidden></button>
    </div>
    <form class="aiqs-chat-form" id="aiqsChatForm" autocomplete="off">
      <input type="text" id="aiqsChatInput" placeholder="Ask about your project..." aria-label="Your message" maxlength="2000">
      <button type="submit" class="aiqs-chat-send" id="aiqsChatSend" aria-label="Send message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </form>
    <div class="aiqs-chat-foot">
      <a href="/send-drawings.html">Ready to go? Send your drawings &#8594;</a>
    </div>
  </div>
  <button type="button" class="aiqs-chat-launcher" id="aiqsChatLauncher" aria-label="Chat with the AI QS assistant" aria-expanded="false" aria-controls="aiqsChatPanel">
    <svg class="icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
    <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    <span class="aiqs-chat-pulse" aria-hidden="true"></span>
  </button>
</div>

<script>
document.documentElement.classList.remove('no-js');
// ── Country localisation ──────────────────────────────────────────────────
// <html data-country> was seated before paint by the head script. This turns
// that country into a "market": currency, tax, measurement rules, building
// codes, build methods, location factors, a sample BOQ and a demo job, and
// applies it to the page.
//
// HOW IT IS ORGANISED
//   COUNTRIES  one row per country we name in the picker. Anything not listed
//              still works: it gets the International profile and USD.
//   PROFILES   the construction knowledge, shared by countries that build
//              the same way (all of the Gulf, all of mainland Europe, ...).
//   OVERRIDES  per-country tweaks to a profile (Saudi uses the SBC, ...).
//   STRINGS    the copy templates; {tokens} are filled from the market.
//
// PRICES. GBP is what Stripe charges. Every other currency shows the GBP
// price converted at the exchange rate in FX below, which fx-rates.php
// fetches once a day and prints into the page (its static table stands in
// when the feed is down), rounded by charmPrice() to a figure that looks set
// by a person. To hold a currency at a fixed figure whatever the rate does,
// pin it in PINNED_PRICES. When a local-currency Stripe link exists, add it to
// LOCAL_CHECKOUT and that currency stops showing the "charged in GBP" note.
(function () {
  var html = document.documentElement;

  // GBP -> currency, printed by fx-rates.php: the feed's rate for every
  // currency it carries (four significant figures) and the static fallback
  // for the rest. FX_META says where the rates came from and the date they
  // are good for, for the note under the prices.
  var FX = <?php echo json_encode($aiqsFx['rates'], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>;
  var FX_META = <?php echo json_encode(['live' => (bool)$aiqsFx['live'], 'asOf' => $aiqsFx['asOf'], 'source' => $aiqsFx['source'], 'sourceUrl' => $aiqsFx['sourceUrl']], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES); ?>;
  var GBP_PRICES = [150, 349, 580, 980];
  var PACK_SIZES = [1, 5, 10, 20];
  // Fixed price points that ignore the exchange rate: [single, 5, 10, 20].
  // Empty, so every currency follows the live rate. Example of pinning one:
  //   USD: [199, 465, 775, 1299]
  var PINNED_PRICES = {};
  // Local-currency Stripe payment links, in tier order. Example:
  //   AUD: ['https://buy.stripe.com/...', '...', '...', '...']
  var LOCAL_CHECKOUT = {};

  // code: [name, adjective, currency, profile, VAT/GST %, main city, tax name, "the" form]
  var COUNTRIES = {
    GB: ['United Kingdom', 'UK', 'GBP', 'gb', 20, 'London', '', 'the UK'],
    IE: ['Ireland', 'Irish', 'EUR', 'ie', 13.5, 'Dublin'],
    AU: ['Australia', 'Australian', 'AUD', 'au', 10, 'Sydney'],
    NZ: ['New Zealand', 'New Zealand', 'NZD', 'nz', 15, 'Auckland'],
    US: ['United States', 'US', 'USD', 'us', 0, 'New York', '', 'the US'],
    CA: ['Canada', 'Canadian', 'CAD', 'ca', 0, 'Toronto'],
    ZA: ['South Africa', 'South African', 'ZAR', 'za', 15, 'Johannesburg'],
    AE: ['United Arab Emirates', 'UAE', 'AED', 'gulf', 5, 'Dubai', '', 'the UAE'],
    SA: ['Saudi Arabia', 'Saudi', 'SAR', 'gulf', 15, 'Riyadh'],
    QA: ['Qatar', 'Qatari', 'QAR', 'gulf', 0, 'Doha', 'taxes'],
    KW: ['Kuwait', 'Kuwaiti', 'KWD', 'gulf', 0, 'Kuwait City', 'taxes'],
    BH: ['Bahrain', 'Bahraini', 'BHD', 'gulf', 10, 'Manama'],
    OM: ['Oman', 'Omani', 'OMR', 'gulf', 5, 'Muscat'],
    DE: ['Germany', 'German', 'EUR', 'eu', 19, 'Munich'],
    FR: ['France', 'French', 'EUR', 'eu', 20, 'Paris'],
    NL: ['Netherlands', 'Dutch', 'EUR', 'eu', 21, 'Amsterdam', '', 'the Netherlands'],
    BE: ['Belgium', 'Belgian', 'EUR', 'eu', 21, 'Brussels'],
    LU: ['Luxembourg', 'Luxembourg', 'EUR', 'eu', 17, 'Luxembourg City'],
    ES: ['Spain', 'Spanish', 'EUR', 'eu', 21, 'Madrid'],
    PT: ['Portugal', 'Portuguese', 'EUR', 'eu', 23, 'Lisbon'],
    IT: ['Italy', 'Italian', 'EUR', 'eu', 22, 'Milan'],
    AT: ['Austria', 'Austrian', 'EUR', 'eu', 20, 'Vienna'],
    FI: ['Finland', 'Finnish', 'EUR', 'eu', 25.5, 'Helsinki'],
    GR: ['Greece', 'Greek', 'EUR', 'eu', 24, 'Athens'],
    MT: ['Malta', 'Maltese', 'EUR', 'eu', 18, 'Valletta'],
    CY: ['Cyprus', 'Cypriot', 'EUR', 'eu', 19, 'Limassol'],
    HR: ['Croatia', 'Croatian', 'EUR', 'eu', 25, 'Zagreb'],
    SI: ['Slovenia', 'Slovenian', 'EUR', 'eu', 22, 'Ljubljana'],
    SK: ['Slovakia', 'Slovak', 'EUR', 'eu', 23, 'Bratislava'],
    EE: ['Estonia', 'Estonian', 'EUR', 'eu', 24, 'Tallinn'],
    LV: ['Latvia', 'Latvian', 'EUR', 'eu', 21, 'Riga'],
    LT: ['Lithuania', 'Lithuanian', 'EUR', 'eu', 21, 'Vilnius'],
    BG: ['Bulgaria', 'Bulgarian', 'EUR', 'eu', 20, 'Sofia'],
    CH: ['Switzerland', 'Swiss', 'CHF', 'eu', 8.1, 'Zurich'],
    SE: ['Sweden', 'Swedish', 'SEK', 'eu', 25, 'Stockholm'],
    NO: ['Norway', 'Norwegian', 'NOK', 'eu', 25, 'Oslo'],
    DK: ['Denmark', 'Danish', 'DKK', 'eu', 25, 'Copenhagen'],
    IS: ['Iceland', 'Icelandic', 'ISK', 'eu', 24, 'Reykjavik'],
    PL: ['Poland', 'Polish', 'PLN', 'eu', 23, 'Warsaw'],
    CZ: ['Czechia', 'Czech', 'CZK', 'eu', 21, 'Prague'],
    HU: ['Hungary', 'Hungarian', 'HUF', 'eu', 27, 'Budapest'],
    RO: ['Romania', 'Romanian', 'RON', 'eu', 21, 'Bucharest'],
    SG: ['Singapore', 'Singapore', 'SGD', 'intl', 9, 'Singapore', 'GST'],
    MY: ['Malaysia', 'Malaysian', 'MYR', 'intl', 8, 'Kuala Lumpur', 'SST'],
    HK: ['Hong Kong', 'Hong Kong', 'HKD', 'intl', 0, 'Hong Kong', 'taxes'],
    IN: ['India', 'Indian', 'INR', 'intl', 18, 'Mumbai', 'GST'],
    PH: ['Philippines', 'Philippine', 'PHP', 'intl', 12, 'Manila', '', 'the Philippines'],
    ID: ['Indonesia', 'Indonesian', 'IDR', 'intl', 11, 'Jakarta'],
    TH: ['Thailand', 'Thai', 'THB', 'intl', 7, 'Bangkok'],
    JP: ['Japan', 'Japanese', 'JPY', 'intl', 10, 'Tokyo', 'consumption tax'],
    KR: ['South Korea', 'Korean', 'KRW', 'intl', 10, 'Seoul'],
    CN: ['China', 'Chinese', 'CNY', 'intl', 9, 'Shanghai'],
    KE: ['Kenya', 'Kenyan', 'KES', 'intl', 16, 'Nairobi'],
    NG: ['Nigeria', 'Nigerian', 'USD', 'intl', 7.5, 'Lagos'],
    GH: ['Ghana', 'Ghanaian', 'USD', 'intl', 15, 'Accra'],
    MU: ['Mauritius', 'Mauritian', 'MUR', 'intl', 15, 'Port Louis'],
    IL: ['Israel', 'Israeli', 'ILS', 'intl', 18, 'Tel Aviv'],
    MX: ['Mexico', 'Mexican', 'MXN', 'intl', 16, 'Mexico City', 'IVA'],
    BR: ['Brazil', 'Brazilian', 'BRL', 'intl', 0, 'São Paulo', 'taxes'],
    CL: ['Chile', 'Chilean', 'CLP', 'intl', 19, 'Santiago', 'IVA'],
    CO: ['Colombia', 'Colombian', 'COP', 'intl', 19, 'Bogotá', 'IVA'],
    PE: ['Peru', 'Peruvian', 'PEN', 'intl', 18, 'Lima', 'IGV'],
    JM: ['Jamaica', 'Jamaican', 'USD', 'intl', 15, 'Kingston', 'GCT'],
    TT: ['Trinidad and Tobago', 'Trinidadian', 'USD', 'intl', 12.5, 'Port of Spain']
  };

  var OVERRIDES = {
    AE: { codes: 'the Dubai Building Code, Abu Dhabi IBC and UAE Fire &amp; Life Safety Code', site: 'Villa 14, Al Barsha 2, Dubai' },
    SA: { codes: 'the Saudi Building Code (SBC)', site: 'Plot 14, Al Malqa, Riyadh' },
    QA: { codes: 'Qatar Construction Specifications (QCS) and Civil Defence requirements', site: 'Plot 14, West Bay, Doha' },
    KW: { codes: 'Kuwait Municipality and KFF fire regulations' },
    BH: { codes: 'Bahrain building regulations and Civil Defence requirements' },
    OM: { codes: 'Oman building regulations and Civil Defence requirements' },
    DE: { std: 'NRM elements mapped to DIN 276 cost groups', codes: 'the Landesbauordnung, GEG energy rules and DIN standards' },
    AT: { std: 'NRM elements mapped to ÖNORM B 1801-1', codes: 'the OIB guidelines and ÖNORM standards' },
    CH: { std: 'NRM elements mapped to eBKP-H', codes: 'SIA standards and cantonal building law' },
    FR: { codes: 'RE2020 and the DTU standards' },
    NL: { codes: 'the Bbl (Besluit bouwwerken leefomgeving)' },
    ES: { codes: 'the Código Técnico de la Edificación (CTE)' },
    IT: { codes: 'NTC 2018 and regional building codes' },
    PT: { codes: 'the RGEU and SCE energy rules' },
    SG: { std: 'the Singapore SMM', codes: 'BCA regulations and SS EN Eurocodes' },
    MY: { std: 'SMM2 (RISM)', codes: 'the Uniform Building By-Laws (UBBL)' },
    HK: { std: 'HKSMM4', codes: 'the Buildings Ordinance and Codes of Practice' },
    IN: { std: 'IS 1200 measurement rules', codes: 'the National Building Code of India (NBC 2016)' },
    KE: { std: 'the Kenyan SMM', codes: 'the Kenya Building Code' },
    PH: { codes: 'the National Building Code (PD 1096) and NSCP' },
    NG: { codes: 'the National Building Code of Nigeria' },
    JP: { codes: 'the Building Standard Act' }
  };

  // Shared icons for the six market cards, in order.
  var ICONS = [
    '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
    '<path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>',
    '<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
    '<path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>',
    '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'
  ];

  // Money in a profile is in that profile's own currency (cur) and is
  // converted when the visitor's currency differs.
  //   sample  hero card rows: [description, qty, unit, rate]
  //   demo    the animated portal chat; rows: [item, desc, badge, unit, qty, amount]
  //   qsFee   typical traditional QS fee for an extension take-off: [low, high]
  var PROFILES = {
    gb: {
      cur: 'GBP', tax: 'VAT', loc: 'region', std: 'NRM2', codes: 'Building Regulations',
      qsFee: [1500, 5000], sampleTitle: 'Residential Extension',
      sample: [['Strip foundations 600x250mm', 18, 'm', 84], ['Blockwork below DPC', 32, 'm²', 62], ['100mm concrete floor slab', 28, 'm²', 48], ['Cavity wall insulation', 56, 'm²', 38], ['Roof structure &#8212; cut timber', 28, 'm²', 95]],
      demo: { addr: '4 Acresfield Road', spec: 'single storey rear extension, cavity wall, flat roof', rates: 'current UK rates', total: 80856, sub: 67284,
        rows: [['3.1', 'Strip foundations 600×250', 'v', 'm', '18.4', 1601], ['3.2', 'Concrete slab 150mm reinforced', '', 'm²', '24.0', 1320], ['3.3', 'DPM 1200g polyethylene', '', 'm²', '24.0', 240], ['4.1', 'Cavity wall construction', 'v', 'm²', '42.6', 4601], ['4.2', 'Steel beam UB 203×133', 'g', 'nr', '1', 680]] },
      sectionSub: 'Measured, priced and reported the way UK builders, QSs and building control expect &#8212; with rates that know the difference between Kensington and Kendal.',
      cards: [
        ['Priced in GBP, ex VAT', 'Every rate and total is in pounds sterling. VAT is shown separately, with the reduced and zero rates flagged where conversions and new builds qualify, so the bill drops straight into a JCT contract, a tender or a client budget.'],
        ['Regional Location Factors', 'London and the South East cost more than the North East, and Scotland, Wales and Northern Ireland each price differently. Give us the postcode and the factor is applied for you.'],
        ['Measured to NRM2', 'Quantities follow the RICS New Rules of Measurement, with NRM1 elemental cost categories, so any chartered QS can check the bill line by line.'],
        ['Building Regulations', 'The findings report flags the Approved Documents that drive cost: Part A structure, Part B fire safety, Part L and the Future Homes Standard, Part F ventilation and Part M access, plus the Scottish Technical Handbooks where they apply.'],
        ['UK Build Methods', 'Cavity wall masonry and timber frame, strip and trench-fill foundations, beam-and-block floors, warm and cold flat roofs, loft conversions and steel beams. Priced with the materials and trades actually on UK sites.'],
        ['Site Conditions Costed In', 'Restricted access, party wall matters, conservation areas and listed buildings, poor ground and drainage diversions all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['London', 'South East', 'East of England', 'South West', 'Midlands', 'North West', 'Yorkshire &amp; Humber', 'North East', 'Wales', 'Scotland', 'Northern Ireland'],
      // null = keep the page's own (UK) wording
      strings: { heroRates: null, heroCardTitle: null, liveData: null, trustRates: null, del1: null, del2: null, del3: null, del4: null, delCodes: null, pricingSub: null, featRates: null, featLoc: null, faqRates: null, faqCoverQ: null, faqCoverA: null, offerRates: null, chip: '', mktThe: null }
    },
    ie: {
      cur: 'EUR', tax: 'VAT', loc: 'county &#8212; Dublin, regional &amp; rural', std: 'ARM4', codes: 'Building Regulations (TGDs), NZEB &amp; BCAR',
      qsFee: [1750, 6000], sampleTitle: 'Residential Extension',
      sample: [['Strip foundations 600x250mm', 18, 'm', 105], ['Blockwork below DPC', 32, 'm²', 78], ['150mm slab incl. radon barrier', 28, 'm²', 68], ['150mm full-fill cavity insulation', 56, 'm²', 32], ['Roof structure &#8212; cut timber', 28, 'm²', 115]],
      demo: { addr: '7 Seafield Avenue, Clontarf, Dublin 3', spec: 'single storey rear extension, 150mm cavity block, flat roof', rates: 'current Dublin rates', total: 96400, sub: 79850,
        rows: [['3.1', 'Strip foundations 600×250', 'v', 'm', '18.4', 1932], ['3.2', '150mm slab incl. radon barrier', '', 'm²', '24.0', 1632], ['3.3', 'Radon sump &amp; pipework', '', 'nr', '1', 385], ['4.1', 'Cavity blockwork, 150mm full-fill', 'v', 'm²', '42.6', 5538], ['4.2', 'Steel beam UB 203×133', 'g', 'nr', '1', 820]] },
      cards: [
        ['Priced in EUR, ex VAT', 'Every rate and total is in euro, with VAT at 13.5% on construction services shown separately, so the bill drops straight into an RIAI or public works contract, a tender or a client budget.'],
        ['Location Factors by County', 'Dublin prices differently to Cork, Galway or the midlands, and rural and island sites carry their own loadings. Give us the Eircode and the factor is applied for you.'],
        ['Measured to ARM4', 'Quantities follow the Agreed Rules of Measurement (ARM4) used by the SCSI and CIF, so any Irish QS can check the bill line by line.'],
        ['Building Regulations &amp; BCAR', 'The findings report flags the Technical Guidance Documents that drive cost: Part A structure, Part B fire, Part C radon, Part L and NZEB, Part M access, plus BCAR certification and commencement notices.'],
        ['Irish Build Methods', 'Cavity blockwork with full-fill insulation, timber frame, hollow-core and suspended floors, radon barriers and sumps, cut and trussed roofs. Priced with the materials and trades actually on Irish sites.'],
        ['Site Conditions Costed In', 'High radon areas, BER and NZEB targets, wastewater systems and percolation tests on one-off rural houses, and restricted urban access all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['Dublin', 'Cork', 'Galway', 'Limerick', 'Waterford', 'Kildare / Meath / Wicklow', 'Rest of Leinster', 'Munster', 'Connacht', 'Ulster (ROI)', 'Islands &amp; remote sites'],
      faq: 'Yes. Irish projects are priced in euro using current Irish market rates, adjusted by county and for rural sites. Quantities are measured to ARM4, VAT is shown separately, and the findings report references the Technical Guidance Documents, NZEB and BCAR.'
    },
    au: {
      cur: 'AUD', tax: 'GST', loc: 'state &#8212; metro, regional &amp; remote', std: 'ASMM / AIQS elements', codes: 'NCC / BCA &amp; Australian Standards',
      qsFee: [3000, 9000], sampleTitle: 'Residential Extension',
      sample: [['Waffle pod slab 300mm to AS 2870', 28, 'm²', 185], ['Brick veneer external walls', 32, 'm²', 240], ['R2.5 wall batts &amp; sarking', 56, 'm²', 34], ['Colorbond roof sheeting on battens', 28, 'm²', 95], ['Termite management to AS 3660', 1, 'item', 1450]],
      demo: { addr: '12 Wattle Street, Parramatta NSW', spec: 'single storey rear extension, brick veneer, Colorbond skillion roof', rates: 'current NSW rates', total: 158900, sub: 132900,
        rows: [['3.1', 'Waffle pod slab 300mm to AS 2870', 'v', 'm²', '24.0', 4440], ['3.2', 'Termite management to AS 3660', '', 'm²', '24.0', 720], ['3.3', 'Vapour barrier 200µm polyethylene', '', 'm²', '24.0', 168], ['4.1', 'Brick veneer external walls', 'v', 'm²', '42.6', 10224], ['4.2', 'Steel beam 250UB37', 'g', 'nr', '1', 1380]] },
      cards: [
        ['Priced in AUD, ex GST', 'Every rate and total is in Australian dollars. GST at 10% is shown separately so the bill drops straight into a HIA or MBA contract, a tender or a client budget.'],
        ['Location Factors by State', 'Rates are adjusted for where the job is: Sydney, Melbourne, Brisbane, Perth, Adelaide, Canberra, Hobart and Darwin, with regional and remote loadings on top. Give us the site address and the factor is applied for you.'],
        ['Measured to ASMM', 'Quantities follow the Australian Standard Method of Measurement with AIQS elemental cost categories, so an Australian QS can check the bill line by line.'],
        ['NCC &amp; Australian Standards', 'The findings report flags National Construction Code (BCA) requirements and the standards that drive cost: AS 2870 slabs and footings, AS 1684 timber framing, AS 3700 masonry, AS 4100 steel and AS 3660 termite management.'],
        ['Australian Build Methods', 'Slab-on-ground and waffle pod, brick veneer and lightweight cladding, Colorbond roofing, plasterboard linings, decks and pergolas. Priced with the materials and trades that are actually on site in Australia.'],
        ['Site Conditions Costed In', 'BAL bushfire ratings, cyclone regions C and D, soil classes from the geotech report and NatHERS energy targets all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Hobart', 'Darwin', 'Gold Coast', 'Newcastle', 'Regional NSW / VIC / QLD', 'Regional WA / SA / TAS', 'Remote &amp; FIFO sites'],
      faq: 'Yes. Australian projects are priced in Australian dollars using Australian market rates, with location factors by state and for metro, regional and remote sites. Quantities are measured to the Australian Standard Method of Measurement, GST is shown separately, and the findings report references the National Construction Code and the relevant Australian Standards.'
    },
    nz: {
      cur: 'NZD', tax: 'GST', loc: 'region &#8212; metro, regional &amp; remote', std: 'NZS 4202', codes: 'NZ Building Code &amp; NZS 3604',
      qsFee: [3500, 10000], sampleTitle: 'Residential Addition',
      sample: [['Insulated raft slab to NZS 3604', 28, 'm²', 260], ['Timber frame 90×45 SG8', 56, 'm²', 120], ['Weatherboard on 20mm cavity', 32, 'm²', 210], ['Long-run roofing on purlins', 28, 'm²', 110], ['R2.8 wall insulation &amp; wrap', 56, 'm²', 38]],
      demo: { addr: '18 Kowhai Road, Mt Eden, Auckland', spec: 'single storey addition, timber frame, weatherboard, long-run roof', rates: 'current Auckland rates', total: 178400, sub: 148600,
        rows: [['3.1', 'Insulated raft slab to NZS 3604', 'v', 'm²', '24.0', 6240], ['3.2', 'DPM 250µm polyethylene', '', 'm²', '24.0', 192], ['3.3', 'Bracing &amp; hold-down fixings', '', 'item', '1', 460], ['4.1', 'Weatherboard on 20mm cavity', 'v', 'm²', '42.6', 8946], ['4.2', 'Steel beam 200PFC', 'g', 'nr', '1', 1250]] },
      cards: [
        ['Priced in NZD, ex GST', 'Every rate and total is in New Zealand dollars, with GST at 15% shown separately, so the bill drops straight into an NZS 3910 or Master Build contract, a tender or a client budget.'],
        ['Location Factors by Region', 'Auckland, Wellington, Christchurch, Queenstown and the regions all price differently, and rural and remote sites carry their own loadings. Give us the site address and the factor is applied for you.'],
        ['Measured to NZS 4202', 'Quantities follow the New Zealand standard method of measurement for building works, with NZIQS elemental cost categories, so a Kiwi QS can check the bill line by line.'],
        ['NZ Building Code', 'The findings report flags the clauses that drive cost: B1 structure, E2 external moisture, H1 energy efficiency and G-clause services, plus NZS 3604 timber framing and NZS 4229 masonry.'],
        ['NZ Build Methods', 'Timber frame on slab or piles, weatherboard and brick veneer over a drained cavity, long-run roofing, plasterboard linings, decks and retaining walls. Priced with the materials and trades actually on NZ sites.'],
        ['Site Conditions Costed In', 'Wind zones, earthquake zones, sea-spray exposure zones, expansive soils and H1 insulation targets all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Tauranga', 'Dunedin', 'Queenstown Lakes', 'Nelson / Marlborough', 'Regional North Island', 'Regional South Island', 'Remote &amp; island sites'],
      faq: 'Yes. New Zealand projects are priced in NZ dollars using current NZ market rates, adjusted by region. Quantities are measured to NZS 4202, GST is shown separately, and the findings report references the NZ Building Code and NZS 3604.'
    },
    us: {
      cur: 'USD', tax: 'sales tax', loc: 'metro area &amp; state', std: 'CSI MasterFormat divisions', codes: 'IRC / IBC &amp; local amendments',
      qsFee: [2500, 8000], sampleTitle: 'Home Addition',
      sample: [['Continuous footing 24″×12″', 60, 'LF', 38], ['4″ slab-on-grade w/ vapor retarder', 300, 'SF', 9.5], ['2×6 wall framing @ 16″ o.c.', 600, 'SF', 14], ['Fiber-cement lap siding', 600, 'SF', 12], ['Architectural asphalt shingles', 320, 'SF', 6.5]],
      demo: { addr: '1427 Oak Street, Austin TX', spec: 'single-story rear addition, 2×6 wood frame, fiber-cement siding, asphalt shingle roof', rates: 'current Austin, TX rates', total: 192500, sub: 158300,
        secs: ['Div 03 — Concrete', 'Div 06 — Wood &amp; Framing'],
        rows: [['03.1', 'Continuous footing 24″×12″', 'v', 'LF', '60', 2280], ['03.2', '4″ slab-on-grade', '', 'SF', '300', 2850], ['03.3', 'Vapor retarder 10 mil', '', 'SF', '300', 210], ['06.1', '2×6 wall framing @ 16″ o.c.', 'v', 'SF', '600', 8400], ['06.2', 'LVL beam 3½″×11⅞″', 'g', 'EA', '1', 690]] },
      cards: [
        ['Priced in USD, ex Sales Tax', 'Every rate and total is in US dollars. Sales tax varies by state and county, so it is shown separately and the estimate drops straight into an AIA contract, a bid or an owner budget.'],
        ['City Cost Factors', 'New York, San Francisco and Boston cost more than Dallas, Atlanta or Phoenix, and rural sites price differently again. Rates are adjusted for the metro area and state. Give us the site address and the factor is applied for you.'],
        ['Organized by MasterFormat', 'Line items are grouped by CSI MasterFormat divisions with a UniFormat elemental summary, measured in the units US estimators use: LF, SF, CY and EA.'],
        ['IRC, IBC &amp; Local Codes', 'The findings report flags the code items that drive cost: the IRC or IBC as adopted locally, IECC energy requirements, NEC electrical, egress, fire separation and accessibility.'],
        ['US Build Methods', 'Wood stick framing in 2×4 and 2×6, slab-on-grade, crawlspace and basement foundations, OSB sheathing, vinyl and fiber-cement siding, asphalt shingles and drywall. Priced with the materials and trades actually on US sites.'],
        ['Site Conditions Costed In', 'Frost depth, seismic design categories, hurricane and high-wind zones, expansive soils, termite zones and prevailing-wage requirements all change what a job costs. Show them on the plans and they show up in the estimate.']
      ],
      factors: ['New York', 'Los Angeles', 'San Francisco Bay Area', 'Chicago', 'Boston', 'Seattle', 'Washington DC', 'Miami', 'Houston', 'Dallas&#8211;Fort Worth', 'Atlanta', 'Phoenix', 'Denver', 'Rural &amp; remote'],
      faq: 'Yes. US projects are priced in US dollars using current US market rates with city cost factors by metro area and state. Estimates are organized by CSI MasterFormat, measured in imperial units, sales tax is shown separately, and the findings report references the IRC / IBC as adopted locally.'
    },
    ca: {
      cur: 'CAD', tax: 'GST/HST', loc: 'province &amp; city', std: 'MasterFormat / UniFormat (CIQS)', codes: 'NBC &amp; provincial building codes',
      qsFee: [3000, 9000], sampleTitle: 'Home Addition',
      sample: [['Strip footing & frost wall 24″×8″', 60, 'LF', 95], ['4″ slab on 2″ rigid insulation', 300, 'SF', 14], ['2×6 exterior wall framing @ 16″ o.c.', 600, 'SF', 18], ['R-22 batts &amp; 6 mil poly', 600, 'SF', 4.2], ['Asphalt shingles on 7/16″ OSB', 320, 'SF', 9]],
      demo: { addr: '52 Maple Crescent, Oakville ON', spec: 'single-storey rear addition, 2×6 wood frame, frost wall foundations, asphalt shingle roof', rates: 'current GTA rates', total: 236800, sub: 194100,
        secs: ['Div 03 — Concrete', 'Div 06 — Wood &amp; Framing'],
        rows: [['03.1', 'Frost wall footing 24″×8″', 'v', 'LF', '60', 5700], ['03.2', '4″ slab on 2″ XPS', '', 'SF', '300', 4200], ['03.3', 'Weeping tile &amp; drainage', '', 'LF', '60', 1080], ['06.1', '2×6 wall framing @ 16″ o.c.', 'v', 'SF', '600', 10800], ['06.2', 'LVL beam 1¾″×11⅞″ (3-ply)', 'g', 'EA', '1', 1150]] },
      cards: [
        ['Priced in CAD, ex GST/HST', 'Every rate and total is in Canadian dollars, with GST, HST or PST shown separately for your province, so the estimate drops straight into a CCDC contract, a tender or an owner budget.'],
        ['Provincial Location Factors', 'Toronto, Vancouver, Calgary, Montréal and Halifax all price differently, and northern and remote sites carry their own loadings. Give us the site address and the factor is applied for you.'],
        ['Measured the Canadian Way', 'Line items follow MasterFormat divisions with a UniFormat elemental summary, in line with CIQS practice, so a Canadian QS or estimator can check every item.'],
        ['NBC &amp; Provincial Codes', 'The findings report flags the code items that drive cost: the National Building Code and provincial codes such as the OBC and BC Building Code, NECB and BC Energy Step Code targets, Part 9 housing and fire separations.'],
        ['Canadian Build Methods', 'Wood frame in 2×6, full basements and frost walls, ICF foundations, OSB and housewrap, vinyl and fibre-cement siding, asphalt shingles and drywall. Priced with the materials and trades actually on Canadian sites.'],
        ['Site Conditions Costed In', 'Frost depth, winter heat and hoarding, snow loads, seismic zones in BC, radon mitigation and energy step targets all change what a job costs. Show them on the drawings and they show up in the estimate.']
      ],
      factors: ['Toronto / GTA', 'Vancouver / Lower Mainland', 'Calgary', 'Edmonton', 'Ottawa', 'Montréal', 'Québec City', 'Winnipeg', 'Halifax', 'Regional Ontario', 'Regional BC &amp; Alberta', 'Northern &amp; remote'],
      faq: 'Yes. Canadian projects are priced in Canadian dollars using current Canadian market rates, adjusted by province and city. Estimates follow MasterFormat and CIQS practice, GST/HST is shown separately, and the findings report references the National Building Code and your provincial code.'
    },
    za: {
      cur: 'ZAR', tax: 'VAT', loc: 'province &amp; city', std: 'the ASAQS Standard System', codes: 'SANS 10400 &amp; NHBRC',
      qsFee: [25000, 90000], sampleTitle: 'Residential Extension',
      sample: [['Strip foundations 600×200mm', 18, 'm', 950], ['220mm cement brick walls', 32, 'm²', 780], ['85mm surface bed on DPM', 28, 'm²', 520], ['Plaster &amp; paint internal', 56, 'm²', 145], ['Concrete roof tiles on timber trusses', 28, 'm²', 1150]],
      demo: { addr: '23 Jacaranda Avenue, Randburg', spec: 'single storey extension, 220mm brick, concrete tile roof', rates: 'current Gauteng rates', total: 1146000, sub: 948500,
        rows: [['3.1', 'Strip foundations 600×200', 'v', 'm', '18.4', 17480], ['3.2', 'Surface bed 85mm on DPM', '', 'm²', '24.0', 12480], ['3.3', 'Anti-termite soil treatment', '', 'm²', '24.0', 1440], ['4.1', '220mm cement brick walls', 'v', 'm²', '42.6', 33228], ['4.2', 'Steel beam 203×133 I-section', 'g', 'nr', '1', 9800]] },
      cards: [
        ['Priced in ZAR, ex VAT', 'Every rate and total is in rand, with VAT at 15% shown separately, so the bill drops straight into a JBCC contract, a tender or a client budget.'],
        ['Location Factors by Province', 'Johannesburg, Pretoria, Cape Town and Durban price differently, and rural and remote sites carry their own loadings for transport and labour. Give us the site address and the factor is applied for you.'],
        ['Measured to the ASAQS System', 'Quantities follow the ASAQS Standard System of Measuring Building Work, with elemental cost categories, so any South African QS can check the bill line by line.'],
        ['SANS 10400 &amp; NHBRC', 'The findings report flags the parts of the National Building Regulations that drive cost: SANS 10400-H foundations, K walls, L roofs, T fire and XA energy, plus NHBRC home-building requirements.'],
        ['South African Build Methods', 'Clay and cement brick and block masonry, strip footings and surface beds, timber trusses with concrete tiles or IBR sheeting, plaster and paint. Priced with the materials and trades actually on South African sites.'],
        ['Site Conditions Costed In', 'Heaving clays and dolomite (NHBRC site class), termite treatment, backup power and solar, boundary walls and security all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['Johannesburg', 'Pretoria / Tshwane', 'Cape Town', 'Durban / eThekwini', 'Gqeberha', 'East London', 'Bloemfontein', 'Polokwane', 'Mbombela', 'Rustenburg', 'Regional &amp; rural'],
      faq: 'Yes. South African projects are priced in rand using current South African market rates, adjusted by province and city. Quantities are measured to the ASAQS Standard System, VAT is shown separately, and the findings report references SANS 10400 and NHBRC requirements.'
    },
    gulf: {
      cur: 'AED', tax: 'VAT', loc: 'city', std: 'POMI / RICS NRM', codes: 'local authority codes',
      qsFee: [7500, 25000], sampleTitle: 'Villa Extension',
      sample: [['RC isolated footings C40', 12, 'm³', 1250], ['200mm hollow blockwork', 64, 'm²', 95], ['RC slab 200mm C40', 28, 'm²', 420], ['Bituminous tanking to substructure', 56, 'm²', 65], ['Cement plaster external, 2 coats', 64, 'm²', 55]],
      demo: { addr: '{site}', spec: 'ground floor villa extension, RC frame, blockwork infill, flat roof', rates: 'current {city} rates', total: 612000, sub: 504800,
        rows: [['3.1', 'RC isolated footings C40', 'v', 'm³', '12.0', 15000], ['3.2', 'Bituminous tanking', '', 'm²', '56.0', 3640], ['3.3', 'Anti-termite treatment', '', 'm²', '48.0', 1150], ['4.1', '200mm hollow blockwork', 'v', 'm²', '64.0', 6080], ['4.2', 'RC roof slab 200mm C40', 'g', 'm²', '28.0', 11760]] },
      cards: [
        ['Priced in {cur}, ex {tax}', 'Every rate and total is in {curName}, with {taxP} shown separately, so the bill drops straight into a FIDIC contract, a tender or a developer budget.'],
        ['Location Factors by City', 'Dubai, Abu Dhabi, Riyadh, Jeddah, Doha and Muscat all price differently, and remote and island sites carry their own loadings. Give us the plot number and the factor is applied for you.'],
        ['Measured to POMI &amp; NRM', 'Quantities follow the Principles of Measurement (International) and RICS NRM, the rules most Gulf consultants and contractors work to, so any QS can check the bill line by line.'],
        ['Authority &amp; Code Compliance', 'The findings report flags the requirements that drive cost: {codes}, civil defence fire and life safety, and green building rules such as Al Sa&#8217;fat, Estidama and Mostadam.'],
        ['Gulf Build Methods', 'Reinforced concrete frames with blockwork infill, raft and piled foundations, post-tensioned slabs, waterproofing, GRC and aluminium façades, and MEP-heavy fit-outs. Priced with the materials and trades actually on Gulf sites.'],
        ['Site Conditions Costed In', 'High water tables and dewatering, sulphate and chloride-resistant concrete, summer working-hour restrictions, authority NOCs and fees all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['Dubai', 'Abu Dhabi', 'Sharjah &amp; Northern Emirates', 'Riyadh', 'Jeddah', 'Dammam / Eastern Province', 'Doha', 'Kuwait City', 'Manama', 'Muscat', 'Remote &amp; island sites'],
      faq: 'Yes. Projects in {the} are priced in {curName} using current Gulf market rates, adjusted by city. Quantities are measured to POMI / RICS NRM, {tax} is shown separately, and the findings report references {codes}.'
    },
    eu: {
      cur: 'EUR', tax: 'VAT', loc: 'region &amp; city', std: 'RICS NRM (mapped to local cost groups on request)', codes: 'Eurocodes &amp; national building regulations',
      qsFee: [1750, 6000], sampleTitle: 'Residential Extension',
      sample: [['Strip foundations C25/30', 18, 'm', 120], ['Masonry wall 240mm', 32, 'm²', 95], ['Ground slab 200mm on insulation', 28, 'm²', 110], ['ETICS insulation 160mm', 56, 'm²', 85], ['Timber roof structure', 28, 'm²', 130]],
      demo: { addr: '{site}', spec: 'single storey extension, masonry with ETICS, flat roof', rates: 'current {city} rates', total: 142000, sub: 117500,
        rows: [['3.1', 'Strip foundations C25/30', 'v', 'm', '18.4', 2208], ['3.2', 'Ground slab on 120mm XPS', '', 'm²', '24.0', 2640], ['3.3', 'Waterproofing membrane', '', 'm²', '24.0', 456], ['4.1', 'Masonry wall + 160mm ETICS', 'v', 'm²', '42.6', 7668], ['4.2', 'Steel beam HEB 200', 'g', 'nr', '1', 940]] },
      cards: [
        ['Priced in {cur}, ex {tax}', 'Every rate and total is in {curName}, with {taxP} shown separately, so the bill drops straight into a contract, a tender or a client budget.'],
        ['Location Factors by Region', '{city} prices differently to the rest of {the}, and rural and island sites carry their own loadings. Give us the site address and the factor is applied for you.'],
        ['Measured to Clear Rules', 'Quantities are measured to {std} with an elemental breakdown, so any QS can check the bill line by line.'],
        ['Codes &amp; Energy Rules', 'The findings report flags the requirements that drive cost: {codes}, Eurocode structural design, fire safety and nearly zero-energy (nZEB) targets.'],
        ['European Build Methods', 'Masonry and ETICS insulated render, reinforced concrete frames, timber frame and CLT, flat and pitched roofs. Priced with the materials and trades actually on sites in {the}.'],
        ['Site Conditions Costed In', 'Seismic zones, ground conditions, heritage and planning constraints, restricted city-centre access and energy performance targets all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['{city}', 'Other major cities', 'Suburban', 'Regional &amp; rural', 'Islands &amp; remote sites'],
      faq: 'Yes. Projects in {the} are priced in {curName} using current {adj} market rates, adjusted for the region. Quantities are measured to {std}, {tax} is shown separately, and the findings report references {codes}.'
    },
    intl: {
      cur: 'USD', tax: 'VAT', loc: 'city &amp; region', std: 'RICS NRM', codes: 'local building codes',
      qsFee: [2000, 6500], sampleTitle: 'Residential Extension',
      sample: [['RC strip footing', 18, 'm', 95], ['200mm blockwork walls', 32, 'm²', 55], ['150mm ground slab', 28, 'm²', 62], ['RC columns &amp; beams', 3.5, 'm³', 480], ['Roof structure &amp; covering', 28, 'm²', 110]],
      demo: { addr: '{site}', spec: 'single storey extension, RC frame with blockwork infill, flat roof', rates: 'current {city} rates', total: 118000, sub: 97600,
        rows: [['3.1', 'RC strip footing', 'v', 'm', '18.4', 1748], ['3.2', 'Ground slab 150mm on DPM', '', 'm²', '24.0', 1488], ['3.3', 'Anti-termite treatment', '', 'm²', '24.0', 192], ['4.1', '200mm blockwork walls', 'v', 'm²', '42.6', 2343], ['4.2', 'RC beam 230×450', 'g', 'm', '4.8', 1152]] },
      cards: [
        ['Priced in {cur}', 'Every rate and total is in {curName}, with {taxP} shown separately, so the bill drops straight into a FIDIC or local form of contract, a tender or a client budget.'],
        ['Location Factors', 'Rates are adjusted for where the job is: {city} prices differently to smaller cities and rural sites, and remote sites carry freight and labour loadings. Give us the site address and the factor is applied for you.'],
        ['Measured to Recognised Rules', 'Quantities follow {std} with an elemental breakdown, so any quantity surveyor can check the bill line by line.'],
        ['Local Codes Flagged', 'The findings report flags the requirements that drive cost under {codes}: structure, fire safety, energy and accessibility.'],
        ['Local Build Methods', 'Reinforced concrete frame, masonry, steel or timber &#8212; whatever is on the drawings, priced with the materials and trades available in {the}, including imported items and freight.'],
        ['Site Conditions Costed In', 'Seismic and wind zones, climate, ground conditions, access and the cost of importing materials all change what a job costs. Show them on the drawings and they show up in the bill.']
      ],
      factors: ['{city}', 'Other major cities', 'Regional', 'Rural', 'Remote &amp; island sites'],
      faq: 'Yes. We price projects worldwide. Projects in {the} are priced in {curName} with local market rates adjusted for location, measured to {std}, and the findings report references {codes}.'
    }
  };

  // Copy templates. A profile's own `strings` override these; null in an
  // override means "keep the wording already in the HTML".
  var STRINGS = {
    heroRates: '{adj} market rates in {cur}',
    heroCardTitle: 'BOQ -- {sampleTitle} &#183; {cur}',
    liveData: 'Live {adj} Data',
    trustRates: '<strong>{adj}</strong> market rates',
    qsFee: '{qsFee}',
    compFee: '{qsFee}+',
    compFrom: 'From {per20} per BOQ',
    compLive: 'Live {adj} data',
    del1: 'Elemental breakdown to {std} (substructure, superstructure, finishes, etc.)',
    del2: 'Current {adj} market rates applied, in {cur}',
    del3: 'Location-adjusted pricing by {loc}',
    del4: 'Prelims, contingencies &amp; professional fees included &#8212; {tax} shown separately',
    delCodes: '{codes} considerations',
    pricingSub: 'Start chatting for free. Pay as you go, or save with a bundle — the more you buy, the less each BOQ costs. All prices shown in {cur}. No subscriptions, no lock-in.',
    featRates: 'Current {adj} market rates',
    featLoc: 'Location-adjusted by {loc}',
    faqRates: '{adj} market rates, adjusted for location by {loc}',
    faqCoverQ: 'Do you cover {the}?',
    faqCoverA: '{faq}',
    offerRates: 'Current {adj} market rates, in {cur}',
    chip: 'Do you price jobs in {the}?',
    mktLabel: '{flagSp}{name}',
    mktTitle: 'Built for {adj}<br>Construction',
    mktSub: '{sectionSub}',
    mktThe: '{the}'
  };
  var DEFAULT_SECTION_SUB = 'Not a UK bill with the currency swapped. Projects in {the} are measured, priced and reported the way {adj} builders, estimators and certifiers expect.';

  // ---- helpers --------------------------------------------------------------
  function fill(str, tokens) {
    // Two passes so a token's value may itself hold tokens ({faq} -> {the}).
    for (var i = 0; i < 2; i++) {
      str = String(str).replace(/\{(\w+)\}/g, function (all, k) { return tokens[k] != null ? tokens[k] : all; });
    }
    return str;
  }
  // Windows has no flag emoji and draws them as two letters ("GB GBP" in the
  // pill), so check once whether this device paints a flag in colour.
  var FLAGS_OK = (function () {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 20;
      var x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '16px sans-serif';
      x.fillText('🇬🇧', 0, 0);
      var d = x.getImageData(0, 0, 20, 20).data;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] && (Math.abs(d[i] - d[i + 1]) > 20 || Math.abs(d[i + 1] - d[i + 2]) > 20)) return true;
      }
    } catch (e) {}
    return false;
  })();
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';
  function flagOf(code) {
    if (!FLAGS_OK) return '';
    if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') return '&#127760;';
    return String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 65, 0x1F1E6 + code.charCodeAt(1) - 65);
  }
  function regionName(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch (e) { return code; }
  }
  function currencyName(cur) {
    try { return new Intl.DisplayNames(['en'], { type: 'currency' }).of(cur).toLowerCase().replace(/^(\w)/, function (c) { return c.toUpperCase(); }); }
    catch (e) { return cur; }
  }
  function sig(x, n) {
    if (!x) return 0;
    var p = Math.pow(10, n - Math.ceil(Math.log10(Math.abs(x))));
    return Math.round(x * p) / p;
  }
  // A converted price that looks set by a person rather than by a formula:
  // 201 -> 199, 468 -> 469, 1313 -> 1299, 13892 -> 13999. The step is a
  // hundredth of the figure's size, so KWD 61 and IDR 3,300,000 both come out
  // sensible, and a day-to-day rate move only shows once it crosses a step.
  // Big-unit currencies (six figures and up) keep the round figure, where
  // "-1" would just look odd.
  function charmPrice(x) {
    if (!(x > 0)) return 0;
    var digits = Math.floor(Math.log10(x)) + 1;
    if (digits < 3) return Math.round(x);
    var step = Math.pow(10, digits - 2);
    var r = Math.round(x / step) * step;
    return digits <= 5 ? r - 1 : r;
  }
  function convert(v, from, to) {
    if (from === to) return v;
    return v / (FX[from] || 1) * (FX[to] || 1);
  }
  // "today's rate" / "the rate on 5 Oct" / "the current rate", for the notes.
  function fxWhen() {
    if (!FX_META.live || !FX_META.asOf) return 'the current rate';
    var t = new Date();
    var today = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
    if (FX_META.asOf === today) return "today's rate";
    var label = FX_META.asOf, d = new Date(FX_META.asOf + 'T00:00:00Z');
    var opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
    if (d.getUTCFullYear() !== t.getFullYear()) opts.year = 'numeric';   // an old cache says so
    try { label = d.toLocaleDateString('en-GB', opts); } catch (e) {}
    return 'the rate on ' + label;
  }

  function buildMarket(code) {
    code = /^[A-Z]{2}$/.test(code || '') ? code : 'GB';
    var row = COUNTRIES[code];
    var known = !!row;
    if (!row) {
      var nm = code === 'ZZ' ? 'International' : regionName(code);
      row = [nm, code === 'ZZ' ? 'local' : nm, 'USD', 'intl', 0, code === 'ZZ' ? 'your capital city' : nm, 'taxes', code === 'ZZ' ? 'your country' : nm];
    }
    var cur = FX[row[2]] ? row[2] : 'USD';
    var profKey = row[3];
    var p = PROFILES[profKey];
    var ov = OVERRIDES[code] || {};
    var locale = 'en-' + (code === 'ZZ' ? 'US' : code);
    var nfCache = {};
    function nf(fd) {
      if (!nfCache[fd]) {
        var base = { style: 'currency', currency: cur, minimumFractionDigits: fd, maximumFractionDigits: fd };
        try { nfCache[fd] = new Intl.NumberFormat(locale, Object.assign({ currencyDisplay: 'narrowSymbol' }, base)); }
        catch (e) { nfCache[fd] = new Intl.NumberFormat('en-GB', base); }
      }
      return nfCache[fd];
    }
    var curDigits = 2;
    try { curDigits = new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) {}
    function money(v, forceDec) {
      var isInt = Math.abs(v - Math.round(v)) < 0.005;
      return nf((forceDec || !isInt) ? curDigits : 0).format(isInt && !forceDec ? Math.round(v) : v);
    }
    // Prices: pinned if set, else GBP converted at today's rate and rounded
    // to a figure that looks set by a person.
    var prices = PINNED_PRICES[cur] || (cur === 'GBP' ? GBP_PRICES : GBP_PRICES.map(function (g) { return charmPrice(convert(g, 'GBP', cur)); }));
    var taxRate = row[4];
    var taxName = row[6] || p.tax;
    var qs = p.qsFee.map(function (v) { return p.cur === cur ? v : sig(convert(v, p.cur, cur), 2); });
    var m = {
      code: code, known: known, name: row[0], adj: row[1], cur: cur, profile: profKey, p: p,
      city: row[5], the: row[7] || row[0], tax: taxName, taxRate: taxRate, locale: locale,
      prices: prices, money: money, nf: nf,
      localCheckout: LOCAL_CHECKOUT[cur] || null
    };
    m.tokens = {
      name: m.name, adj: m.adj, the: m.the, cur: cur, curName: currencyName(cur), city: m.city,
      flag: flagOf(code), flagSp: flagOf(code) ? flagOf(code) + ' ' : '', tax: taxName,
      taxP: taxRate ? taxName + ' at ' + taxRate + '%' : taxName,
      std: ov.std || p.std, codes: ov.codes || p.codes, loc: p.loc,
      sampleTitle: p.sampleTitle,
      site: ov.site || ('Plot 14, ' + m.city),
      qsFee: money(qs[0]) + '&#8211;' + money(qs[1]),
      per20: money(prices[3] / 20)
    };
    m.tokens.faq = p.faq || '';
    m.tokens.sectionSub = p.sectionSub || DEFAULT_SECTION_SUB;
    m.strings = Object.assign({}, STRINGS, p.strings || {});
    return m;
  }

  // ---- rendering -------------------------------------------------------------
  function renderStrings(m) {
    document.querySelectorAll('[data-l10n]').forEach(function (el) {
      if (!el.hasAttribute('data-l10n-default')) el.setAttribute('data-l10n-default', el.innerHTML);
      var tpl = m.strings[el.getAttribute('data-l10n')];
      if (tpl === '') { el.hidden = true; return; }
      el.hidden = false;
      el.innerHTML = tpl == null ? el.getAttribute('data-l10n-default') : fill(tpl, m.tokens);
    });
  }

  function renderHeroBoq(m) {
    var box = document.getElementById('heroBoq');
    if (!box) return;
    var p = m.p, sum = 0, out = '';
    p.sample.forEach(function (r) {
      var rate = r[3];
      if (p.cur !== m.cur) rate = sig(convert(rate, p.cur, m.cur), rate < 10 ? 2 : 3);
      var total = Math.round(rate * r[1]);
      sum += total;
      out += '<div class="boq-preview-row"><span class="desc">' + r[0] + '</span><span class="qty">' + r[1] + ' ' + r[2]
        + '</span><span class="rate">' + m.money(rate) + '</span><span class="total">' + m.money(total) + '</span></div>';
    });
    out += '<div class="boq-subtotal"><span>Section Subtotal <small>ex ' + m.tax + '</small></span><span>' + m.money(sum, true) + '</span></div>';
    box.innerHTML = out;
  }

  function renderMarketSection(m) {
    var grid = document.getElementById('mktGrid');
    if (grid) {
      grid.innerHTML = m.p.cards.map(function (c, i) {
        return '<div class="mkt-card"><span class="pain-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
          + ICONS[i % ICONS.length] + '</svg></span><h3>' + fill(c[0], m.tokens) + '</h3><p>' + fill(c[1], m.tokens) + '</p></div>';
      }).join('');
    }
    var f = document.getElementById('mktFactors');
    if (f) f.innerHTML = m.p.factors.map(function (x) { return '<span>' + fill(x, m.tokens) + '</span>'; }).join('');
  }

  function splitMoney(m, v) {
    // Symbol and figure go in separate spans so the symbol can sit superscript,
    // wherever the locale would normally put it.
    var parts = m.nf(0).formatToParts(Math.round(v)), sym = '', num = '', after = false;
    parts.forEach(function (pt) {
      if (pt.type === 'currency') { sym += pt.value; after = !!num; }
      else if (pt.type !== 'literal') num += pt.value;
    });
    return { sym: sym, num: num, after: after };
  }

  function renderPricing(m) {
    var gbp = m.cur === 'GBP';
    document.querySelectorAll('.pricing-amount[data-tier]').forEach(function (el) {
      var t = +el.getAttribute('data-tier'), s = splitMoney(m, m.prices[t]);
      var c = el.querySelector('.currency'), a = el.querySelector('.amt');
      c.textContent = s.sym;
      a.textContent = s.num;
      // Keep the symbol on the side the locale writes it (£150, but 1 850 kr).
      el.insertBefore(c, s.after ? a.nextSibling : a);
      c.style.marginLeft = s.after ? '4px' : '';
    });
    document.querySelectorAll('.pricing-note[data-tier]').forEach(function (el) {
      var t = +el.getAttribute('data-tier'), n = PACK_SIZES[t];
      var per = m.prices[t] / n, save = m.prices[0] * n - m.prices[t];
      el.innerHTML = 'Just ' + m.money(per) + ' per BOQ — save ' + m.money(save);
    });
    document.querySelectorAll('a[data-tier]').forEach(function (a) {
      if (!a.hasAttribute('data-gbp-href')) a.setAttribute('data-gbp-href', a.getAttribute('href'));
      var t = +a.getAttribute('data-tier');
      var local = m.localCheckout && m.localCheckout[t];
      a.setAttribute('href', local || a.getAttribute('data-gbp-href'));
    });
    var allLocal = !!m.localCheckout;
    document.querySelectorAll('.pricing-billing[data-tier]').forEach(function (el) {
      var t = +el.getAttribute('data-tier');
      if (gbp || (m.localCheckout && m.localCheckout[t])) { el.hidden = true; return; }
      allLocal = false;
      var g = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(GBP_PRICES[t]);
      el.innerHTML = 'Charged as ' + g + ' GBP at checkout — about ' + m.money(m.prices[t]) + ' at ' + fxWhen() + '. Your card converts it for you.';
      el.hidden = false;
    });
    // Where the prices came from, once, under the grid.
    var note = document.getElementById('fxNote');
    if (note) {
      if (gbp || PINNED_PRICES[m.cur]) { note.hidden = true; return; }
      var text = 'Prices in ' + m.cur + ' are our GBP prices converted at ' + fxWhen() + ', updated daily and rounded to a sensible figure.';
      if (!allLocal) text += ' You pay in GBP and your card does the conversion, so the exact amount can differ by a little.';
      if (FX_META.live && FX_META.source) {
        text += ' Rates by ' + (FX_META.sourceUrl ? '<a href="' + FX_META.sourceUrl + '" target="_blank" rel="noopener">' + FX_META.source + '</a>' : FX_META.source) + '.';
      }
      note.innerHTML = text;
      note.hidden = false;
    }
  }

  var pickerBuilt = false;
  function renderPicker(m) {
    var sel = document.getElementById('regionSelect');
    var flag = document.getElementById('regionFlag');
    var curEl = document.getElementById('regionCur');
    if (flag) flag.innerHTML = m.tokens.flag || GLOBE;
    if (curEl) curEl.textContent = m.cur;
    if (!sel) return;
    if (!pickerBuilt) {
      pickerBuilt = true;
      var codes = Object.keys(COUNTRIES).sort(function (a, b) { return COUNTRIES[a][0].localeCompare(COUNTRIES[b][0]); });
      var opts = codes.map(function (c) {
        var cur = FX[COUNTRIES[c][2]] ? COUNTRIES[c][2] : 'USD';
        return '<option value="' + c + '">' + (FLAGS_OK ? flagOf(c) + ' ' : '') + COUNTRIES[c][0] + ' — ' + cur + '</option>';
      });
      opts.push('<option value="ZZ">' + (FLAGS_OK ? '&#127760; ' : '') + 'Other country — USD</option>');
      sel.innerHTML = opts.join('');
    }
    if (!sel.querySelector('option[value="' + m.code + '"]')) {
      var o = document.createElement('option');
      o.value = m.code;
      o.textContent = m.name + ' — ' + m.cur;
      sel.insertBefore(o, sel.firstChild);
    }
    sel.value = m.code;
    var picker = document.getElementById('regionPicker');
    if (picker) picker.title = m.name + ' — prices in ' + m.cur;
  }

  // The animated portal demo asks for its job here, so it gets the visitor's
  // local project, currency and file names.
  window.AIQS_demo = function () {
    var m = current;
    if (!m) return null;
    var p = m.p, d = p.demo;
    function cash(v, sf) { return m.money(p.cur === m.cur ? v : sig(convert(v, p.cur, m.cur), sf)); }
    var addr = fill(d.addr, m.tokens);
    var tag = addr.split(',')[0].replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      addr: addr, spec: d.spec, rates: fill(d.rates, m.tokens),
      total: cash(d.total, 4) + ' excluding ' + m.tax,
      sub: cash(d.sub, 4),
      plans: tag + '-Plans.pdf', xlsx: 'BOQ-' + tag + '.xlsx', pdf: 'Client-Copy-' + tag + '.pdf',
      secs: d.secs || ['3. Substructure', '4. Superstructure'],
      rows: d.rows.map(function (r) { return [r[0], r[1], r[2], r[3], r[4], cash(r[5], 3)]; })
    };
  };

  var current = null;
  window.AIQS_market = function () { return current; };
  // Kept for anything else on the site that still asks for the old uk/au pair.
  window.AIQS_region = function () { return current && current.code === 'AU' ? 'au' : 'uk'; };
  window.AIQS_setCountry = function (code, remember) {
    var m = buildMarket(code);
    current = m;
    html.setAttribute('data-country', m.code);
    html.setAttribute('lang', m.code === 'ZZ' ? 'en' : 'en-' + m.code);
    if (remember) {
      try {
        localStorage.setItem('aiqs_country', m.code);
        localStorage.setItem('aiqs_region', m.code === 'AU' ? 'au' : 'uk');
      } catch (e) {}
    }
    renderStrings(m);
    renderHeroBoq(m);
    renderMarketSection(m);
    renderPricing(m);
    renderPicker(m);
    html.classList.remove('l10n-pending');
    try { document.dispatchEvent(new CustomEvent('aiqs:country', { detail: { country: m.code, currency: m.cur } })); } catch (e) {}
    return m;
  };

  var geo = window.AIQS_GEO || { country: html.getAttribute('data-country') || 'GB', how: 'default' };
  window.AIQS_setCountry(geo.country, false);

  var sel = document.getElementById('regionSelect');
  if (sel) {
    sel.addEventListener('change', function () {
      var m = window.AIQS_setCountry(sel.value, true);
      aiqsTrack('ViewContent', { content_name: 'Country switched', content_category: m.code + ' ' + m.cur });
    });
  }
  var sw = document.getElementById('mktSwitch');
  if (sw && sel) {
    sw.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(function () {
        sel.focus();
        try { if (sel.showPicker) sel.showPicker(); } catch (e) {}
      }, 400);
    });
  }

  // Timezone found nothing (UTC-set machines, some privacy browsers). If the
  // site sits behind Cloudflare, its same-origin trace endpoint knows the
  // visitor's country without calling any third party. Anywhere else the
  // request simply 404s and the language/UK guess stands.
  if (geo.how === 'language' || geo.how === 'default') {
    try {
      fetch('/cdn-cgi/trace', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (t) {
          var loc = (String(t).match(/^loc=([A-Z]{2})$/m) || [])[1];
          if (loc && loc !== 'XX' && loc !== 'T1' && current && loc !== current.code) window.AIQS_setCountry(loc, false);
        })
        .catch(function () {});
    } catch (e) {}
  }
})();
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
// ── AI chat widget ─────────────────────────────────────────────────────────
// Replaces the old WhatsApp hand-off. The visitor asks a question here and the
// portal answers it (server/siteChatRoutes.js). Everything degrades: if the API
// is unreachable the assistant still points at Send Drawings and the email.
(function () {
  var API = 'https://aiqs-portal.onrender.com/api/public/site-chat';
  var GREETING = "Hi — I'm the AI QS assistant. Ask me anything about pricing, turnaround, or what you get back.\n\nYour first job is on us, so it costs nothing to try.";
  var OFFLINE = 'Sorry — I could not reach the assistant just then. Send your drawings through the Send Drawings page and we will come straight back to you, or email hello@crmwizardai.com.';

  var root = document.getElementById('aiqsChat');
  var panel = document.getElementById('aiqsChatPanel');
  var launcher = document.getElementById('aiqsChatLauncher');
  var closeBtn = document.getElementById('aiqsChatClose');
  var log = document.getElementById('aiqsChatLog');
  var chips = document.getElementById('aiqsChatChips');
  var form = document.getElementById('aiqsChatForm');
  var input = document.getElementById('aiqsChatInput');
  var sendBtn = document.getElementById('aiqsChatSend');
  if (!root || !panel || !launcher || !log || !form || !input) return;

  // What we post back to the API. The server re-sanitises it either way, but
  // keeping it bounded here saves the round trip on a long session.
  var history = [];
  var busy = false;
  var open = false;
  var greeted = false;
  var trackedFirstMessage = false;

  function bubble(who, text) {
    var msg = document.createElement('div');
    msg.className = 'aiqs-msg ' + who;
    var avatar = document.createElement('div');
    avatar.className = 'aiqs-msg-avatar';
    avatar.textContent = who === 'ai' ? 'QS' : 'You';
    var body = document.createElement('div');
    body.className = 'aiqs-msg-bubble';
    body.textContent = text;              // textContent, never innerHTML
    msg.appendChild(avatar);
    msg.appendChild(body);
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  function showTyping() {
    var msg = document.createElement('div');
    msg.className = 'aiqs-msg ai';
    msg.id = 'aiqsTyping';
    msg.innerHTML = '<div class="aiqs-msg-avatar">QS</div><div class="aiqs-msg-bubble">'
      + '<div class="aiqs-typing"><span></span><span></span><span></span></div></div>';
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
  }
  function hideTyping() {
    var el = document.getElementById('aiqsTyping');
    if (el) el.remove();
  }

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state;
    input.disabled = state;
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    bubble('ai', GREETING);
    history.push({ role: 'assistant', content: GREETING });
  }

  function setOpen(state) {
    open = state;
    root.classList.toggle('open', state);
    panel.setAttribute('aria-hidden', state ? 'false' : 'true');
    launcher.setAttribute('aria-expanded', state ? 'true' : 'false');
    if (state) {
      greet();
      aiqsTrack('Contact', { content_name: 'Site chat opened' });
      setTimeout(function () { input.focus(); }, 220);
    } else {
      launcher.focus();
    }
  }

  async function ask(question) {
    if (busy || !question) return;
    bubble('you', question);
    history.push({ role: 'user', content: question });
    if (chips) chips.style.display = 'none';
    if (!trackedFirstMessage) {
      trackedFirstMessage = true;
      aiqsTrack('Contact', { content_name: 'Site chat message' });
    }
    setBusy(true);
    showTyping();

    var reply = OFFLINE;
    try {
      // Tell the assistant where the visitor is, so it quotes their currency
      // and local rules. A server that ignores the field loses nothing.
      var mk = window.AIQS_market && window.AIQS_market();
      var resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.slice(-16),
          market: mk ? { country: mk.code, countryName: mk.name, currency: mk.cur, prices: mk.prices } : undefined
        })
      });
      var data = await resp.json();
      if (resp.ok && data && data.reply) reply = data.reply;
    } catch (e) { /* keep the offline reply */ }

    hideTyping();
    bubble('ai', reply);
    history.push({ role: 'assistant', content: reply });
    setBusy(false);
    input.focus();
  }

  // On a narrow screen the cookie banner lands on top of the launcher, so a
  // first-time visitor cannot open the chat at all. Lift the whole widget clear
  // of it for as long as the banner is up.
  var banner = document.getElementById('cookie-banner');
  function clearOfBanner() {
    var lift = (banner && banner.classList.contains('show') && window.innerWidth <= 640)
      ? Math.round(banner.getBoundingClientRect().height) + 16
      : 0;
    root.style.setProperty('--aiqs-lift', lift + 'px');
  }
  if (banner && window.MutationObserver) {
    new MutationObserver(clearOfBanner).observe(banner, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', clearOfBanner);
    clearOfBanner();
  }

  launcher.addEventListener('click', function () { setOpen(!open); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) setOpen(false); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    ask(q);
  });

  if (chips) {
    chips.addEventListener('click', function (e) {
      var chip = e.target.closest('.aiqs-chip');
      if (chip) ask(chip.textContent.trim());
    });
  }
})();

// ---- Conversion tracking (consent-gated via AIQS_CAPI.fire) ----
document.addEventListener('click', function(e) {
  var a = e.target.closest('a'); if (!a) return;
  var href = a.getAttribute('href') || '';
  if (href.indexOf('send-drawings') !== -1) {
    aiqsTrack('Lead', { content_name: 'Send Drawings' });
  } else if (href.indexOf('buy.stripe.com') !== -1) {
    // Report what the visitor is actually charged: the local currency only
    // when a local-currency checkout link is in use, GBP otherwise.
    var m = window.AIQS_market && window.AIQS_market();
    var tier = +a.getAttribute('data-tier') || 0;
    var localCheckout = !!(m && a.getAttribute('data-gbp-href') && href !== a.getAttribute('data-gbp-href'));
    var gbp = [150, 349, 580, 980][tier] || 150;
    var name = a.getAttribute('data-plan') || 'Single BOQ (PAYG)';
    aiqsTrack('InitiateCheckout', {
      currency: localCheckout ? m.cur : 'GBP',
      value: localCheckout ? m.prices[tier] : gbp,
      content_name: name,
      content_category: m ? m.code : 'GB'
    });
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
  function resetSteps() { [1,2,3,4].forEach(function(n) { document.getElementById('dStep' + n).classList.remove('done'); });
    [1,2,3].forEach(function(n) { document.getElementById('dConn' + n).classList.remove('done'); }); }
  function addTimeskip(text) {
    var div = document.createElement('div'); div.className = 'demo-timeskip';
    div.innerHTML = '<span>' + text + '</span>';
    div.style.opacity = '0'; div.style.transform = 'translateY(10px)'; chat.appendChild(div);
    requestAnimationFrame(function() { div.style.transition = 'opacity 0.5s ease, transform 0.5s ease'; div.style.opacity = '1'; div.style.transform = 'translateY(0)'; });
    chat.scrollTop = chat.scrollHeight; }
  // One script, many casts: the demo reads the visitor's market each time it
  // starts, so switching country mid-loop shows the local job on the next run.
  // The job itself lives in the market profile (PROFILES[..].demo above).
  async function runDemo() { var d = demoData(); if (!d) return; chat.innerHTML = ''; resetSteps(); await sleep(800);
    await typeInput('Sending over the drawings for ' + d.addr);
    addMsg('user', 'Here are the drawings for ' + d.addr + ' — ' + d.spec + '.'
      + '<div class="demo-upload"><div class="demo-upload-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></div>'
      + '<div><div class="demo-upload-name">' + d.plans + '</div><div class="demo-upload-size">2.4 MB — Floor plan, elevations, sections</div></div></div>');
    markStep(1); await sleep(1400);
    addTyping(); await sleep(2200); removeTyping(); markStep(2);
    addMsg('ai', 'Thanks — your drawings for <strong>' + d.addr + '</strong> have been received and are with our QS team now.'
      + '<br><br>We’re producing your full detailed Bill of Quantities and Findings Report — every element measured, priced with ' + d.rates + ', and sense-checked before delivery.'
      + '<div class="demo-status"><span class="demo-status-dot"></span> In production — delivery today</div>');
    await sleep(2400);
    addTimeskip('Later that day — 3:47pm'); await sleep(1400);
    addTyping(); await sleep(2200); removeTyping(); markStep(3);
    addMsg('ai', 'Your documents for <strong>' + d.addr + '</strong> are ready.'
      + '<br><br>Full detailed BOQ — 86 line items across 15 sections — plus a Findings Report covering scope, assumptions and risk flags. Total project value <strong style="color:var(--accent)">' + d.total + '</strong>.'
      + boqHTML(d) + dlHTML(d));
    await sleep(3200);
    await typeInput('Generate a client copy'); addMsg('user', 'Generate a client copy'); await sleep(900);
    addTyping(); await sleep(2200); removeTyping(); markStep(4);
    addMsg('ai', 'Client copy generated — a clean, presentation-ready version with summary pricing, ready to send straight to your client.' + ccHTML(d));
    await sleep(9000);
    if (AIQS_REDUCE_MOTION) return;
    if (stageVisible && !document.hidden) { runDemo(); } else { pendingRestart = true; } }
  function demoData() { return window.AIQS_demo ? window.AIQS_demo() : null; }
  function boqHTML(d) {
    var badge = { v: ' <span class="demo-rbadge v">Verified</span>', g: ' <span class="demo-rbadge g">Generic</span>' };
    var html = '<div class="demo-boq"><div class="demo-boq-hdr"><span>Item</span><span>Description</span><span>Unit</span><span>Qty</span><span>Total</span></div>';
    d.rows.forEach(function (r, i) {
      if (i === 0) html += '<div class="demo-boq-row sec">' + d.secs[0] + '</div>';
      if (i === 3) html += '<div class="demo-boq-row sec">' + d.secs[1] + '</div>';
      html += '<div class="demo-boq-row"><span>' + r[0] + '</span><span>' + r[1] + (badge[r[2]] || '') + '</span><span>' + r[3] + '</span><span>' + r[4] + '</span><span>' + r[5] + '</span></div>';
    });
    return html + '<div class="demo-boq-row sub"><span></span><span></span><span></span><span></span><span>' + d.sub + '</span></div></div>';
  }
  function dlHTML(d) {
    return '<div class="demo-dl"><div class="demo-dl-btn xl"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h2M8 17h2M14 13h2M14 17h2"/></svg> ' + d.xlsx + '</div>'
      + '<div class="demo-dl-btn wd"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg> Findings-Report.docx</div></div>';
  }
  function ccHTML(d) {
    return '<div class="demo-dl"><div class="demo-dl-btn cc"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/></svg> ' + d.pdf + '</div></div>';
  }
})();
// ── Free first job popup ───────────────────────────────────────────────────
// Shown once per visitor: after they have read a little, or on exit intent,
// whichever comes first. The choice is remembered in localStorage so it never
// nags. Never fires on top of the cookie banner or while the chat is open.
(function () {
  var KEY = 'aiqs_offer_seen';
  var DELAY_MS = 30000;
  var SCROLL_TRIGGER = 0.35;

  var modal = document.getElementById('aiqsOffer');
  var card = modal && modal.querySelector('.aiqs-offer-card');
  var closeBtn = document.getElementById('aiqsOfferClose');
  var dismissBtn = document.getElementById('aiqsOfferDismiss');
  var cta = document.getElementById('aiqsOfferCta');
  if (!modal || !card) return;

  var shown = false, done = false, lastFocus = null;

  function seen() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }

  // Not while the cookie banner still needs an answer, and not over an open chat.
  function blocked() {
    var banner = document.getElementById('cookie-banner');
    if (banner && banner.classList.contains('show')) return true;
    var chat = document.getElementById('aiqsChat');
    if (chat && chat.classList.contains('open')) return true;
    return false;
  }

  function open() {
    if (shown || done || seen() || blocked()) return;
    shown = true;
    lastFocus = document.activeElement;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (cta) cta.focus();
    aiqsTrack('ViewContent', { content_name: 'Free first BOQ offer' });
  }

  function close(reason) {
    if (!shown) return;
    shown = false; done = true;
    remember();
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (reason === 'dismiss') aiqsTrack('ViewContent', { content_name: 'Free first BOQ offer dismissed' });
  }

  if (closeBtn) closeBtn.addEventListener('click', function () { close('dismiss'); });
  if (dismissBtn) dismissBtn.addEventListener('click', function () { close('dismiss'); });
  modal.addEventListener('click', function (e) { if (e.target === modal) close('dismiss'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && shown) close('dismiss'); });

  // Taking the offer counts as taking it — remember it and let the link run.
  if (cta) {
    cta.addEventListener('click', function () {
      remember(); done = true;
      document.body.style.overflow = '';
      aiqsTrack('Lead', { content_name: 'Free first BOQ claimed' });
    });
  }

  // Keep tab focus inside the dialog while it is up.
  modal.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !shown) return;
    var focusable = card.querySelectorAll('a[href], button');
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  if (seen()) return;

  setTimeout(open, DELAY_MS);

  // Read a third of the page and you are interested enough to be asked.
  var onScroll = function () {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > 0 && window.scrollY / max >= SCROLL_TRIGGER) {
      window.removeEventListener('scroll', onScroll);
      open();
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // Exit intent — pointer leaving towards the tab bar. Desktop only; on a phone
  // there is no such gesture, and the timer covers it.
  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget && e.clientY <= 0) open();
  });
})();
// ── Trustpilot reviews carousel ──────────────────────────────────
// The strip is a real scroll container holding three copies of the review set.
// It rests on the middle copy, so a backwards scroll always has somewhere to
// go; whenever scrollLeft drifts outside the middle third it is teleported back
// by exactly one set width, which is invisible because the content is identical.
// Auto-advance, the arrows, swipe and the keyboard all move the same scrollLeft.
(function () {
  var vp    = document.getElementById('tpMarquee');
  var track = document.getElementById('tpTrack');
  if (!vp || !track) return;

  var prev = document.getElementById('tpPrev');
  var next = document.getElementById('tpNext');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var SPEED       = 0.035;   // px per ms - roughly one card every 10s
  var RESUME_AFTER = 3500;   // idle time before auto-advance picks up again

  var paused = true, resumeTimer = null, lastTs = 0, raf = null;

  function setWidth() { return track.scrollWidth / 3; }

  function normalise() {
    var w = setWidth();
    if (!w) return;
    if (vp.scrollLeft < w * 0.5)      { vp.scrollLeft += w; }
    else if (vp.scrollLeft > w * 1.5) { vp.scrollLeft -= w; }
  }

  function cardStep() {
    var card = track.querySelector('.tp-review');
    return card ? card.getBoundingClientRect().width + 20 : 320;
  }

  function pause(temporary) {
    paused = true;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    if (temporary && !reduce) {
      resumeTimer = setTimeout(function () { paused = false; lastTs = 0; }, RESUME_AFTER);
    }
  }
  function resume() {
    if (reduce) return;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    paused = false; lastTs = 0;
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (paused || stacked()) { lastTs = ts; return; }
    if (!lastTs) { lastTs = ts; return; }
    var dt = ts - lastTs; lastTs = ts;
    if (dt > 100) return;                 // tab was backgrounded - skip the jump
    vp.scrollLeft += SPEED * dt;
    normalise();
  }

  function nudge(dir) {
    if (stacked()) return;
    pause(true);
    // Re-seat into the middle band BEFORE moving. Deferring this to the scroll
    // handler's rAF meant several clicks inside one frame could walk past the
    // wrap point and hit the hard edge of the scroller.
    normalise();
    var target = vp.scrollLeft + dir * cardStep();
    if (typeof vp.scrollTo === 'function') {
      try { vp.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' }); return; }
      catch (e) { /* older browsers reject the options object */ }
    }
    vp.scrollLeft = target;
  }

  if (prev) prev.addEventListener('click', function () { nudge(-1); });
  if (next) next.addEventListener('click', function () { nudge(1); });

  // Manual scrolling wraps too, but not mid-smooth-scroll or the browser
  // cancels its own animation and the arrow click looks like it misfired.
  var scrollTick = false;
  vp.addEventListener('scroll', function () {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(function () { scrollTick = false; if (paused) normalise(); });
  }, { passive: true });

  vp.addEventListener('mouseenter', function () { pause(false); });
  vp.addEventListener('mouseleave', resume);
  vp.addEventListener('focusin',   function () { pause(false); });
  vp.addEventListener('focusout',  resume);
  vp.addEventListener('pointerdown', function () { pause(true); }, { passive: true });
  vp.addEventListener('touchstart',  function () { pause(true); }, { passive: true });

  vp.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); nudge(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { pause(false); } else { lastTs = 0; resume(); }
  });

  // Card widths change at the 640px breakpoint, so re-seat after a resize.
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (stacked()) { paused = true; return; }   // rotated into the stacked layout
      if (!vp.scrollLeft) { vp.scrollLeft = setWidth(); }
      normalise();
      if (!reduce) paused = false;
      if (!raf) raf = requestAnimationFrame(frame);
    }, 150);
  });

  function stacked() {
    // Below the mobile breakpoint the track is a vertical stack, not a
    // scroller. Read it off the computed style so CSS stays the source of truth.
    return window.getComputedStyle(track).flexDirection === 'column';
  }

  function start() {
    if (stacked()) { paused = true; return; }
    vp.scrollLeft = setWidth();          // rest on the middle set
    if (!reduce) paused = false;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // Fonts landing late change card heights, not widths, but wait for load
  // anyway so scrollWidth is final before we seat the initial position.
  if (document.readyState === 'complete') { start(); }
  else { window.addEventListener('load', start); }
})();

// ── Trustpilot score widget ────────────────────────────────────
// The TrustBox bakes its colour scheme in at load, so flipping data-theme on
// the div does nothing on its own - it has to be re-initialised. While the
// template id is still a placeholder the widget gets no class and no init, so
// Trustpilot's auto-scan can't render it as a broken frame; the amber
// "Rated on Trustpilot" pill shows instead.
(function () {
  var el = document.getElementById('tpScore');
  if (!el) return;
  if ((el.getAttribute('data-template-id') || '').indexOf('REPLACE_') !== -1) return;
  el.classList.add('trustpilot-widget');

  var wrap = el.closest ? el.closest('.tp-reviews-score') : null;

  function theme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function render() {
    if (!window.Trustpilot) return false;
    el.setAttribute('data-theme', theme());
    window.Trustpilot.loadFromElement(el, true);
    if (wrap) wrap.classList.add('tp-live');
    return true;
  }

  var tries = 0;
  (function wait() {
    if (render()) return;
    if (++tries > 40) return;
    setTimeout(wait, 150);
  })();

  var last = theme();
  if (window.MutationObserver) {
    new MutationObserver(function () {
      var now = theme();
      if (now !== last) { last = now; render(); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
})();
</script>
<script src="/assets/theme.js" defer></script>
</body>
</html>
