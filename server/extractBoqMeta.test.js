const test = require('node:test');
const assert = require('node:assert');
const { extractContractMeta, currentJobTurns } = require('./extractBoqMeta');

function asObj(pairs) {
  return Object.fromEntries(pairs);
}

test('extracts labelled contract fields from a structured insurance brief', () => {
  const brief = `
    Project: Water Damage Reinstatement — Internal Areas
    Employer: Mr & Mrs Williams
    Contract Administrator: Gateley Vinden (T. Walker-Smith)
    CA Ref: 103255
    Contract: JCT Minor Works (MW/MWD) 2024
    Loss Adjuster: Woodgate & Clark (A. Martin)
    Type of loss: Escape of Water
  `;
  const o = asObj(extractContractMeta(brief));
  assert.strictEqual(o['Employer'], 'Mr & Mrs Williams');
  assert.strictEqual(o['Contract Administrator'], 'Gateley Vinden (T. Walker-Smith)');
  assert.strictEqual(o['CA Ref'], '103255');
  assert.strictEqual(o['Contract'], 'JCT Minor Works (MW/MWD) 2024');
  assert.strictEqual(o['Loss Adjuster'], 'Woodgate & Clark (A. Martin)');
  assert.strictEqual(o['Type of loss'], 'Escape of Water');
});

test('handles several fields packed onto one pipe-delimited line', () => {
  const brief = 'Employer: Acme Ltd | Loss Adjuster: Davies Group | Type of loss: Fire';
  const o = asObj(extractContractMeta(brief));
  assert.strictEqual(o['Employer'], 'Acme Ltd');
  assert.strictEqual(o['Loss Adjuster'], 'Davies Group');
  assert.strictEqual(o['Type of loss'], 'Fire');
});

test('CA Ref and Contract Administrator are not swallowed by the looser Contract rule', () => {
  const brief = 'Contract Administrator: Vinden\nCA Reference: AB-12\nContract: JCT MW 2024';
  const o = asObj(extractContractMeta(brief));
  assert.strictEqual(o['Contract Administrator'], 'Vinden');
  assert.strictEqual(o['CA Ref'], 'AB-12');
  assert.strictEqual(o['Contract'], 'JCT MW 2024');
});

test('does not match labels embedded in prose sentences', () => {
  const brief = 'We will administer the contract: please proceed. The employer is happy with progress.';
  const pairs = extractContractMeta(brief);
  // "administer the contract" is not an anchored label; the prose "The employer
  // is happy…" has no colon, so nothing should be extracted.
  assert.deepStrictEqual(pairs, []);
});

test('rejects placeholder / empty values', () => {
  const brief = 'Employer: N/A\nLoss Adjuster: TBC\nType of loss: Escape of Water';
  const o = asObj(extractContractMeta(brief));
  assert.ok(!('Employer' in o), 'N/A rejected');
  assert.ok(!('Loss Adjuster' in o), 'TBC rejected');
  assert.strictEqual(o['Type of loss'], 'Escape of Water');
});

test('returns empty for loose prose with no labelled fields', () => {
  const brief = 'Reinstate the hall, kitchen and bathroom after an escape of water. Strip out and replaster throughout.';
  assert.deepStrictEqual(extractContractMeta(brief), []);
});

test('respects the max cap', () => {
  const brief = 'Employer: Alpha Ltd\nContract Administrator: Beta LLP\nCA Ref: CC-01\nContract: JCT MW\nLoss Adjuster: Echo Group';
  assert.strictEqual(extractContractMeta(brief, { max: 2 }).length, 2);
});

test('the latest statement of a field wins', () => {
  // A thread, not a document: the employer was corrected further down it.
  const thread = 'Employer: Acme Ltd\n\nSorry — wrong client.\n\nEmployer: Bramble Homes Ltd';
  const o = asObj(extractContractMeta(thread));
  assert.strictEqual(o['Employer'], 'Bramble Homes Ltd');
});

test('a superseded field keeps its position in the header', () => {
  const thread = 'Employer: Acme Ltd\nType of loss: Fire\nEmployer: Bramble Homes Ltd';
  const pairs = extractContractMeta(thread);
  assert.deepStrictEqual(pairs.map(p => p[0]), ['Employer', 'Type of loss']);
});

// ── the job boundary ──────────────────────────────────────────────────────────
// One thread, several jobs. These fields are typed once at the top of whichever
// job was live at the time, so an unscoped scan puts the previous job's employer,
// CA and claim number on this bill — which is the whole point of the window.

const turn = (text, ts) => ({ text, ts });

test('the previous job in the same thread is left out of the brief', () => {
  const turns = [
    turn('Employer: Northfield NHS Trust\nCA Ref: NHS-771\nType of loss: Fire', '2026-03-01T09:00:00.000Z'),
    turn('Priced and issued, thanks.', '2026-03-01T11:00:00.000Z'),
    turn('Revised drawings for The Mount attached.', '2026-04-02T08:00:00.000Z'),
  ];
  // The Mount's take-off was written moments after its drawings arrived.
  const window = currentJobTurns(turns, '2026-04-02 08:00:07');
  assert.deepStrictEqual(window.map(t => t.text), ['Revised drawings for The Mount attached.']);
  assert.deepStrictEqual(extractContractMeta(window.map(t => t.text).join('\n')), []);
});

test('the turn that carried the drawings is inside the window, brief and all', () => {
  const turns = [
    turn('Old job — Employer: Northfield NHS Trust', '2026-03-01T09:00:00.000Z'),
    turn('New job, drawings attached.\nEmployer: Mr & Mrs Ellis\nType of loss: Escape of Water', '2026-04-02T08:00:00.000Z'),
    turn('Generate the documents please.', '2026-04-02T08:20:00.000Z'),
  ];
  const window = currentJobTurns(turns, '2026-04-02 08:00:07');
  const o = asObj(extractContractMeta(window.map(t => t.text).join('\n')));
  assert.strictEqual(o['Employer'], 'Mr & Mrs Ellis');
  assert.strictEqual(o['Type of loss'], 'Escape of Water');
});

test('a take-off time is read as UTC, not as the server\'s local clock', () => {
  // SQLite's CURRENT_TIMESTAMP has no zone marker. Read as local time on a server
  // an hour off UTC, the boundary moves by an hour and swallows the job before.
  const turns = [
    turn('Employer: Northfield NHS Trust', '2026-04-02T07:30:00.000Z'),
    turn('Revised drawings for The Mount.', '2026-04-02T08:00:00.000Z'),
  ];
  const window = currentJobTurns(turns, '2026-04-02 08:00:07');
  assert.deepStrictEqual(window.map(t => t.text), ['Revised drawings for The Mount.']);
});

test('with no take-off time there is no boundary, so nothing is dropped', () => {
  const turns = [turn('Employer: Acme Ltd', '2026-04-02T08:00:00.000Z'), turn('Go ahead', '2026-04-02T08:05:00.000Z')];
  assert.strictEqual(currentJobTurns(turns, null).length, 2);
});

test('an older client that sends no timestamps keeps the old whole-thread behaviour', () => {
  const turns = [{ text: 'Employer: Acme Ltd' }, { text: 'Go ahead' }];
  assert.strictEqual(currentJobTurns(turns, '2026-04-02 08:00:07').length, 2);
});

test('turns that cannot be placed either side of the boundary are left out', () => {
  const turns = [
    turn('Employer: Northfield NHS Trust', '2026-03-01T09:00:00.000Z'),
    { text: 'Employer: Someone Else' },                       // no timestamp
    turn('Revised drawings for The Mount.', '2026-04-02T08:00:00.000Z'),
  ];
  const window = currentJobTurns(turns, '2026-04-02 08:00:07');
  assert.deepStrictEqual(window.map(t => t.text), ['Revised drawings for The Mount.']);
});

test('a thread whose turns are all newer than the take-off is kept whole', () => {
  // A re-measure part-way through a job: the take-off predates the turns that
  // followed it, and none of them belong to an earlier job.
  const turns = [
    turn('Employer: Mr & Mrs Ellis', '2026-04-02T09:00:00.000Z'),
    turn('Generate the documents.', '2026-04-02T09:10:00.000Z'),
  ];
  const window = currentJobTurns(turns, '2026-04-02 08:00:07');
  assert.strictEqual(window.length, 2);
});

test('junk timestamps do not silently empty the brief', () => {
  const turns = [turn('Employer: Acme Ltd', 'not a date'), turn('Go ahead', 'also not a date')];
  assert.strictEqual(currentJobTurns(turns, '2026-04-02 08:00:07').length, 2);
});
