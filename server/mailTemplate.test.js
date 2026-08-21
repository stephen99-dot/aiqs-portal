// Tests for the shared email template.
//
// What matters: platform mail wears AI QS (never the recipient's own logo),
// builder mail wears the builder, everything user-supplied is escaped, and
// the CTA always has a plain-link fallback.

const test = require('node:test');
const assert = require('node:assert');

const { renderHtml, renderText, PLATFORM } = require('./mailTemplate');

const BRANDING = {
  primary_colour: '#14532D',
  accent_colour: '#C2410C',
  footer_text: 'Bloggs Electrics — NICEIC approved',
  company_address: '1 High Street\nMaidstone',
};

const BASE = {
  heading: 'Your rates make the AI QS yours',
  paragraphs: ['Hi John, a week in and your account is still pricing jobs with generic UK rates.', 'Second paragraph.'],
  ctaText: 'Add your rates now',
  ctaUrl: 'https://example.com/my-rates',
};

test('platform mail wears AI QS, not the recipient', () => {
  const html = renderHtml({ ...BASE, platform: true, branding: BRANDING, companyName: 'J l building ltd', hasLogo: true });
  assert.ok(html.includes('AI&nbsp;<span'), 'wordmark missing');
  assert.ok(html.includes(PLATFORM.tagline));
  assert.ok(!html.includes('J l building ltd'), 'recipient branding leaked into platform mail');
  assert.ok(!html.includes('cid:brandlogo'), 'recipient logo leaked into platform mail');
  assert.ok(html.includes(PLATFORM.primary), 'platform colour missing');
  assert.ok(!html.includes('#14532D'), 'builder colour leaked into platform mail');
  assert.ok(html.includes('AI QS account'), 'platform footer missing');
});

test('builder mail wears the builder — name, logo, colours, footer, address', () => {
  const html = renderHtml({ ...BASE, branding: BRANDING, companyName: 'Bloggs Electrics', hasLogo: true });
  assert.ok(html.includes('Bloggs Electrics'));
  assert.ok(html.includes('cid:brandlogo'));
  assert.ok(html.includes('#14532D') && html.includes('#C2410C'));
  assert.ok(html.includes('NICEIC approved'));
  assert.ok(html.includes('1 High Street'));
  assert.ok(!html.includes(PLATFORM.tagline));
});

test('user-supplied text is escaped everywhere it lands', () => {
  const html = renderHtml({
    heading: 'Hello <script>alert(1)</script>',
    paragraphs: ['A & B <tag>'],
    ctaText: '"Go"',
    ctaUrl: 'https://example.com/?a=1&b=2',
    branding: {},
    companyName: 'Nasty <b>Co</b>',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A &amp; B &lt;tag&gt;'));
  assert.ok(!html.includes('<b>Co</b>'));
});

test('CTA renders a button plus a copyable link fallback', () => {
  const html = renderHtml({ ...BASE, branding: {}, companyName: 'X' });
  const occurrences = html.split('https://example.com/my-rates').length - 1;
  assert.ok(occurrences >= 2, 'expected the CTA URL on the button and the fallback line');
  assert.ok(html.includes('Copy this link'));
});

test('button-object paragraphs render as stacked buttons', () => {
  const html = renderHtml({
    heading: 'Top up',
    paragraphs: ['Pick a pack:', { button: true, label: '5 credits', url: 'https://example.com/p5' }],
    branding: {}, companyName: 'X',
  });
  assert.ok(html.includes('https://example.com/p5'));
  assert.ok(html.includes('5 credits'));
});

test('bare URLs inside paragraphs become real links', () => {
  const html = renderHtml({ heading: 'H', paragraphs: ['See https://example.com/x now'], branding: {}, companyName: 'X' });
  assert.ok(html.includes('<a href="https://example.com/x"'));
});

test('preheader defaults to the first non-button paragraph', () => {
  const html = renderHtml({ ...BASE, branding: {}, companyName: 'X' });
  assert.ok(html.includes('display:none') && html.includes('Hi John, a week in'));
});

test('renderText mirrors the content for plain-text clients', () => {
  const text = renderText(BASE);
  assert.ok(text.includes('Your rates make the AI QS yours'));
  assert.ok(text.includes('Add your rates now: https://example.com/my-rates'));
});
