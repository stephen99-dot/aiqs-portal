#!/usr/bin/env node
// scripts/import-sa-rates.js
//
// Turns the South Africa rates library workbook (SA-RL-xxxx) into the JSON the
// server prices from: server/rate-libraries/za.json.
//
// The workbook stays the master. When a new edition is issued, drop the .xlsx
// into server/rate-libraries/ and run:
//
//   node scripts/import-sa-rates.js server/rate-libraries/<file>.xlsx
//
// What is taken from each sheet:
//   Settings  — margin, VAT, escalation, base date
//   Regions   — region name + factor (Gauteng = 1.00 base)
//   Rates     — code, description, unit, section, labour / materials / sundries /
//               plant split and the NET Gauteng-base rate (column R)
//   Labour, Plant, Materials — kept for the chat assistant to quote from
//
// Sell rates are NET x (1 + margin), rounded to cents, exactly as column T of
// the workbook computes them at the base region with no escalation. The region
// factor is applied at pricing time from the job's region.

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const src = process.argv[2] || path.join(__dirname, '..', 'server', 'rate-libraries', 'SA_Rates_Library_SA-RL-2609-01.xlsx');
const out = path.join(__dirname, '..', 'server', 'rate-libraries', 'za.json');

const wb = XLSX.readFile(src);
const rows = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
const r2 = (n) => Math.round(n * 100) / 100;
const excelDate = (serial) => new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10);

// ── Library reference, from the README banner ──
const banner = String((rows('README')[1] || [])[0] || '');
const ref = (banner.match(/Library ref\s+([A-Z0-9-]+)/i) || [])[1] || path.basename(src, '.xlsx');

// ── Settings (label in A, value in B) ──
const settings = {};
for (const [label, value] of rows('Settings')) {
  if (label && value != null) settings[String(label).trim()] = value;
}
const margin = Number(settings['Contractor margin (profit)']);
const vat = Number(settings['VAT']);
const escalation = Number(settings['Forward escalation p.a.']);
const baseDate = excelDate(Number(settings['Library base date']));
if (!(margin > 0 && margin < 1) || !(vat > 0 && vat < 1)) {
  throw new Error(`Settings sheet unreadable (margin=${margin}, vat=${vat})`);
}

// ── Regions ──
const regions = [];
for (const [name, factor, note] of rows('Regions').slice(1)) {
  if (!name || !Number.isFinite(Number(factor))) continue;
  regions.push({ name: String(name).replace(/\s*-\s*BASE$/, '').trim(), factor: Number(factor), isBase: /BASE$/.test(String(name)), note: note || '' });
}

// ── Rates ──
// A: code  B: description  C: unit  D: gang  E: gang-hrs  F: labour R
// M: materials R  N: sundries R  Q: plant R  R: NET (Gauteng base)
const rates = [];
let section = null;
for (const row of rows('Rates').slice(3)) {
  const [code, description, unit] = row;
  if (code && !description && !unit) { section = String(code).trim(); continue; }
  if (!code || !description || !unit) continue;
  const net = Number(row[17]);
  if (!Number.isFinite(net) || net <= 0) continue;
  const labour = Number(row[5]) || 0;
  const plant = Number(row[16]) || 0;
  const materialsR = Number(row[12]) || 0;
  const sundries = Number(row[13]) || 0;
  const materials = materialsR + sundries;
  // The full build-up, so the portal and the assistant can show HOW a rate is
  // made up, not just the total: gang and gang-hours, each material with its
  // quantity, sundries and plant, all at the base region, net of margin.
  const mats = [];
  for (const [ci, qi] of [[6, 7], [8, 9], [10, 11]]) {
    if (row[ci]) mats.push({ code: String(row[ci]).trim(), qty: Number(row[qi]) || 0 });
  }
  rates.push({
    code: String(code).trim(),
    section,
    description: String(description).trim(),
    unit: String(unit).trim(),
    net: r2(net),
    sell: r2(net * (1 + margin)),
    // labour share of the rate, so the BOQ can split labour / materials the
    // same way the UK library does. Plant is counted with materials.
    labour: r2(labour / net),
    materials: r2((materials + plant) / net),
    buildUp: {
      gang: row[3] ? String(row[3]).trim() : null,
      gangHours: Number(row[4]) || 0,
      labourR: r2(labour),
      materials: mats,
      materialsR: r2(materialsR),
      sundriesR: r2(sundries),
      plant: row[14] ? { code: String(row[14]).trim(), qty: Number(row[15]) || 0 } : null,
      plantR: r2(plant),
    },
  });
}

// ── Resources (for the assistant; not used by the pricer) ──
const labour = rows('Labour').slice(1).filter((r) => r[0] && r[1] && Number(r[6]) > 0)
  .map((r) => ({ code: r[0], grade: r[1], basicHr: r2(Number(r[2])), allInHr: r2(Number(r[6])), allInDay: r2(Number(r[7])) }));
const plant = rows('Plant').slice(1).filter((r) => r[0] && r[1] && Number(r[3]) > 0)
  .map((r) => ({ code: r[0], description: r[1], unit: r[2], rate: r2(Number(r[3])) }));
const materials = rows('Materials').slice(1).filter((r) => r[0] && r[2] && Number(r[4]) > 0)
  .map((r) => ({ code: r[0], category: r[1], description: r[2], unit: r[3], price: r2(Number(r[4])), basis: r[5] || null, source: r[6] || null }));
const gangs = rows('Gangs').slice(1).filter((r) => r[0] && Number(r[3]) > 0)
  .map((r) => ({ code: r[0], description: r[1], composition: r[2], ratePerHour: r2(Number(r[3])) }));
const labourOnCostPct = r2(Number(settings['TOTAL ON-COST']) * 100);
// AECOM R/m2 benchmarks (Elemental sheet): building type, low, high at base date.
const elemental = [];
let eSection = null;
for (const r of rows('Elemental').slice(4)) {
  if (r[0] && r[1] == null && r[2] == null) { eSection = String(r[0]).trim(); continue; }
  if (r[0] && Number(r[4]) > 0) elemental.push({ section: eSection, type: String(r[0]).trim(), unit: r[1], low: Math.round(Number(r[4])), high: Math.round(Number(r[5])), mid: Math.round(Number(r[6])) });
}

const lib = {
  ref,
  country: 'ZA',
  currency: 'ZAR',
  baseRegion: (regions.find((r) => r.isBase) || regions[0]).name,
  baseDate,
  marginPct: r2(margin * 100),
  vatPct: r2(vat * 100),
  escalationPctPa: r2(escalation * 100),
  notes: 'Sell rates = NET cost build-up + contractor margin, ex VAT, at the base region. Multiply by the region factor. VAT is added once at the foot of the BOQ.',
  regions,
  rates,
  labourOnCostPct,
  labour,
  gangs,
  plant,
  materials,
  elemental,
};

fs.writeFileSync(out, JSON.stringify(lib, null, 1) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), out)}: ${ref}, ${rates.length} rates, ${regions.length} regions, ${labour.length} labour grades, ${plant.length} plant, ${materials.length} materials, ${gangs.length} gangs, ${elemental.length} elemental benchmarks`);
