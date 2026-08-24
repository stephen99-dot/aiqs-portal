// Tests for the QS-standard passes added from the improvement brief:
// statutory VAT determination (§9), programme derivation (§8), the
// always-missed checklists (§13) and the risk/qualifications pass (§7, §5.2).
const test = require('node:test');
const assert = require('node:assert');
const { determineVat, ESM_SUNSET } = require('./statutory');
const { deriveProgramme } = require('./programme');
const { checkMissedItems } = require('./missedItems');
const { scanDeferrals, buildQualifications } = require('./qualifications');

// ── §9 Statutory ──────────────────────────────────────────────────────────
test('a garage conversion is 20% with no relief, and says why', () => {
  const r = determineVat({ projectType: 'Garage conversion to home office' });
  assert.strictEqual(r.rate, 20);
  assert.match(r.reasoning.join(' '), /non-residential/i);
  assert.match(r.warnings.join(' '), /commonly assume 5%/i);
});

test('an inherited/empty property raises the 5% question first', () => {
  const r = determineVat({ projectType: 'Refurbishment', enquiryText: 'we inherited the house, it has been empty since 2023' });
  assert.match(r.basis, /empty-property/i);
  assert.strictEqual(r.confidence, 'low');
  assert.match(r.queries[0], /RAISE FIRST/);
  assert.match(r.queries[0], /two years/i);
});

test('new build is not automatically zero rated when it includes non-dwellings', () => {
  const dwelling = determineVat({ projectType: 'New build dwelling' });
  assert.strictEqual(dwelling.rate, 0);

  const mixed = determineVat({ projectType: 'New build dwelling with plant room and game larder' });
  assert.strictEqual(mixed.rate, 20, 'ancillary buildings must not inherit the dwelling answer');
  assert.match(mixed.warnings.join(' '), /previous new build/i);
});

test('disabled-adaptation tells are picked up even though nothing is labelled', () => {
  const r = determineVat({ projectType: 'Bathroom works',
    description: 'form ground floor bedroom with adjoining wet room, grab rails, widen door openings to 900' });
  assert.match(r.basis, /Group 12/);
  assert.match(r.reasoning.join(' '), /never labelled/i);
});

test('energy-saving materials carry the absorption trap and the sunset', () => {
  const r = determineVat({ projectType: 'Solar PV and battery', today: '2026-08-24' });
  assert.strictEqual(r.rate, 0);
  assert.match(r.warnings.join(' '), /own bill section/i);
  const later = determineVat({ projectType: 'Solar PV and battery', today: '2027-06-01' });
  assert.strictEqual(later.rate, 5, 'after the sunset the rate reverts');
});

test('a commercial solar farm is 20% throughout', () => {
  const r = determineVat({ projectType: 'Ground-mount solar farm', description: 'commercial generation asset' });
  assert.strictEqual(r.rate, 20);
});

test('the ESM sunset date has not silently passed', () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(today <= ESM_SUNSET,
    `The energy-saving-materials sunset (${ESM_SUNSET}) has passed — re-check Notice 708/6 and update the rule.`);
});

test('Ireland carries the two-thirds rule and does not inherit the reverse charge', () => {
  const r = determineVat({ jurisdiction: 'IE', projectType: 'House extension' });
  assert.strictEqual(r.rate, 13.5);
  assert.match(r.warnings.join(' '), /two[- ]thirds/i);
  assert.match(r.queries.join(' '), /principal contractor/i);
});

// ── §8 Programme ──────────────────────────────────────────────────────────
const PROG_SECTIONS = [
  { title: 'Preliminaries', items: [{ description: 'Site management and supervision', labour: 15500, qty: 1 }] },
  { title: 'Substructure', items: [
    { description: 'Underpinning to party wall in bays', labour: 22000, qty: 14 },
    { description: 'Facing brickwork outer leaf', labour: 18000, qty: 120 },
  ] },
];

test('site management is stripped out before the crew is derived, and the strip is published', () => {
  const r = deriveProgramme(PROG_SECTIONS, { dayRate: 250 });
  assert.strictEqual(r.managementDays, 62);
  assert.strictEqual(r.operativeDays, 160);
  assert.match(r.notes.join(' '), /stripped out/i);
});

test('the crew is capped by the physical constraint, not by arithmetic', () => {
  const r = deriveProgramme(PROG_SECTIONS, { dayRate: 250, crewCap: 3, crewCapReason: 'single front door' });
  assert.strictEqual(r.crew, 3);
  assert.ok(r.arithmeticCrew > 3);
  assert.strictEqual(r.crewLimitedByAccess, true);
  assert.match(r.notes.join(' '), /unbuildable/i);
});

test('sequence-bound work sets a floor that adding men cannot shorten', () => {
  // 14 bays at 2 bays per 4 working days = 28 working days = 6 weeks.
  const r = deriveProgramme(PROG_SECTIONS, { dayRate: 250, crewCap: 3 });
  const under = r.sequenceBound.find((s) => s.id === 'underpinning');
  assert.ok(under, 'underpinning must be recognised as sequence-bound');
  assert.strictEqual(under.weeks, 6);
  assert.match(r.notes.join(' '), /Adding men cannot shorten it/);
});

test('CDM notifiability is computed once the programme exists', () => {
  const big = [{ title: 'W', items: [{ description: 'Refurbishment works', labour: 250 * 600, qty: 1 }] }];
  const r = deriveProgramme(big, { dayRate: 250 });
  assert.strictEqual(r.cdmNotifiable, true);
  assert.match(r.notes.join(' '), /F10/);
});

// ── §13 Missed items ──────────────────────────────────────────────────────
test('an item already measured is not raised as missing', () => {
  const withAlarms = checkMissedItems(
    [{ description: 'Interlinked smoke alarms and kitchen heat alarm' }],
    { projectType: 'Whole house refurbishment' },
  );
  assert.ok(!withAlarms.findings.some((f) => f.id === 'interlinked_alarms'));

  const without = checkMissedItems([{ description: 'Facing brickwork' }], { projectType: 'Whole house refurbishment' });
  assert.ok(without.findings.some((f) => f.id === 'interlinked_alarms'));
});

test('rules only fire for the project types they apply to', () => {
  const garage = checkMissedItems([], { projectType: 'Garage conversion' });
  assert.ok(garage.findings.some((f) => f.id === 'garage_slab_fall'));

  const roofOnly = checkMissedItems([], { projectType: 'Re-roof' });
  assert.ok(!roofOnly.findings.some((f) => f.id === 'garage_slab_fall'));
  assert.ok(roofOnly.findings.some((f) => f.id === 'eaves_overhang'));
});

test('the access check runs on every job regardless of type', () => {
  const r = checkMissedItems([{ description: 'anything' }], { projectType: 'Something unusual' });
  assert.ok(r.findings.some((f) => f.id === 'access_reaches_all_faces'));
});

// ── §7 / §5.2 Qualifications and deferrals ────────────────────────────────
const PACK = `Foundation depths to be confirmed on site.
Existing foundations ASSUMED adequate, to be verified, allow for underpinning if not.
Refer to structural engineer for the beam over the opening.
Drainage runs assumed. Steelwork by others. Subject to survey.
Web buckling and crushing has not been checked.`;

test('deferrals are counted and turned into the provisional-sum argument', () => {
  const d = scanDeferrals(PACK);
  assert.ok(d.total >= 6, `expected several deferrals, got ${d.total}`);
  assert.match(d.argument, /provisional-sum schedule/);
  assert.ok(d.byKind.length > 1);
});

test('a calculation that says on its face it was not checked is surfaced', () => {
  assert.ok(scanDeferrals(PACK).unchecked > 0);
  assert.strictEqual(scanDeferrals('All checks completed.').unchecked, 0);
});

test('an assumptions panel is read as an instruction to price', () => {
  const d = scanDeferrals(PACK);
  assert.ok(d.priceableAssumptions.length > 0);
  assert.match(d.priceableAssumptions.join(' '), /verified/i);
});

test('the qualifications block covers all nine, including the sub-contract terms', () => {
  const q = buildQualifications({ programmeWeeks: 11, ohpPct: 15, vatBasis: 'Standard rated at 20%' });
  assert.strictEqual(q.length, 9);
  // #5 is the one most often left out and the most valuable.
  assert.match(q[4], /SUB-CONTRACT TERMS/);
  assert.match(q[4], /professional indemnity/i);
  assert.match(q[3], /11-week/);
  assert.match(q[5], /15%/);
});
