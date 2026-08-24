/**
 * missedItems.js — the always-missed checklists (brief Appendix A, §13).
 *
 * Every rule below was missed on a first pass at least once on a real job. They
 * are keyed off project type and tested against the takeoff that has actually
 * been measured, so the output is "this job needs it and the takeoff does not
 * have it" rather than a generic reminder list.
 *
 * This never adds a line or changes a price. It raises the question, because a
 * missing item is a decision for a QS, not something to auto-price.
 */

// `appliesTo` — project types the rule fires on ('*' = every job).
// `present`   — how the item would look in a takeoff if it HAD been measured.
// `why`       — what it costs to miss it, in the terms the QS will check.
const RULES = [
  // ── Any refurbishment ──────────────────────────────────────────────────
  { id: 'asbestos_survey', appliesTo: /refurb|renovat|conversion|extension|alteration|remodel/i,
    present: /asbestos/i, category: 'Refurbishment',
    item: 'Asbestos R&D survey',
    why: 'Any pre-2000 dwelling where a wall comes down, a floor is lifted or an external opening is cut needs a refurbishment & demolition survey before work starts.' },
  { id: 'interlinked_alarms', appliesTo: /refurb|renovat|conversion|extension|alteration|remodel/i,
    present: /smoke (alarm|detect)|heat alarm|interlinked/i, category: 'Refurbishment',
    item: 'Interlinked smoke detection + kitchen heat alarm',
    why: 'Triggered by any material alteration. Commonly left out of a tender priced from elevations.' },
  { id: 'making_good_skim', appliesTo: /refurb|renovat|conversion|extension|alteration|remodel/i,
    present: /making good|two[- ]coat skim|skim/i, category: 'Refurbishment',
    item: 'Making good and two-coat skim to everything receiving paint or paper',
    why: 'The single item most commonly left out of a tender priced from elevations.' },
  { id: 'strip_out_precedes', appliesTo: /refurb|renovat|conversion|remodel/i,
    present: /strip[- ]out|strip out|remove existing/i, category: 'Refurbishment',
    item: 'The strip-out that must precede every "new" item',
    why: 'Every new finish implies removing what is there; and every stripped covering implies a replacement finish.' },
  { id: 'ffl_doors', appliesTo: /refurb|renovat|remodel|floor/i,
    present: /rehang|door.*(cut down|trim)|threshold/i, category: 'Refurbishment',
    item: 'Doors eased, cut down and rehung; thresholds formed',
    why: 'A new tiled floor build-up raises FFL by ~30 mm, so every door comes off and every threshold is formed.' },

  // ── Roofs ──────────────────────────────────────────────────────────────
  { id: 'eaves_overhang', appliesTo: /roof|loft|dormer/i,
    present: /eaves|overhang|verge/i, category: 'Roof',
    item: 'Eaves overhang taken from the roof plan, not assumed',
    why: '185 mm measured against 300 assumed was 4.2 m2 of tiling on one job. Never assume the overhang.' },
  { id: 'roof_tie_in', appliesTo: /roof|extension|loft|dormer/i,
    present: /tie[- ]in|fascia|soffit|gutter/i, category: 'Roof',
    item: 'Roof tie-in: existing fascia/soffit/gutter down, covering stripped beyond the valley lines, eaves and ridge ventilation',
    why: 'A tie-in always needs all of these, and the ventilation is required wherever a non-breathable underlay is specified.' },
  { id: 'roof_access', appliesTo: /roof|loft|dormer/i,
    present: /roof ladder|crawling board|edge protection/i, category: 'Roof',
    item: 'Roof ladders, crawling boards and temporary edge protection',
    why: 'Required to work on an existing slope, and the scaffold height must be re-derived once they are allowed for.' },
  { id: 'slate_gauge', appliesTo: /slate|roof/i,
    present: /headlap|gauge|doubled eaves|slate[- ]and[- ]a[- ]half/i, category: 'Roof',
    item: 'Slate gauge derived from the headlap, plus the doubled eaves course and slate-and-a-half verge',
    why: 'Headlap comes from exposure and pitch, not habit. 400x250 at 35 degrees: 115 lap = 142.5 gauge, 28.07 slates/m2.' },

  // ── Flat roofs ─────────────────────────────────────────────────────────
  { id: 'flat_roof_ceiling', appliesTo: /flat roof|warm roof|single ply|epdm/i,
    present: /ceiling/i, category: 'Flat roof',
    item: 'The ceiling as a separate item',
    why: 'Easy to lose because the section looks complete without it.' },
  { id: 'flat_roof_upstand', appliesTo: /flat roof|warm roof|single ply|epdm/i,
    present: /upstand|cover flashing|dpc tray/i, category: 'Flat roof',
    item: 'Upstand and cover flashing chased into existing masonry with a dpc tray',
    why: 'Only the COVERING runs up the upstands — structure, deck, VCL and insulation are internal-area.' },
  { id: 'flat_roof_guarding', appliesTo: /flat roof|warm roof|terrace|balcony/i,
    present: /guarding|balustrade|part k/i, category: 'Flat roof',
    item: 'Part K 1100 mm guarding measured above the NEW deck',
    why: 'Re-insulating raises the roof ~160 mm, which also moves falls, outlet positions and the adjoining threshold.' },

  // ── Walls / envelope ───────────────────────────────────────────────────
  { id: 'gables_in_wall_area', appliesTo: /wall|render|cladding|extension|new build|insulat/i,
    present: /gable/i, category: 'Envelope',
    item: 'The gables as part of the net wall area',
    why: 'Gables sit above the storey height the girth used: 0.5 x width x (0.5 width x tan pitch). Three gables were 10% of net wall on one job.' },
  { id: 'reveals', appliesTo: /wall|window|door|opening|extension|insulat/i,
    present: /reveal|cavity closer|cill|linings/i, category: 'Envelope',
    item: 'Reveals added back after deducting openings — linings, soffits, cavity closers, cills with drips, air-sealing tape',
    why: 'Deducting the opening without adding the reveal under-measures every opening on the job.' },
  { id: 'cavity_trays', appliesTo: /cavity|wall|lintel|opening/i,
    present: /cavity tray|stop end|weep/i, category: 'Envelope',
    item: 'Stepped cavity trays with stop ends and weeps over every lintel',
    why: 'Measured as the opening width + 300 each side.' },
  { id: 'scaffold_tie_holes', appliesTo: /scaffold|render|wall|roof/i,
    present: /tie hole|make good scaffold/i, category: 'Envelope',
    item: 'Make good scaffold tie holes',
    why: 'Roughly 1 per 5 m2 of face.' },

  // ── Groundworks / substructure ─────────────────────────────────────────
  { id: 'wall_dpc_lap', appliesTo: /floor|slab|damp|membrane|groundwork|substructure/i,
    present: /dpc|damp proof course/i, category: 'Groundworks',
    item: 'Wall DPC for the new floor membrane to lap into',
    why: 'Without it moisture tracks round the membrane into the new insulated linings.' },
  { id: 'skip_stream', appliesTo: /demolition|strip|groundwork|excavat|refurb/i,
    present: /skip|muck away|waste disposal/i, category: 'Groundworks',
    item: 'Skips decided by the governing stream',
    why: 'Inert fills BY WEIGHT (8 yd is about 3 t, about 1.5 m3 of masonry, not its 6.1 m3 capacity); bulky light strip-out fills by volume.' },
  { id: 'concrete_deliveries', appliesTo: /concrete|slab|foundation|substructure/i,
    present: /delivery|part load|minimum load/i, category: 'Groundworks',
    item: 'Concrete counted in DELIVERIES against the supplier minimum, not cubic metres',
    why: 'A part load is charged as a full one; the m3 figure understates the cost.' },

  // ── Access — run on every job ──────────────────────────────────────────
  { id: 'access_reaches_all_faces', appliesTo: /.*/,
    present: /__never_matches__/, category: 'Access', always: true,
    item: 'List every item in the bill and the face it sits on, then check the access reaches all of them',
    why: 'A rear-only scaffold on a job that overhauled 18 windows all round and installed roof PV was +£3,850. If a scaffold is needed for the roof-level items, a tower is the WRONG item, not an inadequate one.' },

  // ── Boundaries and neighbours ──────────────────────────────────────────
  { id: 'party_wall_notice', appliesTo: /extension|foundation|excavat|party wall|boundary|new build/i,
    present: /party wall|notice period/i, category: 'Boundaries',
    item: 'Party Wall notice periods against the stated start date',
    why: 'Excavating within 3 m below a neighbour\'s foundations is s.6 (one month). Weatherproofing at a party boundary is s.2 (two months). Exclude the costs but always state the notice periods — and count the adjoining owners, four boundaries can mean four awards.' },
  { id: 'narrow_side_passage', appliesTo: /extension|rear|side|groundwork/i,
    present: /side passage|barrow|line pump|restricted access/i, category: 'Boundaries',
    item: 'Consequences of a sub-metre side passage',
    why: 'Five follow every time: reduced-width scaffold, no mini excavator (a 1.5 t machine is ~990 mm over its tracks), a line pump per pour, barrowing both ways, and a crew cap.' },

  // ── Fire and escape ────────────────────────────────────────────────────
  { id: 'storey_count_before_doors', appliesTo: /loft|conversion|extension|storey/i,
    present: /fd30|protected (route|stair)|self[- ]clos/i, category: 'Fire & escape',
    item: 'Count the storeys BEFORE pricing the doors',
    why: 'A loft conversion on a BUNGALOW creates a two-storey dwelling needing a protected route — while the same drawings usually open up the ground floor, which is what destroys it. A spec offering only egress windows is giving the bungalow answer.' },

  // ── Services ───────────────────────────────────────────────────────────
  { id: 'ashp_distribution', appliesTo: /heat pump|ashp|gshp|heating/i,
    present: /flow and return|re[- ]siz|system flush|magnetic filter|zoning/i, category: 'Services',
    item: 'Distribution as well as plant: flow and return re-run and re-sized, full system flush, zoning and controls, magnetic filter',
    why: 'An ASHP line covers plant, not distribution. Emitters sized for a boiler are undersized at 45-50 degrees.' },
  { id: 'incoming_supply', appliesTo: /all[- ]electric|heat pump|ev charge|rewire|electric/i,
    present: /dno|load assessment|service upgrade|incoming supply/i, category: 'Services',
    item: 'Incoming-supply works: load assessment, DNO application, often a service upgrade',
    why: 'All-electric conversion is an incoming-supply job with lead times in months — frequently the item that sets the programme.' },
  { id: 'eicr_before_accessories', appliesTo: /electric|rewire|socket|accessor/i,
    present: /eicr|test.*certificat|inspection and testing/i, category: 'Services',
    item: 'Testing, inspection and certification on unverified circuits, with partial-or-full rewire as a named provisional',
    why: 'Every accessory replaced on an unverified circuit needs it. An EICR now removes the largest unknown in the services.' },

  // ── Ventilation — the one nobody lists ─────────────────────────────────
  { id: 'purpose_provided_ventilation', appliesTo: /window|insulat|refurb|retrofit|airtight|renovat/i,
    present: /trickle|background ventilator|continuous extract|mvhr/i, category: 'Ventilation',
    item: 'Background ventilators (8,000 mm2 habitable, 4,000 mm2 bathroom) and continuous extract as named items',
    why: 'New windows + internal insulation + sealed junctions tighten a house with no matched increase in ventilation. It shows up as condensation and mould in the FIRST WINTER AFTER the work. Where windows are expressly excluded, no trickle vents arrive at all.' },

  // ── Garage conversions ─────────────────────────────────────────────────
  { id: 'garage_slab_fall', appliesTo: /garage conversion/i,
    present: /shim|pack.*batten|level.*slab|fall/i, category: 'Garage conversion',
    item: 'Packing and shimming the battens to a single plane',
    why: 'A garage slab is laid to fall to the door — 60-90 mm over 5.4 m. The floor build-up is ~118 mm before any covering.' },
  { id: 'garage_planning', appliesTo: /garage conversion/i,
    present: /planning|condition|parking/i, category: 'Garage conversion',
    item: 'Planning position, separate from the building regs pack',
    why: 'Estate closes commonly carry a condition preventing use for anything but parking a car, and the conversion loses a parking space.' },
];

/**
 * @param {Array}  takeoffItems  measured items ({ description, key })
 * @param {object} job           { projectType, description }
 * @returns {{findings:Array, checked:number, projectType:string}}
 */
function checkMissedItems(takeoffItems, job = {}) {
  const projectBlob = [job.projectType, job.description].filter(Boolean).join(' ');
  const takeoffBlob = (takeoffItems || [])
    .map((i) => `${i.description || ''} ${i.key || ''}`).join(' \n ');

  const findings = [];
  let checked = 0;
  for (const rule of RULES) {
    if (!rule.always && !rule.appliesTo.test(projectBlob)) continue;
    checked++;
    if (!rule.always && rule.present.test(takeoffBlob)) continue;
    findings.push({ id: rule.id, category: rule.category, item: rule.item, why: rule.why });
  }
  return { findings, checked, projectType: job.projectType || '' };
}

module.exports = { checkMissedItems, RULES };
