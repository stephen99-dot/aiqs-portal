/**
 * Seed ALL Existing Client Rate Libraries
 * 
 * Run once from your portal root:
 *   node server/seed-client-rates.js
 * 
 * BEFORE RUNNING: Update the email addresses below to match
 * each client's actual email in your users table.
 * 
 * If an email doesn't match, the script skips that client
 * and tells you — it won't crash.
 */

const db = require('./database');
const { v4: uuidv4 } = require('uuid');

// ══════════════════════════════════════════════════════════
// UPDATE THESE to the actual emails in your users table
// ══════════════════════════════════════════════════════════
const CLIENT_EMAILS = {
  paul:    'paul@metalworksolutionsuk.com',
  sandeep: 'ssira@sirabuilding.com',
  penn:    '	simon.bayton@penncontracting.co.uk',      // Brian Scully or Simon Bayton
  jbp:     'James@jbpdevelopments.com',        // James Beare or Justin Shee
  andy:    'a.craig@abbeygroup.co.uk',       // Andy Craig
};

function getUser(key) {
  const email = CLIENT_EMAILS[key];
  if (!email || email.startsWith('REPLACE')) return null;
  return db.prepare('SELECT id, full_name, email FROM users WHERE email = ?').get(email);
}

const insert = db.prepare(`
  INSERT OR REPLACE INTO client_rate_library 
  (id, user_id, category, item_key, display_name, value, unit, confidence, times_applied, times_confirmed, client_note, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`);

function seedRates(userId, rates) {
  const tx = db.transaction(() => {
    for (const r of rates) {
      insert.run(
        'rl_' + uuidv4().slice(0, 8), userId,
        r.category, r.item_key, r.display_name, r.value, r.unit,
        r.confidence || 0.85, r.applied || 5, r.confirmed || 3, r.note || ''
      );
    }
  });
  tx();
  return rates.length;
}

console.log('\n════════════════════════════════════════════════');
console.log('  Seeding Client Rate Libraries');
console.log('════════════════════════════════════════════════\n');

// Show all users in database for reference
const allUsers = db.prepare('SELECT email, full_name, role FROM users ORDER BY created_at').all();
console.log('Users in database:');
for (const u of allUsers) console.log(`  ${u.role === 'admin' ? '👑' : '👤'} ${u.email} — ${u.full_name}`);
console.log('');

let totalSeeded = 0;

// ═══════════════════════════════════════════════════════════════════
// PAUL METALWORK — v2 rates (post Lane End Inn corrections)
// ═══════════════════════════════════════════════════════════════════
const paul = getUser('paul');
if (paul) {
  const count = seedRates(paul.id, [
    { category: 'structural_steel', item_key: 'labour_rate_hr', display_name: 'Labour Rate', value: 52, unit: '£/hr', confidence: 0.95, applied: 12, confirmed: 10, note: 'Confirmed v2 rate' },
    { category: 'structural_steel', item_key: 'site_crew_size', display_name: 'Site Crew Size', value: 3, unit: 'men', confidence: 0.95, applied: 12, confirmed: 10, note: '3-man crew — corrected from 2 after Lane End Inn' },
    { category: 'structural_steel', item_key: 'detailing_hrs_per_tonne', display_name: 'Detailing Hours/Tonne', value: 7.5, unit: 'hrs/T', confidence: 0.90, applied: 10, confirmed: 8 },
    { category: 'structural_steel', item_key: 'fabrication_hrs_per_tonne', display_name: 'Fabrication Hours/Tonne', value: 12.5, unit: 'hrs/T', confidence: 0.90, applied: 10, confirmed: 8 },
    { category: 'structural_steel', item_key: 'installation_hrs_per_tonne', display_name: 'Installation Hours/Tonne', value: 15, unit: 'hrs/T', confidence: 0.90, applied: 10, confirmed: 8 },
    { category: 'structural_steel', item_key: 'fittings_allowance_pct', display_name: 'Fittings Allowance (% modelled weight)', value: 15, unit: '%', confidence: 0.95, applied: 12, confirmed: 10, note: '15% for cleats, plates, stiffeners' },
    { category: 'structural_steel', item_key: 'bolt_allowance_minimum', display_name: 'Minimum Bolt Allowance', value: 1300, unit: '£', confidence: 0.95, applied: 10, confirmed: 9, note: '£1,300 min — previous system underquoted' },
    { category: 'structural_steel', item_key: 'target_all_in_rate_per_tonne', display_name: 'Target All-In Rate/Tonne (S&F)', value: 3544, unit: '£/T', confidence: 0.90, applied: 8, confirmed: 6, note: 'Supply & fit structural steel' },
    { category: 'structural_steel', item_key: 'crane_hire_per_day', display_name: 'Crane Hire', value: 650, unit: '£/day', confidence: 0.85, applied: 6, confirmed: 4 },
    { category: 'structural_steel', item_key: 'transport_per_load', display_name: 'Transport per Load', value: 450, unit: '£/load', confidence: 0.80, applied: 5, confirmed: 3 },
    { category: 'architectural_metalwork', item_key: 'balustrade_supply_fit', display_name: 'Balustrade Supply & Fit', value: 280, unit: '£/m', confidence: 0.80, applied: 4, confirmed: 2 },
    { category: 'architectural_metalwork', item_key: 'handrail_supply_fit', display_name: 'Handrail Supply & Fit', value: 120, unit: '£/m', confidence: 0.80, applied: 4, confirmed: 2 },
    { category: 'architectural_metalwork', item_key: 'fire_escape_per_flight', display_name: 'Fire Escape (per flight)', value: 3500, unit: '£/flight', confidence: 0.75, applied: 3, confirmed: 2 },
    { category: 'preliminaries', item_key: 'site_setup_allowance', display_name: 'Site Setup Allowance', value: 1500, unit: '£', confidence: 0.80, applied: 5, confirmed: 3 },
    { category: 'preliminaries', item_key: 'paint_system_per_m2', display_name: 'Paint System', value: 18, unit: '£/m²', confidence: 0.85, applied: 6, confirmed: 4 },
    { category: 'preliminaries', item_key: 'hot_dip_galvanising_per_tonne', display_name: 'Hot Dip Galvanising', value: 650, unit: '£/T', confidence: 0.80, applied: 4, confirmed: 3 },
  ]);
  console.log(`✅ Paul Metalwork: ${count} rates seeded`);
  totalSeeded += count;
} else {
  console.log(`⏭️  Paul Metalwork: skipped (email not set or not found)`);
}

// ═══════════════════════════════════════════════════════════════════
// SANDEEP / S SIRA GROUP — 15% markup rates
// ═══════════════════════════════════════════════════════════════════
const sandeep = getUser('sandeep');
if (sandeep) {
  const count = seedRates(sandeep.id, [
    { category: 'preliminaries', item_key: 'principal_day', display_name: 'Principal (Day Rate)', value: 300, unit: '£/day', confidence: 0.90, applied: 8, confirmed: 6 },
    { category: 'preliminaries', item_key: 'site_manager_day', display_name: 'Site Manager (Day Rate)', value: 200, unit: '£/day', confidence: 0.90, applied: 8, confirmed: 6 },
    { category: 'preliminaries', item_key: 'labourer_day', display_name: 'Labourer (Day Rate)', value: 150, unit: '£/day', confidence: 0.90, applied: 8, confirmed: 6 },
    { category: 'carpentry', item_key: 'carpenter_day', display_name: 'Carpenter (Day Rate)', value: 250, unit: '£/day', confidence: 0.90, applied: 7, confirmed: 5 },
    { category: 'masonry', item_key: 'bricklaying_gang_day', display_name: 'Bricklaying Gang (Day Rate)', value: 850, unit: '£/day', confidence: 0.90, applied: 7, confirmed: 5 },
    { category: 'groundworks', item_key: 'concrete_supply_place', display_name: 'Concrete Supply & Place', value: 130, unit: '£/m³', confidence: 0.85, applied: 6, confirmed: 4 },
    { category: 'plastering', item_key: 'render_m2', display_name: 'Render', value: 80, unit: '£/m²', confidence: 0.85, applied: 6, confirmed: 4 },
    { category: 'flooring', item_key: 'lvt_supply_fit', display_name: 'LVT Supply & Fit', value: 60, unit: '£/m²', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'flooring', item_key: 'carpet_supply_fit', display_name: 'Carpet Supply & Fit', value: 25, unit: '£/m²', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'preliminaries', item_key: 'markup_pct', display_name: 'Standard Markup', value: 15, unit: '%', confidence: 0.95, applied: 10, confirmed: 8, note: '15% across all trades' },
  ]);
  console.log(`✅ Sandeep (S Sira Group): ${count} rates seeded`);
  totalSeeded += count;
} else {
  console.log(`⏭️  Sandeep (S Sira Group): skipped (email not set or not found)`);
}

// ═══════════════════════════════════════════════════════════════════
// PENN CONTRACTING — London rates with uplift factors
// ═══════════════════════════════════════════════════════════════════
const penn = getUser('penn');
if (penn) {
  const count = seedRates(penn.id, [
    { category: 'location_factors', item_key: 'london_labour_uplift', display_name: 'London Labour Uplift', value: 30, unit: '%', confidence: 0.95, applied: 15, confirmed: 12, note: '+30% on standard labour for London' },
    { category: 'location_factors', item_key: 'london_materials_uplift', display_name: 'London Materials Uplift', value: 15, unit: '%', confidence: 0.95, applied: 15, confirmed: 12, note: '+15% on standard materials for London' },
    { category: 'preliminaries', item_key: 'skip_hire_8yd', display_name: 'Skip Hire (8yd)', value: 380, unit: '£/nr', confidence: 0.85, applied: 8, confirmed: 6, note: 'London rates' },
    { category: 'preliminaries', item_key: 'scaffold_per_week', display_name: 'Scaffolding', value: 850, unit: '£/week', confidence: 0.85, applied: 7, confirmed: 5, note: 'Standard terrace scaffold' },
    { category: 'preliminaries', item_key: 'site_manager_day', display_name: 'Site Manager', value: 280, unit: '£/day', confidence: 0.85, applied: 6, confirmed: 4, note: 'London rate' },
    { category: 'preliminaries', item_key: 'labourer_day', display_name: 'Labourer', value: 180, unit: '£/day', confidence: 0.85, applied: 6, confirmed: 4, note: 'London rate' },
    { category: 'demolition', item_key: 'strip_out_residential_m2', display_name: 'Residential Strip Out', value: 35, unit: '£/m²', confidence: 0.80, applied: 5, confirmed: 3, note: 'Full internal strip to shell' },
    { category: 'groundworks', item_key: 'underpinning_per_m', display_name: 'Underpinning', value: 450, unit: '£/m', confidence: 0.75, applied: 3, confirmed: 2, note: 'Traditional mass concrete' },
  ]);
  console.log(`✅ Penn Contracting: ${count} rates seeded`);
  totalSeeded += count;
} else {
  console.log(`⏭️  Penn Contracting: skipped (email not set or not found)`);
}

// ═══════════════════════════════════════════════════════════════════
// JBP DEVELOPMENTS — Invoice-verified rates
// ═══════════════════════════════════════════════════════════════════
const jbp = getUser('jbp');
if (jbp) {
  const count = seedRates(jbp.id, [
    { category: 'groundworks', item_key: 'excavation_m3', display_name: 'Excavation (machine)', value: 12, unit: '£/m³', confidence: 0.90, applied: 8, confirmed: 7, note: 'Invoice-verified from 4 projects' },
    { category: 'groundworks', item_key: 'concrete_foundations_m3', display_name: 'Foundation Concrete (C25)', value: 125, unit: '£/m³', confidence: 0.90, applied: 8, confirmed: 7 },
    { category: 'masonry', item_key: 'cavity_wall_m2', display_name: 'Cavity Wall (brick/block)', value: 115, unit: '£/m²', confidence: 0.90, applied: 7, confirmed: 6 },
    { category: 'carpentry', item_key: 'roof_structure_m2', display_name: 'Roof Structure (cut timber)', value: 95, unit: '£/m²', confidence: 0.85, applied: 6, confirmed: 5 },
    { category: 'roofing', item_key: 'roof_covering_m2', display_name: 'Roof Covering (concrete tiles)', value: 55, unit: '£/m²', confidence: 0.85, applied: 6, confirmed: 5 },
    { category: 'plastering', item_key: 'plaster_skim_m2', display_name: 'Plaster & Skim', value: 22, unit: '£/m²', confidence: 0.90, applied: 8, confirmed: 7 },
    { category: 'electrical', item_key: 'first_fix_per_flat', display_name: 'First Fix Electrical (per flat)', value: 3800, unit: '£/flat', confidence: 0.85, applied: 5, confirmed: 4, note: 'Residential conversion spec' },
    { category: 'plumbing', item_key: 'first_fix_per_flat', display_name: 'First Fix Plumbing (per flat)', value: 3200, unit: '£/flat', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'kitchen', item_key: 'kitchen_fitout_mid', display_name: 'Kitchen Fit-Out (mid-range)', value: 9500, unit: '£/nr', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'bathroom', item_key: 'bathroom_fitout_mid', display_name: 'Bathroom Fit-Out (mid-range)', value: 5800, unit: '£/nr', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'flooring', item_key: 'lvt_m2', display_name: 'LVT Flooring', value: 62, unit: '£/m²', confidence: 0.85, applied: 6, confirmed: 5 },
    { category: 'decorating', item_key: 'paint_m2', display_name: 'Painting & Decorating', value: 16, unit: '£/m²', confidence: 0.85, applied: 6, confirmed: 5 },
  ]);
  console.log(`✅ JBP Developments: ${count} rates seeded`);
  totalSeeded += count;
} else {
  console.log(`⏭️  JBP Developments: skipped (email not set or not found)`);
}

// ═══════════════════════════════════════════════════════════════════
// ANDY CRAIG — Commercial fit-out rates
// ═══════════════════════════════════════════════════════════════════
const andy = getUser('andy');
if (andy) {
  const count = seedRates(andy.id, [
    { category: 'preliminaries', item_key: 'project_manager_day', display_name: 'Project Manager', value: 350, unit: '£/day', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'preliminaries', item_key: 'site_foreman_day', display_name: 'Site Foreman', value: 250, unit: '£/day', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'preliminaries', item_key: 'labourer_day', display_name: 'Labourer', value: 170, unit: '£/day', confidence: 0.85, applied: 5, confirmed: 4 },
    { category: 'partitions', item_key: 'mf_ceiling_m2', display_name: 'MF Ceiling (plasterboard)', value: 48, unit: '£/m²', confidence: 0.80, applied: 4, confirmed: 3, note: 'Commercial spec' },
    { category: 'partitions', item_key: 'stud_partition_m2', display_name: 'Metal Stud Partition', value: 55, unit: '£/m²', confidence: 0.80, applied: 4, confirmed: 3, note: 'Single board each side' },
    { category: 'flooring', item_key: 'raised_access_floor_m2', display_name: 'Raised Access Floor', value: 75, unit: '£/m²', confidence: 0.80, applied: 4, confirmed: 3 },
    { category: 'flooring', item_key: 'carpet_tile_m2', display_name: 'Carpet Tile (commercial)', value: 32, unit: '£/m²', confidence: 0.80, applied: 4, confirmed: 3 },
    { category: 'decorating', item_key: 'commercial_paint_m2', display_name: 'Commercial Paint Spec', value: 14, unit: '£/m²', confidence: 0.80, applied: 4, confirmed: 3 },
    { category: 'electrical', item_key: 'cat6_data_point', display_name: 'Cat6 Data Point', value: 120, unit: '£/nr', confidence: 0.80, applied: 4, confirmed: 3 },
    { category: 'mechanical', item_key: 'fan_coil_unit', display_name: 'Fan Coil Unit (supply & install)', value: 1800, unit: '£/nr', confidence: 0.75, applied: 3, confirmed: 2 },
  ]);
  console.log(`✅ Andy Craig: ${count} rates seeded`);
  totalSeeded += count;
} else {
  console.log(`⏭️  Andy Craig: skipped (email not set or not found)`);
}

// ═══════════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════════════════════`);
console.log(`  Total: ${totalSeeded} rates seeded across all clients`);
console.log(`════════════════════════════════════════════════`);
if (totalSeeded === 0) {
  console.log(`\n⚠️  No rates were seeded. Update the CLIENT_EMAILS`);
  console.log(`   object at the top of this script with the actual`);
  console.log(`   email addresses from the user list above.\n`);
}
