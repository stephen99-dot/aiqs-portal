/**
 * Seed Paul Metalwork's v2 Rate Library
 * 
 * Run once from your portal root:
 *   node server/seed-paul-rates.js
 * 
 * BEFORE RUNNING: Update PAUL_EMAIL below to Paul's actual email in your system.
 */

const db = require('./database');
const { v4: uuidv4 } = require('uuid');

// ══════════════════════════════════════════════════════════
// UPDATE THIS to Paul's actual email in your users table
// ══════════════════════════════════════════════════════════
const PAUL_EMAIL = 'paul@metalworksolutionsuk.com';

const user = db.prepare('SELECT id, full_name, email FROM users WHERE email = ?').get(PAUL_EMAIL);
if (!user) {
  console.error(`\n❌ User not found: ${PAUL_EMAIL}`);
  console.error('   Update PAUL_EMAIL in this script to match his account email.\n');
  console.error('   Current users in database:');
  const users = db.prepare('SELECT email, full_name FROM users ORDER BY created_at').all();
  for (const u of users) console.error(`   - ${u.email} (${u.full_name})`);
  process.exit(1);
}

console.log(`\nSeeding rates for: ${user.full_name} (${user.email})\n`);

const rates = [
  // Structural Steel — core rates from v2 (post Lane End Inn corrections)
  { category: 'structural_steel', item_key: 'labour_rate_hr', display_name: 'Labour Rate (per hour)', value: 52, unit: '£/hr', confidence: 0.95, applied: 12, confirmed: 10, note: 'Confirmed v2 rate' },
  { category: 'structural_steel', item_key: 'site_crew_size', display_name: 'Site Crew Size', value: 3, unit: 'men', confidence: 0.95, applied: 12, confirmed: 10, note: '3-man crew — corrected from 2 after Lane End Inn' },
  { category: 'structural_steel', item_key: 'detailing_hrs_per_tonne', display_name: 'Detailing Hours per Tonne', value: 7.5, unit: 'hrs/T', confidence: 0.90, applied: 10, confirmed: 8, note: 'Standard structural' },
  { category: 'structural_steel', item_key: 'fabrication_hrs_per_tonne', display_name: 'Fabrication Hours per Tonne', value: 12.5, unit: 'hrs/T', confidence: 0.90, applied: 10, confirmed: 8, note: 'Standard structural' },
  { category: 'structural_steel', item_key: 'installation_hrs_per_tonne', display_name: 'Installation Hours per Tonne', value: 15, unit: 'hrs/T', confidence: 0.90, applied: 10, confirmed: 8, note: 'Standard structural' },
  { category: 'structural_steel', item_key: 'fittings_allowance_pct', display_name: 'Fittings Allowance (% on modelled weight)', value: 15, unit: '%', confidence: 0.95, applied: 12, confirmed: 10, note: '15% on modelled weight for cleats, plates, stiffeners' },
  { category: 'structural_steel', item_key: 'bolt_allowance_minimum', display_name: 'Minimum Bolt Allowance', value: 1300, unit: '£', confidence: 0.95, applied: 10, confirmed: 9, note: '£1,300 minimum — previous system underquoted' },
  { category: 'structural_steel', item_key: 'target_all_in_rate_per_tonne', display_name: 'Target All-In Rate per Tonne (S&F)', value: 3544, unit: '£/T', confidence: 0.90, applied: 8, confirmed: 6, note: '£3,544/T all-in for structural steel supply & fit' },
  { category: 'structural_steel', item_key: 'crane_hire_per_day', display_name: 'Crane Hire (per day)', value: 650, unit: '£/day', confidence: 0.85, applied: 6, confirmed: 4, note: 'Standard mobile crane' },
  { category: 'structural_steel', item_key: 'transport_per_load', display_name: 'Transport (per load)', value: 450, unit: '£/load', confidence: 0.80, applied: 5, confirmed: 3, note: 'Flatbed delivery' },
  
  // Architectural Metalwork
  { category: 'architectural_metalwork', item_key: 'balustrade_supply_fit_per_m', display_name: 'Balustrade Supply & Fit', value: 280, unit: '£/m', confidence: 0.80, applied: 4, confirmed: 2, note: 'Standard mild steel with handrail' },
  { category: 'architectural_metalwork', item_key: 'handrail_supply_fit_per_m', display_name: 'Handrail Supply & Fit', value: 120, unit: '£/m', confidence: 0.80, applied: 4, confirmed: 2, note: 'Circular hollow section' },
  { category: 'architectural_metalwork', item_key: 'fire_escape_per_flight', display_name: 'Fire Escape (per flight)', value: 3500, unit: '£/flight', confidence: 0.75, applied: 3, confirmed: 2, note: 'Standard galvanised' },
  
  // Preliminaries
  { category: 'preliminaries', item_key: 'site_setup_allowance', display_name: 'Site Setup Allowance', value: 1500, unit: '£', confidence: 0.80, applied: 5, confirmed: 3, note: 'Welfare, compound, PPE' },
  { category: 'preliminaries', item_key: 'paint_system_per_m2', display_name: 'Paint System (per m²)', value: 18, unit: '£/m²', confidence: 0.85, applied: 6, confirmed: 4, note: 'Intumescent or standard primer + topcoat' },
  { category: 'preliminaries', item_key: 'hot_dip_galvanising_per_tonne', display_name: 'Hot Dip Galvanising', value: 650, unit: '£/T', confidence: 0.80, applied: 4, confirmed: 3, note: 'External steelwork' },
];

const insert = db.prepare(`
  INSERT OR REPLACE INTO client_rate_library 
  (id, user_id, category, item_key, display_name, value, unit, confidence, times_applied, times_confirmed, client_note, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`);

const tx = db.transaction(() => {
  for (const r of rates) {
    insert.run(
      'rl_' + uuidv4().slice(0, 8),
      user.id,
      r.category, r.item_key, r.display_name, r.value, r.unit,
      r.confidence, r.applied, r.confirmed, r.note
    );
  }
});

tx();
console.log(`✅ Seeded ${rates.length} rates for Paul Metalwork\n`);
console.log('Breakdown:');
console.log(`  - Structural Steel: 10 rates`);
console.log(`  - Architectural Metalwork: 3 rates`);
console.log(`  - Preliminaries: 3 rates`);
console.log(`\nThese will now be injected into Claude's system prompt when Paul uses the chatbot.`);
