// The Trustpilot importer behind the sign-in page: the two shapes a profile
// page embeds its reviews in, the sync into SQLite (new, changed, vanished
// and failed), and the filtered read the public endpoint serves.
//
// In-memory database throughout — never the developer's data/ database.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const { parseTrustpilotHtml, syncTrustpilotReviews, getTrustpilotReviews, readMeta, MIN_RATING_SHOWN } = require('./trustpilotReviews');

const freshDb = () => new Database(':memory:');

function nextDataPage(reviews, business, totalPages = 1) {
  const data = { props: { pageProps: { businessUnit: business, reviews, filters: { pagination: { totalPages } } } } };
  return '<!doctype html><html><head><title>The AI QS Reviews</title></head><body><div id="__next"></div>'
    + '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + '</script></body></html>';
}
const tpReview = (id, displayName, rating, title, text, publishedDate, extra = {}) => ({
  id, rating, title, text, language: 'en',
  dates: { publishedDate, experiencedDate: publishedDate },
  consumer: { id: 'c-' + id, displayName, countryCode: 'GB' },
  labels: { verification: { isVerified: !!extra.verified } },
  reply: extra.reply ? { message: extra.reply } : null,
});
const BUSINESS = { displayName: 'The AI QS', identifyingName: 'theaiqs.co.uk', trustScore: 4.5, numberOfReviews: 3, stars: 4.5 };

const PAGE = nextDataPage([
  tpReview('r3', 'Dave Cole', 5, 'Fast and accurate', 'Drawings in Monday, BOQ back Tuesday. Spot on.', '2026-09-20T10:00:00.000Z', { verified: true, reply: 'Thanks Dave' }),
  tpReview('r2', 'Priya N', 4, 'Good value', 'Clear findings report, a couple of rates to query.', '2026-08-02T09:00:00.000Z'),
  tpReview('r1', 'Anon', 2, 'Slow reply', 'Took a day to hear back.', '2026-07-01T08:00:00.000Z'),
], BUSINESS);

const fetchOf = (pages) => async (url) => {
  const page = pages[url];
  if (page == null) return { ok: false, status: 404, text: async () => '' };
  if (page instanceof Error) throw page;
  return { ok: true, status: 200, text: async () => page };
};
const URL1 = 'https://uk.trustpilot.com/review/theaiqs.co.uk';

test('parses reviews and the business figures out of __NEXT_DATA__', () => {
  const parsed = parseTrustpilotHtml(PAGE);
  assert.strictEqual(parsed.source, 'next_data');
  assert.deepStrictEqual(parsed.business, { display_name: 'The AI QS', trust_score: 4.5, number_of_reviews: 3, stars: 4.5 });
  assert.strictEqual(parsed.reviews.length, 3);
  const r = parsed.reviews[0];
  assert.deepStrictEqual(
    [r.id, r.author, r.rating, r.title, r.body, r.published_at, r.verified, r.country, r.reply, r.review_url],
    ['r3', 'Dave Cole', 5, 'Fast and accurate', 'Drawings in Monday, BOQ back Tuesday. Spot on.', '2026-09-20T10:00:00.000Z', true, 'GB', 'Thanks Dave', 'https://uk.trustpilot.com/reviews/r3']
  );
  assert.strictEqual(parsed.reviews[1].verified, false);
});

test('falls back to the schema.org JSON-LD when __NEXT_DATA__ is absent, and gives up on a page with neither', () => {
  const ld = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'LocalBusiness', name: 'The AI QS', aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '13' } },
      { '@type': 'Review', '@id': 'https://uk.trustpilot.com/reviews/abc123', author: { '@type': 'Person', name: 'Sam T' }, datePublished: '2026-09-01T00:00:00.000Z', headline: 'Great', reviewBody: 'Very happy.', reviewRating: { '@type': 'Rating', ratingValue: 5 }, inLanguage: 'en' },
      { '@type': 'Review', author: { '@type': 'Person', name: 'Jo' }, datePublished: '2026-08-01T00:00:00.000Z', headline: 'OK', reviewBody: 'Fine.', reviewRating: { '@type': 'Rating', ratingValue: '3' } },
    ],
  };
  const html = '<html><head><script type="application/ld+json" data-business-unit-json-ld="true">' + JSON.stringify(ld) + '</script></head><body></body></html>';
  const parsed = parseTrustpilotHtml(html);
  assert.strictEqual(parsed.source, 'json_ld');
  assert.deepStrictEqual(parsed.business, { display_name: 'The AI QS', trust_score: 4.5, number_of_reviews: 13, stars: null });
  assert.deepStrictEqual(parsed.reviews.map((r) => [r.id.length > 0, r.author, r.rating, r.title, r.body]),
    [[true, 'Sam T', 5, 'Great', 'Very happy.'], [true, 'Jo', 3, 'OK', 'Fine.']]);
  assert.strictEqual(parsed.reviews[0].id, 'abc123', 'the id comes from the review URL when there is one');
  assert.strictEqual(parseTrustpilotHtml('<html><body>Access denied</body></html>'), null);
});

test('sync imports every review, keeps all of them for the admin, and serves only the showcase ratings newest first', async () => {
  const db = freshDb();
  const result = await syncTrustpilotReviews({ db, url: URL1, fetchImpl: fetchOf({ [URL1]: PAGE }) });
  assert.ok(result.ok, result.message);
  assert.strictEqual(result.imported, 3);
  assert.match(result.message, /3 reviews imported · TrustScore 4\.5 from 3 on Trustpilot/);
  const meta = readMeta(db);
  assert.strictEqual(meta.status, 'ok');
  assert.strictEqual(meta.trust_score, 4.5);
  assert.ok(meta.last_success_at);

  const shown = getTrustpilotReviews({ db });
  assert.strictEqual(MIN_RATING_SHOWN, 4);
  assert.deepStrictEqual(shown.reviews.map((r) => [r.id, r.rating]), [['r3', 5], ['r2', 4]], 'the 2-star review is kept but not rotated on the sign-in page');
  assert.deepStrictEqual(shown.business, { display_name: 'The AI QS', trust_score: 4.5, number_of_reviews: 3, stars: 4.5, url: URL1 });
  assert.strictEqual(shown.reviews[0].verified, true);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM trustpilot_reviews').get().n, 3);
});

test('a re-sync updates edited reviews and retires ones Trustpilot no longer shows', async () => {
  const db = freshDb();
  await syncTrustpilotReviews({ db, url: URL1, fetchImpl: fetchOf({ [URL1]: PAGE }) });
  const later = nextDataPage([
    tpReview('r4', 'New Reviewer', 5, 'Brilliant', 'Second job through them, faultless.', '2026-10-01T10:00:00.000Z'),
    tpReview('r3', 'Dave Cole', 5, 'Fast and accurate (edited)', 'Drawings in Monday, BOQ back Tuesday.', '2026-09-20T10:00:00.000Z'),
    tpReview('r2', 'Priya N', 4, 'Good value', 'Clear findings report.', '2026-08-02T09:00:00.000Z'),
  ], { ...BUSINESS, numberOfReviews: 3, trustScore: 4.7 });
  const result = await syncTrustpilotReviews({ db, url: URL1, fetchImpl: fetchOf({ [URL1]: later }) });
  assert.ok(result.ok);
  assert.strictEqual(result.retired, 1, 'r1 vanished from the profile');
  const ids = db.prepare('SELECT id, title FROM trustpilot_reviews ORDER BY id').all();
  assert.deepStrictEqual(ids, [{ id: 'r2', title: 'Good value' }, { id: 'r3', title: 'Fast and accurate (edited)' }, { id: 'r4', title: 'Brilliant' }]);
  assert.strictEqual(getTrustpilotReviews({ db }).reviews[0].id, 'r4', 'newest first');
  assert.strictEqual(readMeta(db).trust_score, 4.7);
});

test('a multi-page profile is read page by page', async () => {
  const db = freshDb();
  const p1 = nextDataPage([tpReview('a', 'A', 5, 'One', 'First page.', '2026-09-01T00:00:00.000Z')], { ...BUSINESS, numberOfReviews: 2 }, 2);
  const p2 = nextDataPage([tpReview('b', 'B', 5, 'Two', 'Second page.', '2026-08-01T00:00:00.000Z')], { ...BUSINESS, numberOfReviews: 2 }, 2);
  const result = await syncTrustpilotReviews({ db, url: URL1, fetchImpl: fetchOf({ [URL1]: p1, [URL1 + '?page=2']: p2 }) });
  assert.ok(result.ok, result.message);
  assert.strictEqual(result.imported, 2);
});

test('a failed read is recorded and leaves the last good reviews in place', async () => {
  const db = freshDb();
  await syncTrustpilotReviews({ db, url: URL1, fetchImpl: fetchOf({ [URL1]: PAGE }) });
  // Blocked / down.
  let result = await syncTrustpilotReviews({ db, url: URL1, fetchImpl: fetchOf({}) });
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /HTTP 404/);
  // Reachable, but the layout no longer carries review data.
  result = await syncTrustpilotReviews({ db, url: URL1, fetchImpl: fetchOf({ [URL1]: '<html><body>Just a wall</body></html>' }) });
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /did not contain any review data/);
  const meta = readMeta(db);
  assert.strictEqual(meta.status, 'failed');
  assert.ok(meta.last_success_at, 'the earlier success is still on record');
  const shown = getTrustpilotReviews({ db });
  assert.strictEqual(shown.reviews.length, 2, 'the sign-in page keeps showing the last good set');
  assert.strictEqual(shown.business.trust_score, 4.5);
});

test('before any sync the public read is empty but well-formed', () => {
  const out = getTrustpilotReviews({ db: freshDb() });
  assert.deepStrictEqual(out.reviews, []);
  assert.strictEqual(out.synced_at, null);
  assert.strictEqual(out.business.trust_score, null);
  assert.match(out.business.url, /trustpilot\.com\/review\//);
});
