/**
 * Key Normalizer — fuzzy matching of AI-generated item keys to BASE_RATES canonical keys.
 *
 * The AI extraction stage sometimes invents non-standard keys like:
 *   'new_power_circuit' instead of 'power_sockets_circuit'
 *   'concrete_foundation' instead of 'concrete_strip_foundation'
 *   'plasterboard_walls' instead of 'plasterboard_skim_walls'
 *
 * This module normalises those keys so the deterministic pricer can look them up.
 */

// Common synonym/alias mappings — keys the AI might generate, mapped to canonical BASE_RATES keys
const ALIASES = {
  // Substructure
  'foundation_excavation': 'excavation_strip_foundation',
  'trench_excavation': 'excavation_strip_foundation',
  'strip_foundation': 'concrete_strip_foundation',
  'concrete_foundation': 'concrete_strip_foundation',
  'concrete_foundations': 'concrete_strip_foundation',
  'ground_floor_slab': 'concrete_slab_150mm',
  'concrete_ground_slab': 'concrete_slab_150mm',
  'floor_slab': 'concrete_slab_150mm',
  'insulation_under_slab': 'pir_insulation_under_slab',
  'floor_insulation': 'pir_insulation_under_slab',
  'underfloor_insulation': 'pir_insulation_under_slab',
  'dpm': 'dpm_1200g',
  'damp_proof_membrane': 'dpm_1200g',
  'hardcore': 'hardcore_fill',
  'sub_base': 'hardcore_fill',
  'dpc': 'dpc_polythene',
  'damp_proof_course': 'dpc_polythene',

  // Masonry
  'facing_brickwork': 'brick_outer_leaf',
  'brick_external': 'brick_outer_leaf',
  'external_brickwork': 'brick_outer_leaf',
  'brickwork': 'brick_outer_leaf',
  'blockwork': 'blockwork_inner_leaf_100mm',
  'blockwork_inner': 'blockwork_inner_leaf_100mm',
  'inner_blockwork': 'blockwork_inner_leaf_100mm',
  'inner_leaf_blockwork': 'blockwork_inner_leaf_100mm',
  'cavity_insulation': 'cavity_insulation_eps',
  'wall_insulation': 'cavity_insulation_eps',
  'wall_ties': 'cavity_wall_ties_ss',
  'cavity_ties': 'cavity_wall_ties_ss',
  'lintels': 'steel_lintels_catnic',
  'steel_lintel': 'steel_lintels_catnic',
  'lintel': 'steel_lintels_catnic',
  'concrete_lintel': 'lintels_precast',
  'precast_lintel': 'lintels_precast',
  'concrete_lintels': 'lintels_precast',
  'stud_wall': 'stud_wall_plasterboard_both_faces',
  'stud_partition': 'stud_wall_plasterboard_both_faces',
  'timber_stud_wall': 'stud_wall_plasterboard_both_faces',
  'partition_wall': 'stud_wall_plasterboard_both_faces',
  'cavity_closer': 'cavity_closers',

  // Roof
  'roof_tiles': 'roof_tiles_interlocking',
  'concrete_roof_tiles': 'roof_tiles_interlocking',
  'roof_tiling': 'roof_tiles_interlocking',
  'roof_structure': 'roof_structure_cut_timber',
  'cut_roof': 'roof_structure_cut_timber',
  'roof_rafters': 'roof_structure_cut_timber',
  'attic_trusses': 'attic_trusses_prefab',
  'roof_trusses': 'attic_trusses_prefab',
  'osb_decking': 'osb_sarking',
  'roof_decking': 'osb_sarking',
  'breather_felt': 'breather_membrane',
  'roofing_felt': 'breather_membrane',
  'roofing_membrane': 'breather_membrane',
  'battens': 'tile_battens',
  'tile_batten': 'tile_battens',
  'fascia_soffit': 'fascia_soffit_guttering',
  'soffit_fascia': 'fascia_soffit_guttering',
  'guttering': 'fascia_soffit_guttering',
  'fascia_board': 'fascia_soffit_guttering',
  'fascia_board_timber': 'fascia_soffit_guttering',
  'timber_fascia': 'fascia_soffit_guttering',
  'fascia_boards': 'fascia_soffit_guttering',
  'rainwater_goods': 'fascia_soffit_guttering',
  'lead_flashing': 'lead_flashing_code4',
  'lead_flashings': 'lead_flashing_code4',
  'roof_insulation': 'roof_insulation_mineral_wool',
  'rafter_insulation': 'roof_insulation_mineral_wool',
  'velux': 'velux_skylight_780x980',
  'velux_window': 'velux_skylight_780x980',
  'roof_window': 'velux_skylight_780x980',
  'skylight': 'velux_skylight_780x980',
  'box_gutter': 'box_gutter_lead_lined',

  // Windows & doors
  'bifold_door': 'bifold_door_aluminium',
  'bi_fold_door': 'bifold_door_aluminium',
  'bifold_doors': 'bifold_door_aluminium',
  'aluminium_bifold': 'bifold_door_aluminium',
  'upvc_window': 'upvc_window_standard',
  'window': 'upvc_window_standard',
  'window_standard': 'upvc_window_standard',
  'composite_door': 'composite_external_door',
  'front_door': 'composite_external_door',
  'external_door': 'composite_external_door',
  'mastic': 'mastic_sealant_allowance',
  'mastic_sealant': 'mastic_sealant_allowance',
  'sealant': 'mastic_sealant_allowance',
  'internal_door': 'internal_door_painted_solid_core',
  'internal_doors': 'internal_door_painted_solid_core',

  // Finishes
  'plasterboard_walls': 'plasterboard_skim_walls',
  'plasterboard': 'plasterboard_skim_walls',
  'wall_plasterboard': 'plasterboard_skim_walls',
  'dry_lining': 'plasterboard_skim_walls',
  'drylining': 'plasterboard_skim_walls',
  'plasterboard_ceiling': 'plasterboard_ceilings',
  'ceiling_plasterboard': 'plasterboard_ceilings',
  'ceilings': 'plasterboard_ceilings',
  'screed': 'screed_sand_cement_75mm',
  'floor_screed': 'screed_sand_cement_75mm',
  'sand_cement_screed': 'screed_sand_cement_75mm',
  'screed_ufh': 'screed_ufh_75mm',
  'underfloor_heating_screed': 'screed_ufh_75mm',
  'skirting': 'skirting_mdf_95mm',
  'skirting_boards': 'skirting_mdf_95mm',
  'skirting_board': 'skirting_mdf_95mm',
  'decorations': 'internal_decorations',
  'painting': 'internal_decorations',
  'painting_decorating': 'internal_decorations',

  // Floor finishes
  'lvt': 'lvt_flooring_karndean',
  'lvt_flooring': 'lvt_flooring_karndean',
  'vinyl_flooring': 'lvt_flooring_karndean',
  'floor_tiles': 'floor_tile_600x600',
  'floor_tiling': 'floor_tile_600x600',
  'ceramic_floor_tiles': 'floor_tile_600x600',
  'wall_tiles': 'ceramic_wall_tiles_ensuite',
  'wall_tiling': 'ceramic_wall_tiles_ensuite',
  'bathroom_wall_tiles': 'ceramic_wall_tiles_ensuite',
  'shower_tray': 'shower_tray_900x900',

  // Plumbing & drainage
  'first_fix_plumb': 'first_fix_plumbing',
  'plumbing_first_fix': 'first_fix_plumbing',
  'second_fix_plumb': 'second_fix_plumbing',
  'plumbing_second_fix': 'second_fix_plumbing',
  'soil_pipe': 'svp_connection_110mm',
  'soil_vent_pipe': 'svp_connection_110mm',
  'svp': 'svp_connection_110mm',
  'foul_drain': 'foul_drainage_connection',
  'foul_drainage': 'foul_drainage_110mm',
  'drainage_connection': 'foul_drainage_connection',
  'rainwater_drainage_system': 'rainwater_drainage',
  'surface_water': 'surface_water_drainage',
  'ufh': 'ufh_manifold_kitchen',
  'underfloor_heating': 'ufh_manifold_kitchen',
  'ufh_system': 'ufh_manifold_kitchen',
  'downpipe': 'rainwater_downpipe_relocation',

  // Electrical
  'new_power_circuit': 'power_sockets_circuit',
  'power_circuit': 'power_sockets_circuit',
  'power_sockets': 'power_sockets_circuit',
  'socket_circuit': 'power_sockets_circuit',
  'electrical_circuit': 'power_sockets_circuit',
  'new_lighting_circuit': 'lighting_installation',
  'lighting_circuit': 'lighting_installation',
  'lighting': 'lighting_installation',
  'consumer_unit': 'consumer_unit_upgrade',
  'electrical_first_fix': 'first_fix_electrical',
  'electrical_second_fix': 'second_fix_electrical',
  'extract_fan': 'extract_fans',
  'extractor_fan': 'extract_fans',
  'smoke_detectors': 'smoke_heat_detection',
  'smoke_detection': 'smoke_heat_detection',
  'fire_detection': 'smoke_heat_detection',
  'electrical_testing': 'electrical_testing_certificate',
  'eicr': 'electrical_testing_certificate',
  'ev_charger': 'ev_charge_point_ducting',

  // Heating
  'heating': 'heating_extension',
  'extend_heating': 'heating_extension',
  'central_heating': 'heating_extension',
  'radiator': 'radiator_double_panel',
  'radiators': 'radiator_double_panel',
  'boiler': 'gas_boiler_combi',
  'combi_boiler': 'gas_boiler_combi',
  'gas_boiler': 'gas_boiler_combi',
  'heat_pump': 'air_source_heat_pump',
  'ashp': 'air_source_heat_pump',

  // Demolition
  'demolition': 'demolish_existing_walls',
  'strip_out': 'strip_out_general',
  'break_out_slab': 'break_out_existing_slab',
  'slab_demolition': 'break_out_existing_slab',
  'garage_demo': 'garage_demolition',
  'demolish_garage': 'garage_demolition',

  // Structural openings
  'opening_formation': 'opening_formation',
  'new_opening': 'opening_formation',
  'form_opening': 'opening_formation',
  'structural_opening': 'opening_formation',
  'stair_opening': 'stair_opening_formation',
  'make_good': 'make_good_existing',
  'making_good': 'make_good_existing',
  'make_good_existing': 'make_good_existing',

  // Door/window accessories
  'door_frame': 'door_frames_hardwood',
  'door_lining': 'door_frames_hardwood',
  'window_cill': 'window_cills_stone',
  'window_cills': 'window_cills_stone',
  'window_sill': 'window_cills_stone',
  'stone_cill': 'window_cills_stone',

  // Misc
  'staircase_new': 'staircase',
  'new_staircase': 'staircase',
  'stairs': 'staircase',
  'chipboard': 'chipboard_flooring',
  'chipboard_floor': 'chipboard_flooring',
  'floor_joists': 'floor_joists_c24',
  'floor_joists_c24': 'floor_joists_c24',
  'timber_joists': 'floor_joists_c24',
  'first_floor_joists': 'floor_joists_c24',
  'joist': 'joist_replacement',
  'floor_joist': 'joist_replacement',
  'render': 'external_render',
  'external_rendering': 'external_render',
  'timber_cladding': 'timber_cladding_accoya',
  'cladding': 'timber_cladding_accoya',
  'fence': 'close_boarded_fence_1800',
  'fencing': 'close_boarded_fence_1800',
  'close_boarded_fence': 'close_boarded_fence_1800',

  // Fitouts
  'kitchen_fitout': 'kitchen_fitout_mid',
  'kitchen': 'kitchen_fitout_mid',
  'bathroom_fitout': 'bathroom_fitout_mid',
  'bathroom': 'bathroom_fitout_mid',
  'ensuite': 'ensuite_sanitary_plumbing',
  'ensuite_fitout': 'ensuite_sanitary_plumbing',
  'utility_room': 'utility_plumbing',
  'utility': 'utility_plumbing',

  // Heritage
  'lime_plaster': 'lime_plaster_walls',
  'lime_render': 'lime_render_external',
  'repointing': 'lime_mortar_repointing',
  'damp_proofing': 'damp_proofing_tanking',
  'dpc_injection_damp': 'dpc_injection',
  'sash_window': 'sash_window_overhaul',
  'sash_windows': 'sash_window_overhaul',
  'natural_slate': 'natural_slate_roofing',
  'slate_roofing': 'natural_slate_roofing',
  'flat_roof': 'flat_roof_single_ply',
  'chimney': 'chimney_repair',
};

/**
 * Normalise an AI-generated key to the closest BASE_RATES canonical key.
 *
 * Strategy:
 * 1. Exact match in BASE_RATES → return as-is
 * 2. Direct alias lookup → return canonical key
 * 3. Fuzzy token matching → return best match if score ≥ threshold
 * 4. No match → return original key unchanged
 *
 * @param {string} key - The AI-generated item key
 * @param {object} baseRates - The BASE_RATES object from deterministicPricer
 * @returns {{ key: string, matched: boolean, original: string }}
 */
function normalizeKey(key, baseRates) {
  if (!key || !baseRates) return { key, matched: false, original: key };

  const k = key.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  // 1. Exact match
  if (baseRates[k]) return { key: k, matched: true, original: key };

  // 2. Alias lookup
  if (ALIASES[k] && baseRates[ALIASES[k]]) return { key: ALIASES[k], matched: true, original: key };

  // 3. Try removing common prefixes the AI adds
  const prefixes = ['new_', 'existing_', 'proposed_', 'custom_'];
  for (const prefix of prefixes) {
    if (k.startsWith(prefix)) {
      const stripped = k.slice(prefix.length);
      if (baseRates[stripped]) return { key: stripped, matched: true, original: key };
      if (ALIASES[stripped] && baseRates[ALIASES[stripped]]) return { key: ALIASES[stripped], matched: true, original: key };
    }
  }

  // 4. Fuzzy token matching
  const tokens = k.split('_').filter(t => t.length > 1);
  if (tokens.length === 0) return { key: k, matched: false, original: key };

  let bestKey = null;
  let bestScore = 0;

  for (const [rateKey, rateData] of Object.entries(baseRates)) {
    const rateTokens = rateKey.split('_').filter(t => t.length > 1);

    // Count overlapping tokens
    let matchCount = 0;
    for (const t of tokens) {
      if (rateTokens.includes(t)) matchCount++;
      // Partial match: token is a substring of a rate token or vice versa
      else if (rateTokens.some(rt => rt.includes(t) || t.includes(rt))) matchCount += 0.5;
    }

    // Score = overlap / max(input tokens, rate tokens) — Jaccard-like
    const score = matchCount / Math.max(tokens.length, rateTokens.length);

    // Also check description match for disambiguation
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestKey = rateKey;
    }
  }

  if (bestKey) {
    return { key: bestKey, matched: true, original: key };
  }

  return { key: k, matched: false, original: key };
}

/**
 * Normalise all item keys in a takeoff array.
 * Modifies items in-place and returns a summary of changes.
 *
 * @param {Array} items - Array of takeoff items with .key property
 * @param {object} baseRates - The BASE_RATES object
 * @returns {{ changed: number, unmatched: string[] }}
 */
function normalizeAllKeys(items, baseRates) {
  if (!items || !baseRates) return { changed: 0, unmatched: [] };

  let changed = 0;
  const unmatched = [];

  for (const item of items) {
    if (!item.key) continue;
    const result = normalizeKey(item.key, baseRates);
    if (result.matched && result.key !== item.key) {
      console.log(`[KeyNorm] ${item.key} → ${result.key}`);
      item.original_key = item.key;
      item.key = result.key;
      changed++;
    } else if (!result.matched && !baseRates[item.key]) {
      unmatched.push(item.key);
    }
  }

  return { changed, unmatched };
}

module.exports = { normalizeKey, normalizeAllKeys, ALIASES };
