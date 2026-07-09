// ═══════════════════════════════════════════════════════════════════════════
// timeCapture.js — pure planned-vs-actual rollup for on-site time & cost capture.
// No DB, no I/O. Phase 3 of PHASED_BUILD_PLAN.md.
//
// The site team logs what they did each day (hours, % complete, note) against a
// task. This rolls the entries up per task and against the planned labour so the
// office can see where actual labour is running over — the "AI highlights if it
// looks like there will be a problem" signal, computed deterministically.
// ═══════════════════════════════════════════════════════════════════════════

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// tasks:  [{ id, name, phase, percent_complete }]
// entries:[{ task_id, hours, labour_cost }]
// plannedLabourByTask: Map(task_id -> planned labour £ for that task)
//
// Returns { rows:[{ taskId, name, phase, plannedLabour, capturedHours,
//   capturedLabour, percent, over, overBy }], totals:{...}, flags:[string] }.
function computeTimeRollup(tasks, entries, plannedLabourByTask) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const entryList = Array.isArray(entries) ? entries : [];
  const planned = plannedLabourByTask instanceof Map ? plannedLabourByTask : new Map();

  // Aggregate captured hours + labour per task.
  const agg = new Map(); // task_id -> { hours, labour }
  let unassignedLabour = 0;
  let unassignedHours = 0;
  for (const e of entryList) {
    const hours = Number(e.hours) || 0;
    const labour = Number(e.labour_cost) || 0;
    if (!e.task_id) { unassignedLabour += labour; unassignedHours += hours; continue; }
    if (!agg.has(e.task_id)) agg.set(e.task_id, { hours: 0, labour: 0 });
    const a = agg.get(e.task_id);
    a.hours += hours;
    a.labour += labour;
  }

  const rows = [];
  for (const t of taskList) {
    const a = agg.get(t.id) || { hours: 0, labour: 0 };
    const plannedLabour = round2(planned.get(t.id) || 0);
    const capturedLabour = round2(a.labour);
    // Only surface a row where there's something to show (a plan or captured work).
    if (plannedLabour <= 0 && capturedLabour <= 0) continue;
    const over = plannedLabour > 0 && capturedLabour > plannedLabour;
    rows.push({
      taskId: t.id,
      name: t.name,
      phase: t.phase || null,
      plannedLabour,
      capturedHours: round2(a.hours),
      capturedLabour,
      percent: t.percent_complete != null ? Number(t.percent_complete) : null,
      over,
      overBy: over ? round2(capturedLabour - plannedLabour) : 0,
    });
  }

  const plannedLabourTotal = round2([...planned.values()].reduce((s, v) => s + (Number(v) || 0), 0));
  const capturedLabourTotal = round2(entryList.reduce((s, e) => s + (Number(e.labour_cost) || 0), 0));
  const capturedHoursTotal = round2(entryList.reduce((s, e) => s + (Number(e.hours) || 0), 0));
  const tasksOver = rows.filter((r) => r.over);

  const flags = [];
  for (const r of tasksOver) {
    flags.push(r.name + ' is £' + Math.round(r.overBy).toLocaleString('en-GB') + ' over its labour budget');
  }
  if (plannedLabourTotal > 0 && capturedLabourTotal > plannedLabourTotal) {
    flags.unshift('Labour is over budget overall by £'
      + Math.round(capturedLabourTotal - plannedLabourTotal).toLocaleString('en-GB'));
  }

  return {
    rows,
    totals: {
      plannedLabour: plannedLabourTotal,
      capturedLabour: capturedLabourTotal,
      capturedHours: capturedHoursTotal,
      variance: round2(capturedLabourTotal - plannedLabourTotal),
      unassignedLabour: round2(unassignedLabour),
      unassignedHours: round2(unassignedHours),
      tasksOver: tasksOver.length,
    },
    flags,
  };
}

module.exports = { computeTimeRollup, round2 };
