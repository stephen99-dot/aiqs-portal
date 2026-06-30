const test = require('node:test');
const assert = require('node:assert');
const { extractContractMeta } = require('./extractBoqMeta');

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
