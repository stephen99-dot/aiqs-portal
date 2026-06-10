// The stage chip a builder sees on a job: Quoted → Won → In progress →
// Finished → Paid. Derived from the job's status plus its money pipeline
// (the /finance/jobs list returns quoted/accepted/invoiced/paid totals).

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

export function jobStage(j) {
  if (j.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled' };
  if (j.status === 'completed') {
    const invoiced = num(j.invoiced_total);
    const paid = num(j.paid_total);
    return invoiced > 0 && paid >= invoiced - 0.01
      ? { key: 'paid', label: 'Paid' }
      : { key: 'finished', label: 'Finished' };
  }
  if (j.status === 'active') return { key: 'inprogress', label: 'In progress' };
  // planned:
  if (num(j.accepted_total) > 0) return { key: 'won', label: 'Won' };
  if (num(j.quoted_total) > 0) return { key: 'quoted', label: 'Quoted' };
  return { key: 'new', label: 'New' };
}

export function stageColours(key, t) {
  switch (key) {
    case 'paid':       return { bg: t.successBg, fg: t.success };
    case 'won':        return { bg: t.successBg, fg: t.success };
    case 'inprogress': return { bg: 'rgba(59,130,246,0.12)', fg: '#3B82F6' };
    case 'finished':   return { bg: t.warningBg, fg: t.warning };
    case 'quoted':     return { bg: t.warningBg, fg: t.warning };
    case 'cancelled':  return { bg: 'rgba(148,163,184,0.15)', fg: t.textMuted };
    default:           return { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  }
}

// The one number that matters for a job at its current stage.
export function stageFigure(j, fmt) {
  const stage = jobStage(j);
  switch (stage.key) {
    case 'quoted':     return { label: 'Quoted', value: fmt(j.quoted_total) };
    case 'won':        return { label: 'Won at', value: fmt(j.accepted_total) };
    case 'inprogress': return { label: 'Paid so far', value: fmt(j.paid_total) + ' of ' + fmt(j.invoiced_total) };
    case 'finished':   return { label: 'Still owed', value: fmt(Math.max(0, num(j.invoiced_total) - num(j.paid_total))) };
    case 'paid':       return { label: 'Final account', value: fmt(j.paid_total) };
    default:           return { label: '', value: '' };
  }
}
