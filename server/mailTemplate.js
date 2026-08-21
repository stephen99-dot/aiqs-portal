// Email template — server/mailTemplate.js
//
// The one HTML template behind every email the platform sends, split out of
// mailer.js so it stays pure (no db, no SMTP) and testable. Two wardrobes,
// one cut:
//
//   Builder-branded (default) — quote/invoice/variation mail to the BUILDER'S
//   customer: their logo and colours in the header, their footer text. To the
//   recipient it reads as mail from their builder.
//
//   Platform (platform: true) — mail from AI QS to the builder or the admin
//   (rate reminders, credit alerts, "your job is ready", onboarding alerts):
//   AI QS wordmark and colours, platform footer. Before this flag existed
//   these went out wearing the recipient's own branding — an email from
//   yourself, to yourself, asking you to add your rates.
//
// Layout is table-based with everything inlined — the only dialect Outlook,
// Gmail and Apple Mail all speak.

const PLATFORM = {
  name: 'AI QS',
  tagline: 'AI-POWERED QUANTITY SURVEYING',
  primary: '#1B2A4A',
  accent: '#F59E0B',
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Escape a paragraph, then turn any bare URLs back into real links. Mail
// clients render our HTML as-is — they do NOT linkify plain text — so a URL
// left as escaped text would be dead words on the page.
function escapeAndLinkify(s) {
  return escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, (url) =>
    '<a href="' + url + '" style="color:#2563EB;text-decoration:underline;word-break:break-all;">' + url + '</a>');
}

// A button that keeps its shape in Outlook: the colour and radius live on the
// table cell, the anchor just fills it.
function button(url, label, colour, block) {
  return ''
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">'
    +   '<tr><td style="border-radius:10px;background:' + colour + ';mso-padding-alt:14px 36px;">'
    +     '<a href="' + escapeHtml(url) + '" style="display:inline-block;padding:14px 36px;'
    +       (block ? 'min-width:200px;' : '')
    +       'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;'
    +       'font-size:15px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;text-align:center;border-radius:10px;">'
    +     escapeHtml(label) + '</a>'
    +   '</td></tr>'
    + '</table>';
}

// { branding, companyName, heading, paragraphs, ctaText, ctaUrl, hasLogo,
//   platform, preheader }
// Paragraph entries may be { button: true, label, url } objects, rendered as
// stacked buttons in the primary colour (e.g. the top-up packs).
function renderHtml(opts) {
  const platform = !!opts.platform;
  const branding = opts.branding || {};
  const primary = platform ? PLATFORM.primary : (branding.primary_colour || PLATFORM.primary);
  const accent = platform ? PLATFORM.accent : (branding.accent_colour || PLATFORM.accent);
  const companyName = platform ? PLATFORM.name : (opts.companyName || '');
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  // First line the inbox shows after the subject — the opening paragraph
  // unless the caller sets one explicitly.
  const firstText = (opts.paragraphs || []).find(p => p && !p.button);
  const preheader = opts.preheader || firstText || '';

  const paras = (opts.paragraphs || [])
    .map((p, i) => {
      if (p && p.button) return '<div style="margin:0 0 12px;">' + button(p.url, p.label, primary, true) + '</div>';
      const lead = i === 0;
      return '<p style="margin:0 0 16px;font-family:' + font + ';'
        + 'font-size:' + (lead ? '16px' : '15px') + ';line-height:1.65;'
        + 'color:' + (lead ? '#1E293B' : '#475569') + ';">'
        + escapeAndLinkify(p) + '</p>';
    })
    .join('');

  const cta = (opts.ctaText && opts.ctaUrl)
    ? '<div style="margin:30px 0 6px;">' + button(opts.ctaUrl, opts.ctaText, accent) + '</div>'
      + '<p style="margin:14px 0 0;font-family:' + font + ';font-size:12px;line-height:1.5;color:#94A3B8;text-align:center;word-break:break-all;">'
      + 'Button not working? Copy this link: '
      + '<a href="' + escapeHtml(opts.ctaUrl) + '" style="color:#64748B;text-decoration:underline;">' + escapeHtml(opts.ctaUrl) + '</a></p>'
    : '';

  // Header: AI QS wordmark for platform mail; the builder's logo + name for
  // branded mail.
  const header = platform
    ? '<div style="font-family:' + font + ';font-size:21px;font-weight:800;letter-spacing:0.5px;color:#ffffff;">'
      + 'AI&nbsp;<span style="color:' + accent + ';">QS</span></div>'
      + '<div style="font-family:' + font + ';margin-top:4px;font-size:10px;font-weight:600;letter-spacing:2px;color:#8CA0C6;">'
      + PLATFORM.tagline + '</div>'
    : (opts.hasLogo
        ? '<img src="cid:brandlogo" alt="" style="max-height:44px;max-width:150px;vertical-align:middle;background:#ffffff;border-radius:8px;padding:4px;margin-right:14px;" />'
        : '')
      + '<span style="font-family:' + font + ';color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.2px;vertical-align:middle;">'
      + escapeHtml(companyName) + '</span>';

  const footer = platform
    ? '<div style="font-family:' + font + ';font-size:12.5px;font-weight:700;color:#64748B;letter-spacing:0.3px;">AI QS</div>'
      + '<div style="font-family:' + font + ';margin-top:4px;font-size:12px;color:#94A3B8;">Your rates. Your jobs. Priced in minutes.</div>'
      + '<div style="font-family:' + font + ';margin-top:10px;font-size:11px;color:#B6C2D4;">You\'re receiving this because you have an AI QS account.</div>'
    : '<div style="font-family:' + font + ';font-size:12px;color:#94A3B8;">'
      + escapeHtml(branding.footer_text || companyName || '')
      + '</div>'
      + (branding.company_address
          ? '<div style="font-family:' + font + ';margin-top:4px;font-size:12px;color:#B6C2D4;white-space:pre-line;">' + escapeHtml(branding.company_address) + '</div>'
          : '');

  return ''
    + '<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    + '<body style="margin:0;padding:0;background:#EDF1F7;">'
    // Hidden preheader — the snippet line inboxes show under the subject.
    + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' + escapeHtml(preheader) + '&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDF1F7;">'
    + '<tr><td align="center" style="padding:32px 14px;">'
    +   '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;">'
    // Card
    +     '<tr><td style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0;">'
    +       '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    // Header band + accent strip
    +         '<tr><td style="background:' + primary + ';padding:22px 32px;">' + header + '</td></tr>'
    +         '<tr><td style="background:' + accent + ';height:4px;line-height:4px;font-size:2px;">&nbsp;</td></tr>'
    // Body
    +         '<tr><td style="padding:32px 32px 26px;">'
    +           '<h1 style="margin:0 0 16px;font-family:' + font + ';font-size:22px;line-height:1.3;font-weight:800;letter-spacing:-0.2px;color:#0F172A;">'
    +           escapeHtml(opts.heading || '') + '</h1>'
    +           paras
    +           cta
    +         '</td></tr>'
    // Footer
    +         '<tr><td style="background:#F8FAFC;border-top:1px solid #EDF1F7;padding:18px 32px;text-align:center;">' + footer + '</td></tr>'
    +       '</table>'
    +     '</td></tr>'
    +   '</table>'
    + '</td></tr></table>'
    + '</body></html>';
}

function renderText({ heading, paragraphs, ctaText, ctaUrl }) {
  const lines = (paragraphs || []).map(p => (p && p.button) ? p.label + ': ' + p.url : p);
  const parts = [heading, '', ...lines];
  if (ctaText && ctaUrl) parts.push('', ctaText + ': ' + ctaUrl);
  return parts.join('\n');
}

module.exports = { renderHtml, renderText, escapeHtml, PLATFORM };
