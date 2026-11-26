// ═══════════════════════════════════════════════════════════════════════════════
// HOW-TO VIDEOS — server/learn.js
//
// Short screen recordings of the portal doing each thing, in place of written
// instructions: which ones exist, which a builder has ticked off
// (video_views), and the "next steps" the dashboard and the videos page
// suggest from what the account has actually done. The files live in
// videos/<key>.mp4 with a poster videos/<key>.jpg, served at /videos by the
// server (not bundled into the app, so an app update stays small).
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');
const rollout = require('./maxRollout');
const plans = require('./maxPlans');

// package: 'all' | 'max' | 'visualiser' — who the video is for (everyone
// sees every video; the label says which package a feature belongs to).
const VIDEOS = [
  { key: 'around', title: 'Around the portal', blurb: 'Where everything lives: the menu, your projects, MAX, jobs and estimates. One minute — start here.', page: '/dashboard', package: 'all', seconds: 65 },
  { key: 'submit', title: 'Get a BOQ: submit your drawings', blurb: 'Pick the project type, add the address and the drawings, say what the job is. The QS team prices it and it lands in My Projects.', page: '/submit-drawings', package: 'all', seconds: 67 },
  { key: 'max', title: 'Price a small job with MAX', blurb: 'Describe the job in a sentence and MAX prices it from your rates, with every quantity, rate and assumption on screen.', page: '/dashboard', package: 'max', seconds: 46 },
  { key: 'job', title: 'Start a job: three questions', blurb: 'Where it is, what needs done, and whether to draw up the rooms. The brief carries through to the first room and the price.', page: '/jobs/new', package: 'max', seconds: 62 },
  { key: 'room', title: 'Scan a room: photos, sizes, openings', blurb: 'Photos from the corners, the length and width (or a LiDAR scan on an iPhone Pro), the doors and windows, what the customer wants. The plan draws itself and the quantities come off it.', page: '/surveys', package: 'max', seconds: 73 },
  { key: 'visualiser', title: 'Show the customer the finished room', blurb: 'One photo and what is wanted: the Visualiser paints the finished room onto it. Slide between before and after; it goes in the report.', page: '/surveys', package: 'visualiser', seconds: 51 },
  { key: 'estimate', title: 'Edit an estimate and send it as a quote', blurb: 'Change a quantity or a rate, save, and send the quote to the customer with your logo on it.', page: '/estimates', package: 'max', seconds: 55 },
  { key: 'report', title: 'The report, the Excel schedule and the plans', blurb: 'Three exports from any job: a branded PDF report, a schedule in Excel, and scaled floor plans from a scan.', page: '/surveys', package: 'max', seconds: 46 },
  { key: 'rates', title: 'Your rates: how MAX prices from them', blurb: 'Your own rates come first, then the library adjusted for the site. Search, correct and import them here.', page: '/my-rates', package: 'all', seconds: 39 },
  { key: 'branding', title: 'Your logo and colours on every document', blurb: 'Upload the logo and pick your colours once; estimates, reports and client copies all wear them.', page: '/branding', package: 'all', seconds: 30 },
];
const KEYS = new Set(VIDEOS.map((v) => v.key));
// The one-time "here are the videos" prompt, kept in the same table under a
// key no video uses, so it shows once per account and never again.
const INTRO_KEY = '_intro';

function freshUser(user) {
  try { return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) || user; } catch (e) { return user; }
}
function entitlementsFor(user) {
  const row = freshUser(user);
  let e = { visualiser: false };
  try { e = plans.entitlements(row); } catch (err) { e = { visualiser: false }; }
  return { max: !!rollout.isEnabledFor(row), visualiser: !!e.visualiser };
}

function watchedMap(userId) {
  const rows = db.prepare('SELECT video_key, watched_at FROM video_views WHERE user_id = ?').all(userId);
  return Object.fromEntries(rows.map((r) => [r.video_key, r.watched_at]));
}
function videosFor(userId) {
  const w = watchedMap(userId);
  return VIDEOS.map((v) => ({ ...v, src: '/videos/' + v.key + '.mp4', poster: '/videos/' + v.key + '.jpg', watched_at: w[v.key] || null }));
}
function progress(userId) {
  const w = watchedMap(userId);
  return { watched: VIDEOS.filter((v) => w[v.key]).length, total: VIDEOS.length };
}
// Tick a video off (or untick it). Returns when it was watched, or null.
function setWatched(userId, key, watched) {
  if (!KEYS.has(key)) throw Object.assign(new Error('No such video.'), { status: 404 });
  if (watched) db.prepare('INSERT OR REPLACE INTO video_views (user_id, video_key, watched_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(userId, key);
  else db.prepare('DELETE FROM video_views WHERE user_id = ? AND video_key = ?').run(userId, key);
  return watchedMap(userId)[key] || null;
}

// What to do next, from what the account has done so far. Each step names
// the page to do it on and the video that shows it. web_only steps are for
// the website: the iOS app sells nothing (App Store rule 3.1.1).
function nextSteps(user) {
  const ent = entitlementsFor(user);
  const count = (sql, ...args) => { try { return db.prepare(sql).get(...args).c; } catch (e) { return 0; } };
  const projects = count('SELECT COUNT(*) AS c FROM projects WHERE user_id = ?', user.id);
  const rates = count('SELECT COUNT(*) AS c FROM client_rate_library WHERE user_id = ?', user.id);
  const jobs = count('SELECT COUNT(*) AS c FROM room_surveys WHERE user_id = ?', user.id);
  const estimates = count("SELECT COUNT(*) AS c FROM quotes WHERE user_id = ? AND source = 'max'", user.id);
  const renders = count("SELECT COUNT(*) AS c FROM survey_photos WHERE user_id = ? AND kind = 'render'", user.id);
  let branding = null;
  try { branding = db.prepare('SELECT logo_filename FROM user_branding WHERE user_id = ?').get(user.id); } catch (e) { branding = null; }
  const steps = [];
  steps.push({ key: 'submit', title: 'Submit your first drawings', body: 'The QS team prices them and the BOQ lands in My Projects.', path: '/submit-drawings', video: 'submit', done: projects > 0 });
  if (ent.max) steps.push({ key: 'job', title: 'Start your first job', body: 'Three questions, then the rooms or the price.', path: '/jobs/new', video: 'job', done: jobs > 0 });
  if (ent.max) steps.push({ key: 'max', title: 'Price a small job with MAX', body: 'A sentence in, an estimate from your rates out.', path: '/dashboard', video: 'max', done: estimates > 0 });
  if (ent.visualiser) steps.push({ key: 'visualiser', title: 'Show a customer the finished room', body: 'One photo of the room and what they want.', path: '/surveys', video: 'visualiser', done: renders > 0 });
  steps.push({ key: 'rates', title: 'Set your rates', body: 'MAX and the QS team price from them before anything else.', path: '/my-rates', video: 'rates', done: rates > 0 });
  steps.push({ key: 'branding', title: 'Add your logo', body: 'Every estimate, report and client copy wears it.', path: '/branding', video: 'branding', done: !!(branding && branding.logo_filename) });
  if (!ent.max) steps.push({ key: 'upgrade', title: 'See the MAX packages', body: 'MAX, Scan a room and the Visualiser.', path: '/upgrade', video: 'max', done: false, web_only: true });
  return steps;
}

function introSeen(userId) { return !!db.prepare('SELECT 1 AS x FROM video_views WHERE user_id = ? AND video_key = ?').get(userId, INTRO_KEY); }
function markIntro(userId) { db.prepare('INSERT OR REPLACE INTO video_views (user_id, video_key, watched_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(userId, INTRO_KEY); }

module.exports = { VIDEOS, videosFor, progress, setWatched, nextSteps, entitlementsFor, introSeen, markIntro };
