import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';
import useIsMobile from '../utils/useIsMobile';
import { useTheme } from '../context/ThemeContext';
import ShareLinkModal from '../components/ShareLinkModal';
import AssistantDrawer from '../components/AssistantDrawer';
import { docLabel } from '../utils/docLabel';
import PROJECT_TYPE_SUGGESTIONS from '../utils/projectTypes';

/**
 * Builder Pack page — full-width workspace for turning a priced BOQ into the
 * outputs builders actually want. Items are editable in-place: change a
 * description, qty, labour or materials value and the previews + download
 * recompute live. Edits are sent to the server when downloading.
 */

const TABS = [
  { key: 'builder', label: 'Builder pack' },
  { key: 'client',  label: 'Client copy'  },
];

const ROUNDING_OPTIONS = [
  { value: 0,   label: 'No rounding (penny accurate)' },
  { value: 1,   label: 'Nearest £1' },
  { value: 10,  label: 'Nearest £10' },
  { value: 100, label: 'Nearest £100' },
];

function fmt(sym, v, decimals = 0) {
  return sym + (Math.round((v || 0) * Math.pow(10, decimals)) / Math.pow(10, decimals))
    .toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function roundMoney(rounding, v) {
  // rounding 0 = penny-accurate: keep full precision so summed totals reconcile
  // exactly with the delivered tender (display is formatted to 2 dp).
  if (!rounding || rounding < 1) return v;
  return Math.round(v / rounding) * rounding;
}
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(v) {
  return Math.round((v || 0) * 100) / 100;
}
// Stable per-row id so React keys survive add/remove without misattributing
// focus/caret to the wrong line (crypto.randomUUID with a fallback).
let _uidSeq = 0;
function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'it_' + Date.now().toString(36) + '_' + (_uidSeq++);
}
// The per-unit labour/materials rate implied by a parsed line (labour & materials
// are LINE totals). Used so that changing Qty rescales the line at a fixed rate —
// the accurate BOQ behaviour (line total = qty × rate).
function unitRates(it) {
  const q = num(it.qty);
  return {
    unitLabour: it.unitLabour != null ? it.unitLabour : (q > 0 ? num(it.labour) / q : num(it.labour)),
    unitMaterials: it.unitMaterials != null ? it.unitMaterials : (q > 0 ? num(it.materials) / q : num(it.materials)),
  };
}
// The money value of a line. A split BOQ carries it as labour + materials; a
// composite (single-rate) BOQ carries it only in `total`, with no split — fall
// back to that so composite lines don't read as £0 everywhere.
function lineTotal(it) {
  // Non-zero, not positive: a credit line ("Deduct: deposit already
  // discharged…") carries a NEGATIVE split, and is still a split line.
  const lm = num(it.labour) + num(it.materials);
  return lm !== 0 ? lm : num(it.total);
}

// Merge an edit into a line, keeping the maths accurate (line total = qty × rate).
// Shared by the manual grid edits and the AI assistant's Apply, so both paths
// rescale/redefine unit rates identically.
function applyItemPatch(cur, patch) {
  const merged = { ...cur, ...patch };
  if ('qty' in patch) {
    // Changing the quantity rescales labour & materials at the line's
    // existing unit rate, so the nett moves the way a builder expects.
    const { unitLabour, unitMaterials } = unitRates(cur);
    const q = num(patch.qty);
    merged.unitLabour = unitLabour;
    merged.unitMaterials = unitMaterials;
    merged.labour = round2(unitLabour * q);
    merged.materials = round2(unitMaterials * q);
    // Keep `total` in step. A composite line (no split) carries its value in
    // `total` alone, so rescale it at its own unit rate; a split line's total
    // is simply labour + materials.
    const curLm = num(cur.labour) + num(cur.materials);
    if (curLm > 0) {
      merged.total = round2(merged.labour + merged.materials);
    } else {
      const oldQ = num(cur.qty);
      const unitTotal = oldQ > 0 ? num(cur.total) / oldQ : num(cur.total);
      merged.total = round2(unitTotal * q);
    }
  }
  // Editing a money column directly redefines that line's unit rate, and the
  // line total follows the split.
  if ('labour' in patch) {
    const q = num(merged.qty);
    merged.unitLabour = q > 0 ? num(patch.labour) / q : num(patch.labour);
    merged.total = round2(num(merged.labour) + num(merged.materials));
  }
  if ('materials' in patch) {
    const q = num(merged.qty);
    merged.unitMaterials = q > 0 ? num(patch.materials) / q : num(patch.materials);
    merged.total = round2(num(merged.labour) + num(merged.materials));
  }
  // Editing the line total directly (composite BOQs with no labour/materials
  // split) redefines the line's value and its implied unit rate. The line
  // stays composite — no split is introduced.
  if ('total' in patch) {
    const q = num(merged.qty);
    merged.total = round2(num(patch.total));
    merged.rate = q > 0 ? round2(merged.total / q) : merged.total;
    merged.labour = 0; merged.materials = 0;
    merged.unitLabour = 0; merged.unitMaterials = 0;
  }
  return merged;
}

export default function BuilderPackPage() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  // Laptop screens (13"/14" Macs especially) can't fit the sticky control
  // sidebar AND the items table side by side — stack them below ~1150px so
  // the table gets the full width instead of clipping its Total column.
  const [winW, setWinW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1440);
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isNarrow = isMobile || winW < 1150;
  const [project, setProject] = useState(null);
  const [sections, setSections] = useState([]);   // editable copy of breakdown.sections
  const [originalSections, setOriginalSections] = useState([]); // for "reset"
  const [branding, setBranding] = useState(null); // { primary_colour, accent_colour, ... }
  const [logoUrl, setLogoUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('builder');
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [share, setShare] = useState(null); // { url } — public /q/<token> link for the client
  const [savingType, setSavingType] = useState(false);
  const { t } = useTheme();
  const [openSectionIds, setOpenSectionIds] = useState({}); // { '1': true }

  // Builder-tab controls
  const [builderMargin, setBuilderMargin] = useState(0);
  const [materialsMarkup, setMaterialsMarkup] = useState(0);

  // Client-tab controls
  // All margins default to 0 (like-for-like with the delivered BOQ); when the
  // source document prints its own OH&P/contingency/VAT lines, the load effect
  // seeds these from it so the default export reproduces the same bottom line.
  const [defaultOhp, setDefaultOhp] = useState(0); // overhead %
  const [profit, setProfit] = useState(0);          // profit %, applied on net + overhead
  const [contingency, setContingency] = useState(0);
  const [vat, setVat] = useState(0);
  const [sourceSeeded, setSourceSeeded] = useState(false);
  const [perTradeOhp, setPerTradeOhp] = useState({});
  const [prelimsMode, setPrelimsMode] = useState('off');
  const [prelimsAmount, setPrelimsAmount] = useState(0);
  const [prelimsPct, setPrelimsPct] = useState(0);
  const [dayRateOn, setDayRateOn] = useState(false);
  const [dayRate, setDayRate] = useState({ label: 'Project management', days: 0, rate_per_day: 0 });
  const [rounding, setRounding] = useState(0);
  // Provisional sums carried by the source tender (a lump block, exclusive of
  // OH&P). Added flat to the bottom line so the client copy matches the tender.
  const [provisionalSum, setProvisionalSum] = useState(0);

  // Rate-library import: rates extracted from this BOQ, offered to the user.
  // Nothing is written until they review and confirm in the modal.
  const [rateImport, setRateImport] = useState(null); // { candidates, counts, currency }
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [rateImportResult, setRateImportResult] = useState(null);
  const [rateBannerDismissed, setRateBannerDismissed] = useState(
    () => { try { return localStorage.getItem('aiqs_rate_import_dismissed_' + id) === '1'; } catch (e) { return false; } }
  );
  const dismissRateBanner = () => {
    setRateBannerDismissed(true);
    try { localStorage.setItem('aiqs_rate_import_dismissed_' + id, '1'); } catch (e) {}
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch(`/projects/${id}`),
      apiFetch(`/projects/${id}/builder-breakdown`),
      apiFetch('/branding').catch(() => null),
    ])
      .then(([proj, bd, br]) => {
        if (cancelled) return;
        setProject(proj);
        const seeded = (bd.sections || []).map((s) => ({
          number: s.number,
          title: s.title,
          provisional: !!s.provisional,
          items: (s.items || []).map((it) => {
            const { unitLabour, unitMaterials } = unitRates(it);
            return { ...it, _id: it._id || uid(), unitLabour, unitMaterials };
          }),
        }));
        setSections(seeded);
        setOriginalSections(JSON.parse(JSON.stringify(seeded)));
        if (seeded.length) setOpenSectionIds({ [seeded[0].number]: true });
        // Client Copy policy: reproduce the uploaded BOQ exactly, line by line,
        // but STRIP overhead/profit/contingency so the client sets their own.
        // OH&P and contingency are deliberately left at 0 (not seeded from the
        // source) — the rates render verbatim and the client can type in their
        // own OH&P/contingency afterwards. VAT is kept as the source carried it.
        const ss = bd.source_summary || {};
        if (ss.vat_pct != null) setVat(ss.vat_pct);
        // Provisional sums now arrive as their own itemised section (see seeded);
        // only fall back to the flat lump for older BOQs that weren't itemised.
        const hasProvSection = seeded.some((s) => s.provisional);
        if (ss.provisional_sum != null && !hasProvSection) setProvisionalSum(ss.provisional_sum);
        setSourceSeeded(ss.ohp_pct != null || ss.overhead_pct != null || ss.profit_pct != null || ss.contingency_pct != null || ss.vat_pct != null || ss.provisional_sum != null || hasProvSection);
        // Restore any previously-saved working state on top of the freshly-parsed
        // BOQ, so the user picks up exactly where they left off. originalSections
        // stays the pristine BOQ so "Reset" still returns to the delivered figures.
        const saved = bd.saved_state;
        if (saved && typeof saved === 'object') {
          if (Array.isArray(saved.sections) && saved.sections.length) {
            setSections(saved.sections.map((s) => ({
              ...s,
              items: (s.items || []).map((it) => ({ ...it, _id: it._id || uid() })),
            })));
          }
          if (saved.builder_margin != null) setBuilderMargin(saved.builder_margin);
          if (saved.materials_markup != null) setMaterialsMarkup(saved.materials_markup);
          if (saved.default_ohp != null) setDefaultOhp(saved.default_ohp);
          if (saved.profit != null) setProfit(saved.profit);
          if (saved.contingency != null) setContingency(saved.contingency);
          if (saved.vat != null) setVat(saved.vat);
          if (saved.per_trade_ohp && typeof saved.per_trade_ohp === 'object') setPerTradeOhp(saved.per_trade_ohp);
          if (saved.prelims_mode) setPrelimsMode(saved.prelims_mode);
          if (saved.prelims_amount != null) setPrelimsAmount(saved.prelims_amount);
          if (saved.prelims_pct != null) setPrelimsPct(saved.prelims_pct);
          if (saved.day_rate_on != null) setDayRateOn(saved.day_rate_on);
          if (saved.day_rate && typeof saved.day_rate === 'object') setDayRate(saved.day_rate);
          if (saved.rounding != null) setRounding(saved.rounding);
          if (saved.provisional_sum != null) setProvisionalSum(saved.provisional_sum);
        }
        if (br && br.branding) {
          setBranding(br.branding);
          // Logo endpoint needs auth — fetch as blob so <img> can render it.
          if (br.logo_url) {
            const token = getToken();
            fetch(br.logo_url, { headers: { Authorization: 'Bearer ' + token } })
              .then((r) => r.ok ? r.blob() : null)
              .then((blob) => { if (blob && !cancelled) setLogoUrl(URL.createObjectURL(blob)); })
              .catch(() => {});
          }
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load BOQ'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // Extract the rates this BOQ was priced at and check them against the user's
  // rate library, so we can offer the import. Non-blocking — a failure here
  // just means no banner.
  useEffect(() => {
    let cancelled = false;
    apiFetch(`/projects/${id}/rate-import/preview`)
      .then((d) => {
        if (!cancelled && d && Array.isArray(d.candidates) && d.candidates.length) setRateImport(d);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  const sym = (project && project.currency === 'EUR') ? '€' : '£';
  // "Quote" or "Estimate" — the builder's Branding setting, so this page uses
  // the same word their client will see on the document and the shared link.
  const label = docLabel(branding);

  // ─── Edit helpers ────────────────────────────────────────────────────────
  const updateItem = useCallback((sIdx, iIdx, patch) => {
    setSections((prev) => {
      const next = prev.slice();
      const sec = { ...next[sIdx], items: next[sIdx].items.slice() };
      sec.items[iIdx] = applyItemPatch(sec.items[iIdx], patch);
      next[sIdx] = sec;
      return next;
    });
  }, []);
  const updateSectionTitle = useCallback((sIdx, title) => {
    setSections((prev) => {
      const next = prev.slice();
      next[sIdx] = { ...next[sIdx], title };
      return next;
    });
  }, []);
  const removeItem = useCallback((sIdx, iIdx) => {
    setSections((prev) => {
      const next = prev.slice();
      const sec = { ...next[sIdx], items: next[sIdx].items.filter((_, i) => i !== iIdx) };
      next[sIdx] = sec;
      return next;
    });
  }, []);
  const addItem = useCallback((sIdx) => {
    setSections((prev) => {
      const next = prev.slice();
      const sec = { ...next[sIdx], items: next[sIdx].items.slice() };
      sec.items.push({ _id: uid(), itemRef: '', description: 'New item', unit: 'no', qty: 1, rate: 0, labour: 0, materials: 0, total: 0, unitLabour: 0, unitMaterials: 0 });
      next[sIdx] = sec;
      return next;
    });
  }, []);
  const resetEdits = useCallback(() => {
    setSections(JSON.parse(JSON.stringify(originalSections)));
  }, [originalSections]);

  // Per-section subtotals (live)
  const sectionTotals = useMemo(
    () => sections.map((s) => s.items.reduce(
      (acc, it) => {
        const ls = num(it.labour), ms = num(it.materials);
        // Composite lines (no labour/materials split at all) contribute their
        // `total`. The test must be "no split", not "split ≤ 0": a credit line
        // ("Deduct: deposit already discharged…") has a NEGATIVE split, and
        // treating it as composite too counted its value twice — the preview's
        // net ran £3.5k under the exported client copy on 9 Dartmouth.
        const comp = (ls !== 0 || ms !== 0) ? 0 : num(it.total);
        return {
          labour: acc.labour + ls,
          materials: acc.materials + ms,
          composite: acc.composite + comp,
          total: acc.total + ls + ms + comp,
        };
      },
      { labour: 0, materials: 0, composite: 0, total: 0 }
    )),
    [sections]
  );

  // Composite BOQs (e.g. a tender priced "labour+materials" per line) carry no
  // split, so the Labour/Materials columns are all zero — pure visual noise.
  // Detect a real split anywhere and only then show those two columns.
  const hasSplit = useMemo(
    () => sections.some((s) => s.items.some((it) => num(it.labour) !== 0 || num(it.materials) !== 0)),
    [sections]
  );

  // ─── Builder tab calculations ────────────────────────────────────────────
  const labourMult = 1 + builderMargin / 100;
  const matMult = 1 + builderMargin / 100 + materialsMarkup / 100;
  const builderRows = useMemo(
    () => sections.map((s, i) => ({
      number: s.number, title: s.title, item_count: s.items.length,
      labour: sectionTotals[i].labour * labourMult,
      materials: sectionTotals[i].materials * matMult,
      // Composite lines take the blanket builder margin (no materials markup,
      // since there's no identified materials portion to mark up).
      total: sectionTotals[i].labour * labourMult + sectionTotals[i].materials * matMult + sectionTotals[i].composite * labourMult,
    })),
    [sections, sectionTotals, labourMult, matMult]
  );
  const builderGrand = builderRows.reduce(
    (a, r) => ({ labour: a.labour + r.labour, materials: a.materials + r.materials, total: a.total + r.total }),
    { labour: 0, materials: 0, total: 0 }
  );
  // The net/true cost before the builder's own margin — so the breakdown can
  // show exactly what (if anything) has been added on top.
  const baseGrand = sectionTotals.reduce(
    (a, t) => ({ labour: a.labour + t.labour, materials: a.materials + t.materials, total: a.total + t.total }),
    { labour: 0, materials: 0, total: 0 }
  );

  // ─── Client tab calculations ─────────────────────────────────────────────
  // Overhead and profit compound exactly as a tender summary applies them
  // (profit on net + overhead), baked into the client's rates.
  const baseUplift = (1 + defaultOhp / 100) * (1 + profit / 100);
  const clientRows = useMemo(
    () => sections.map((s, i) => {
      // Provisional sections are carried verbatim, exclusive of OH&P (factor 1).
      const factor = s.provisional
        ? 1
        : (Object.prototype.hasOwnProperty.call(perTradeOhp, s.number)
            ? 1 + num(perTradeOhp[s.number]) / 100
            : baseUplift);
      const base = sectionTotals[i].total;
      const subtotal = roundMoney(rounding, base * factor);
      return { number: s.number, title: s.title, provisional: !!s.provisional, item_count: s.items.length, uplift: factor, base, subtotal };
    }),
    [sections, sectionTotals, perTradeOhp, baseUplift, rounding]
  );
  // Net construction excludes provisional sections — they get their own line.
  const netConstruction = clientRows.filter((r) => !r.provisional).reduce((a, r) => a + r.subtotal, 0);
  const provisionalFromSections = clientRows.filter((r) => r.provisional).reduce((a, r) => a + r.subtotal, 0);
  // Contingency / prelims-% are charged on the construction net (pre-uplift,
  // excluding provisional sums), matching how the delivered tender computes them.
  const originalNet = sections.reduce((a, s, i) => a + (s.provisional ? 0 : sectionTotals[i].total), 0);

  const ohpApplied = baseUplift > 1.0001 || Object.keys(perTradeOhp).length > 0;
  let runningTotal = netConstruction;
  const summaryLines = [{ label: ohpApplied ? 'Net construction (incl. overhead & profit)' : 'Net construction', value: netConstruction, key: 'net' }];
  if (prelimsMode === 'flat' && prelimsAmount > 0) {
    summaryLines.push({ label: 'Preliminaries (flat)', value: prelimsAmount, key: 'prel-flat' });
    runningTotal += prelimsAmount;
  }
  if (prelimsMode === 'pct' && prelimsPct > 0) {
    const v = originalNet * (prelimsPct / 100);
    summaryLines.push({ label: `Preliminaries (${prelimsPct}% of net)`, value: v, key: 'prel-pct' });
    runningTotal += v;
  }
  if (dayRateOn && dayRate.days > 0 && dayRate.rate_per_day > 0) {
    const v = dayRate.days * dayRate.rate_per_day;
    summaryLines.push({
      label: `${dayRate.label} (${dayRate.days} day${dayRate.days === 1 ? '' : 's'} @ ${sym}${dayRate.rate_per_day})`,
      value: v, key: 'dayrate',
    });
    runningTotal += v;
  }
  // Provisional sums = itemised provisional sections + any legacy flat lump
  // (only one of the two is ever non-zero, so they never double up).
  const provisionalTotal = provisionalFromSections + (provisionalFromSections > 0 ? 0 : provisionalSum);
  if (provisionalTotal > 0) {
    summaryLines.push({ label: 'Provisional sums (excl. OH&P)', value: provisionalTotal, key: 'provisional' });
    runningTotal += provisionalTotal;
  }
  if (contingency > 0) {
    const v = originalNet * (contingency / 100);
    summaryLines.push({ label: `Contingency (${contingency}% of net)`, value: v, key: 'contingency' });
    runningTotal += v;
  }
  const exVat = runningTotal;
  const vatVal = vat > 0 ? exVat * (vat / 100) : 0;
  const inclVat = exVat + vatVal;

  // ─── Downloads ───────────────────────────────────────────────────────────
  function editsForBody() {
    return sections.map((s) => ({
      number: s.number, title: s.title, provisional: !!s.provisional,
      items: s.items.map((it) => ({
        itemRef: it.itemRef, description: it.description, unit: it.unit,
        qty: num(it.qty), labour: num(it.labour), materials: num(it.materials),
        // Send the line total + rate too, so composite (unsplit) BOQs — whose
        // value lives only in `total` — survive the rebuild instead of zeroing.
        total: lineTotal(it), rate: num(it.rate),
      })),
    }));
  }

  async function downloadBuilderPack() {
    setDownloading(true); setError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${id}/builder-pack`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builder_margin: builderMargin,
          materials_markup: materialsMarkup,
          edited_sections: editsForBody(),
        }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || 'Download failed');
      }
      await streamBlob(resp);
    } catch (err) { setError(err.message); }
    finally { setDownloading(false); }
  }

  async function downloadClientCopy() {
    setDownloading(true); setError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${id}/client-copy-pro`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contingency, default_ohp: defaultOhp, overhead_pct: defaultOhp, profit_pct: profit, vat,
          per_trade_ohp: perTradeOhp,
          prelims_amount: prelimsMode === 'flat' ? prelimsAmount : 0,
          prelims_pct:    prelimsMode === 'pct'  ? prelimsPct    : 0,
          provisional_sum: provisionalSum,
          day_rate: dayRateOn ? dayRate : null,
          rounding,
          edited_sections: editsForBody(),
        }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || 'Download failed');
      }
      await streamBlob(resp);
    } catch (err) { setError(err.message); }
    finally { setDownloading(false); }
  }

  // The project type printed on the client's documents. Submissions default to
  // "Other", so it's editable right here where the client copy is produced —
  // saved on the project, which every later download / re-share reads from.
  async function saveProjectType(value) {
    const next = String(value || '').trim();
    if (next === ((project && project.project_type) || '')) return;
    setSavingType(true); setError('');
    try {
      const updated = await apiFetch(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ project_type: next }),
      });
      setProject((p) => ({ ...p, ...updated }));
    } catch (err) { setError(err.message); }
    finally { setSavingType(false); }
  }

  // Share the client copy the same way AI Trades Pilot sends a quote: turn the
  // preview into a quote server-side (margins baked into rates), mint the
  // public /q/<token> acceptance link, and hand back a share sheet. Re-sharing
  // after edits refreshes the same quote so the client's link stays live.
  async function shareWithClient() {
    setSharing(true); setError('');
    try {
      const q = await apiFetch(`/projects/${id}/client-quote`, {
        method: 'POST',
        body: JSON.stringify({
          contingency, default_ohp: defaultOhp, overhead_pct: defaultOhp, profit_pct: profit, vat,
          per_trade_ohp: perTradeOhp,
          prelims_amount: prelimsMode === 'flat' ? prelimsAmount : 0,
          prelims_pct:    prelimsMode === 'pct'  ? prelimsPct    : 0,
          provisional_sum: provisionalSum,
          day_rate: dayRateOn ? dayRate : null,
          rounding,
          edited_sections: editsForBody(),
        }),
      });
      const sent = await apiFetch(`/estimator/quotes/${q.quote_id}/send`, { method: 'POST' });
      setShare({ url: window.location.origin + sent.path });
    } catch (err) { setError(err.message); }
    finally { setSharing(false); }
  }

  async function streamBlob(resp) {
    const blob = await resp.blob();
    const disp = resp.headers.get('content-disposition') || '';
    const m = disp.match(/filename="?([^"]+)"?/);
    const filename = m ? m[1] : 'export.xlsx';
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // ─── AI assistant — "tell it what changed" ────────────────────────────────
  // Posts the CURRENT on-screen sections + client-copy controls (same shape the
  // download/share endpoints get) so the changeset's refs match what's on
  // screen. Applying goes through applyItemPatch — the same maths as manual
  // edits — and the debounced auto-save persists it like any other edit.
  const getPackState = () => ({
    sections: editsForBody(),
    controls: {
      overhead_pct: defaultOhp,
      profit_pct: profit,
      contingency_pct: contingency,
      vat_pct: vat,
      provisional_sum: provisionalSum,
    },
  });

  const applyAssistantProposal = (p) => {
    // The server sends each new item's money as labour/materials line totals,
    // or as a composite `total` when there's no split — build the row the same
    // way the manual editor would, so unit rates stay right for qty edits.
    const buildNewItem = (nl) => {
      const q = num(nl.qty) || 1;
      const labour = round2(num(nl.labour)), materials = round2(num(nl.materials));
      const total = (labour !== 0 || materials !== 0) ? round2(labour + materials) : round2(num(nl.total));
      return {
        _id: uid(), itemRef: '', description: nl.description || 'New item',
        unit: nl.unit || 'item', qty: q,
        rate: q > 0 ? round2(total / q) : total,
        labour, materials, total,
        unitLabour: q > 0 ? labour / q : labour,
        unitMaterials: q > 0 ? materials / q : materials,
      };
    };
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, items: s.items.slice() }));
      for (const u of (p.line_updates || [])) {
        const sec = next[u.s];
        if (!sec || !sec.items[u.i]) continue;
        const { ref, s, i, ...fields } = u;
        sec.items[u.i] = applyItemPatch(sec.items[u.i], fields);
      }
      // remove_locs arrives sorted bottom-up so splices don't shift later ones.
      for (const loc of (p.remove_locs || [])) {
        const sec = next[loc.s];
        if (!sec || !sec.items[loc.i]) continue;
        sec.items.splice(loc.i, 1);
      }
      for (const nl of (p.new_lines || [])) {
        const sec = next[nl.s] || next[next.length - 1];
        if (!sec) continue;
        sec.items.push(buildNewItem(nl));
      }
      for (const ns of (p.new_sections || [])) {
        next.push({
          number: ns.number, title: ns.title, provisional: !!ns.provisional,
          items: (ns.items || []).map(buildNewItem),
        });
      }
      return next;
    });
    // Open any freshly-created sections so the builder sees them land.
    if (p.new_sections && p.new_sections.length) {
      setOpenSectionIds((m) => {
        const o = { ...m };
        for (const ns of p.new_sections) o[ns.number] = true;
        return o;
      });
    }
    const c = p.controls || {};
    if (c.overhead_pct != null) setDefaultOhp(c.overhead_pct);
    if (c.profit_pct != null) setProfit(c.profit_pct);
    if (c.contingency_pct != null) setContingency(c.contingency_pct);
    if (c.vat_pct != null) setVat(c.vat_pct);
    if (c.provisional_sum != null) setProvisionalSum(c.provisional_sum);
  };

  const totalItemCount = sections.reduce((a, s) => a + s.items.length, 0);
  const isDirty = useMemo(() =>
    JSON.stringify(sections) !== JSON.stringify(originalSections),
    [sections, originalSections]
  );

  // ─── Persistence ──────────────────────────────────────────────────────────
  // Everything the user can change on this screen, captured as one object that
  // is saved to the server so it survives leaving and re-opening the screen.
  const workingState = useMemo(() => ({
    v: 1,
    sections,
    builder_margin: builderMargin,
    materials_markup: materialsMarkup,
    default_ohp: defaultOhp,
    profit,
    contingency,
    vat,
    per_trade_ohp: perTradeOhp,
    prelims_mode: prelimsMode,
    prelims_amount: prelimsAmount,
    prelims_pct: prelimsPct,
    day_rate_on: dayRateOn,
    day_rate: dayRate,
    rounding,
    provisional_sum: provisionalSum,
  }), [sections, builderMargin, materialsMarkup, defaultOhp, profit, contingency, vat,
       perTradeOhp, prelimsMode, prelimsAmount, prelimsPct, dayRateOn, dayRate, rounding, provisionalSum]);

  const workingStateRef = useRef(workingState);
  workingStateRef.current = workingState;
  const hydratedRef = useRef(false);      // becomes true once the initial load is captured
  const lastSavedJsonRef = useRef(null);  // JSON of the last state we persisted
  const saveTimerRef = useRef(null);
  const [saveStatus, setSaveStatus] = useState('saved'); // saved | saving | unsaved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const snapshot = workingStateRef.current;
    const json = JSON.stringify(snapshot);
    if (json === lastSavedJsonRef.current) { setSaveStatus('saved'); return; }
    try {
      setSaveStatus('saving');
      await apiFetch(`/projects/${id}/builder-pack-state`, {
        method: 'PUT',
        body: JSON.stringify({ state: snapshot }),
      });
      lastSavedJsonRef.current = json;
      setLastSavedAt(Date.now());
      setSaveStatus('saved');
    } catch (e) {
      setSaveStatus('error');
    }
  }, [id]);

  // Capture the loaded state as the baseline once (so we don't immediately
  // re-save what we just read back), then enable auto-save.
  useEffect(() => {
    if (loading || hydratedRef.current) return;
    hydratedRef.current = true;
    lastSavedJsonRef.current = JSON.stringify(workingStateRef.current);
    setSaveStatus('saved');
  }, [loading]);

  // Debounced auto-save: persist ~1s after the user stops editing, so it "just
  // saves as you go". The manual Save button (below) flushes immediately.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const json = JSON.stringify(workingState);
    if (json === lastSavedJsonRef.current) { setSaveStatus('saved'); return; }
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveNow(); }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [workingState, saveNow]);

  // Warn before leaving the tab/window with unsaved or in-flight changes.
  useEffect(() => {
    const handler = (e) => {
      if (saveStatus === 'unsaved' || saveStatus === 'saving') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1480, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <Link to={`/project/${id}`} style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Back to project
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          <h1 style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em',
          }}>
            Builder Pack & Client Copy
          </h1>
          <span style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em',
            padding: '3px 8px', borderRadius: 5,
            background: 'rgba(239,68,68,0.12)', color: '#EF4444',
            border: '1px solid rgba(239,68,68,0.3)',
            textTransform: 'uppercase',
          }}>Testing · Beta</span>
        </div>
        {project && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            {project.title} · {project.project_type} · {totalItemCount} item{totalItemCount === 1 ? '' : 's'} across {sections.length} trade{sections.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: 4, borderRadius: 10,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        marginBottom: 18, width: 'fit-content',
      }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
              background: tab === t.key ? (t.key === 'builder' ? '#F59E0B' : '#A855F7') : 'transparent',
              color: tab === t.key ? (t.key === 'builder' ? '#0A0F1C' : '#fff') : 'var(--text-muted)',
              border: 'none', cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {!loading && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          marginBottom: 14, padding: '10px 14px', borderRadius: 10,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
        }}>
          <button
            onClick={saveNow}
            disabled={saveStatus === 'saving' || saveStatus === 'saved'}
            style={{
              padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none',
              cursor: (saveStatus === 'saving' || saveStatus === 'saved') ? 'default' : 'pointer',
              background: (saveStatus === 'unsaved' || saveStatus === 'error') ? '#10B981' : 'var(--border)',
              color: (saveStatus === 'unsaved' || saveStatus === 'error') ? '#fff' : 'var(--text-muted)',
            }}
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save changes'}
          </button>
          <span style={{ fontSize: 12.5, color: saveStatus === 'error' ? '#EF4444' : 'var(--text-muted)' }}>
            {saveStatus === 'saving' && 'Saving your changes…'}
            {saveStatus === 'unsaved' && 'Unsaved changes — saving automatically…'}
            {saveStatus === 'error' && 'Could not save — click Save changes to retry.'}
            {saveStatus === 'saved' && (lastSavedAt
              ? 'All changes saved — your figures, colours and exclusions are kept.'
              : 'Your edits save automatically as you go.')}
          </span>
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#EF4444', fontSize: 13,
        }}>{error}</div>
      )}

      {/* Rate-library import offer */}
      {rateImportResult && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
          color: '#10B981', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          <span>
            ✓ Rate library updated — {rateImportResult.created} new rate{rateImportResult.created === 1 ? '' : 's'} added
            {rateImportResult.updated > 0 ? `, ${rateImportResult.updated} updated` : ''}
            {rateImportResult.skipped_existing > 0 ? ` · ${rateImportResult.skipped_existing} kept at your existing value` : ''}.
          </span>
          <button onClick={() => setRateImportResult(null)}
            style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>×</button>
        </div>
      )}
      {!loading && rateImport && !rateBannerDismissed && !rateImportResult && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.25)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            <strong>{rateImport.counts.total}</strong> priced rate{rateImport.counts.total === 1 ? '' : 's'} found in this BOQ
            {rateImport.counts.new > 0
              ? <> — <strong>{rateImport.counts.new}</strong> not yet in your rate library{rateImport.counts.exists_differs > 0 ? `, ${rateImport.counts.exists_differs} already saved at a different value` : ''}.</>
              : rateImport.counts.exists_differs > 0
                ? <> — all in your library, but <strong>{rateImport.counts.exists_differs}</strong> at a different value.</>
                : ' — all already in your rate library at the same values.'}
          </span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button onClick={() => setRateModalOpen(true)}
              style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, background: '#2563EB', color: '#fff', border: 'none', cursor: 'pointer' }}>
              Review & import
            </button>
            <button onClick={dismissRateBanner}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              Not now
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)' }}>
          Reading the BOQ…
        </div>
      )}

      {!loading && (
        // minmax(0, 1fr) matters: a bare 1fr's min-size is the table's
        // min-content width, which blew the grid out past the viewport and
        // clipped the Total column on laptop screens instead of letting the
        // table scroll inside its own card.
        <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : 'minmax(260px, 310px) minmax(0, 1fr)', gap: 18, alignItems: 'flex-start' }}>
          {/* Sticky control sidebar (stacks on top below ~1150px) */}
          <div style={{
            position: isNarrow ? 'static' : 'sticky', top: 12,
            padding: 18, borderRadius: 12,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            maxHeight: isNarrow ? 'none' : 'calc(100vh - 40px)', overflowY: isNarrow ? 'visible' : 'auto',
          }}>
            {tab === 'builder' ? (
              <BuilderControls
                builderMargin={builderMargin} setBuilderMargin={setBuilderMargin}
                materialsMarkup={materialsMarkup} setMaterialsMarkup={setMaterialsMarkup}
                onDownload={downloadBuilderPack} downloading={downloading}
                disabled={builderRows.length === 0}
                isDirty={isDirty} onReset={resetEdits}
              />
            ) : (
              <ClientControls
                defaultOhp={defaultOhp} setDefaultOhp={setDefaultOhp}
                profit={profit} setProfit={setProfit}
                contingency={contingency} setContingency={setContingency}
                vat={vat} setVat={setVat}
                rounding={rounding} setRounding={setRounding}
                prelimsMode={prelimsMode} setPrelimsMode={setPrelimsMode}
                prelimsAmount={prelimsAmount} setPrelimsAmount={setPrelimsAmount}
                prelimsPct={prelimsPct} setPrelimsPct={setPrelimsPct}
                dayRateOn={dayRateOn} setDayRateOn={setDayRateOn}
                dayRate={dayRate} setDayRate={setDayRate}
                provisionalSum={provisionalSum} setProvisionalSum={setProvisionalSum}
                perTradeOhp={perTradeOhp} setPerTradeOhp={setPerTradeOhp}
                sections={sections} sym={sym}
                projectType={(project && project.project_type) || ''}
                onSaveProjectType={saveProjectType} savingType={savingType}
                label={label}
                onDownload={downloadClientCopy} downloading={downloading}
                onShare={shareWithClient} sharing={sharing}
                disabled={clientRows.length === 0}
                isDirty={isDirty} onReset={resetEdits} sourceSeeded={sourceSeeded}
              />
            )}
          </div>

          {/* Main: editable items + previews */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Editable items */}
            <div style={{
              padding: 18, borderRadius: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Line items (editable)</h2>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {hasSplit
                    ? 'Edit qty, labour or materials — the line total and nett recompute automatically. Changing qty rescales the line at its rate.'
                    : 'Edit qty or the line total — the bill recomputes automatically. This BOQ is priced on a composite basis (one rate per line), so labour/materials aren’t shown separately.'}
                </span>
              </div>

              {sections.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                  No priced sections found in this BOQ.
                </div>
              )}

              {sections.map((s, sIdx) => {
                const open = !!openSectionIds[s.number];
                const t = sectionTotals[sIdx];
                return (
                  <div key={s.number + '-' + sIdx} style={{
                    borderRadius: 10, border: '1px solid var(--border)',
                    marginTop: 10, overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', background: 'rgba(27,42,74,0.06)',
                    }}>
                      <button
                        onClick={() => setOpenSectionIds((m) => ({ ...m, [s.number]: !m[s.number] }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)' }}
                        aria-label={open ? 'Collapse' : 'Expand'}
                      >{open ? '▾' : '▸'}</button>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)', minWidth: 28 }}>{s.number}</span>
                      <input
                        value={s.title}
                        onChange={(e) => updateSectionTitle(sIdx, e.target.value)}
                        style={{
                          flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700,
                          background: 'transparent', border: 'none', color: 'var(--text-primary)',
                          padding: '3px 4px', outline: 'none',
                        }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.items.length} item{s.items.length === 1 ? '' : 's'}</span>
                      <span style={{ fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text-primary)', minWidth: 90, textAlign: 'right' }}>
                        {fmt(sym, t.total)}
                      </span>
                    </div>

                    {open && (
                      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: isMobile ? 560 : 700, tableLayout: 'fixed' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)', textAlign: 'left' }}>
                              <th style={th(48)}>Ref</th>
                              <th style={{ ...th(), minWidth: 200, width: 'auto' }}>Description</th>
                              <th style={th(60)}>Unit</th>
                              <th style={{ ...th(60), textAlign: 'right' }}>Qty</th>
                              {hasSplit && <th style={{ ...th(90), textAlign: 'right' }}>Labour</th>}
                              {hasSplit && <th style={{ ...th(90), textAlign: 'right' }}>Materials</th>}
                              <th style={{ ...th(96), textAlign: 'right' }}>Total</th>
                              <th style={th(30)}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.items.map((it, iIdx) => {
                              const total = lineTotal(it);
                              return (
                                <tr key={it._id || iIdx} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={td()}>
                                    <input value={it.itemRef || ''} onChange={(e) => updateItem(sIdx, iIdx, { itemRef: e.target.value })}
                                      style={{ ...inputCell, fontFamily: 'JetBrains Mono, monospace' }} />
                                  </td>
                                  <td style={td()}>
                                    <textarea value={it.description || ''} onChange={(e) => updateItem(sIdx, iIdx, { description: e.target.value })}
                                      rows={1}
                                      style={{ ...inputCell, resize: 'vertical', minHeight: 26, fontFamily: 'inherit' }} />
                                  </td>
                                  <td style={td()}>
                                    <input value={it.unit || ''} onChange={(e) => updateItem(sIdx, iIdx, { unit: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'center' }} />
                                  </td>
                                  <td style={td()}>
                                    <input type="number" inputMode="decimal" step="0.01" value={it.qty}
                                      onChange={(e) => updateItem(sIdx, iIdx, { qty: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'right' }} />
                                  </td>
                                  {hasSplit && (
                                  <td style={td()}>
                                    <input type="number" inputMode="decimal" step="0.01" value={it.labour}
                                      onChange={(e) => updateItem(sIdx, iIdx, { labour: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'right', color: '#3B82F6' }} />
                                  </td>
                                  )}
                                  {hasSplit && (
                                  <td style={td()}>
                                    <input type="number" inputMode="decimal" step="0.01" value={it.materials}
                                      onChange={(e) => updateItem(sIdx, iIdx, { materials: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'right', color: '#A855F7' }} />
                                  </td>
                                  )}
                                  {hasSplit ? (
                                  <td style={{ ...td(), textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                                    {fmt(sym, total, 2)}
                                  </td>
                                  ) : (
                                  <td style={td()}>
                                    <input type="number" inputMode="decimal" step="0.01" value={it.total}
                                      onChange={(e) => updateItem(sIdx, iIdx, { total: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }} />
                                  </td>
                                  )}
                                  <td style={td()}>
                                    <button
                                      onClick={() => removeItem(sIdx, iIdx)}
                                      title="Remove item"
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}
                                    >×</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-primary)' }}>
                          <button
                            onClick={() => addItem(sIdx)}
                            style={{
                              background: 'none', border: '1px dashed var(--border)',
                              borderRadius: 6, padding: '5px 10px',
                              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                              color: 'var(--text-muted)',
                            }}
                          >+ Add item</button>
                          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Subtotal: <strong style={{ color: 'var(--text-primary)' }}>{fmt(sym, t.total, 2)}</strong>
                            {hasSplit && <span style={{ color: '#3B82F6' }}>{' '}· L {fmt(sym, t.labour)}</span>}
                            {hasSplit && <span style={{ color: '#A855F7' }}>{' '}· M {fmt(sym, t.materials)}</span>}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Live preview */}
            <div style={{
              padding: 18, borderRadius: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
            }}>
              {tab === 'builder'
                ? <BuilderPreview rows={builderRows} totals={builderGrand} base={baseGrand}
                    builderMargin={builderMargin} materialsMarkup={materialsMarkup} sym={sym}
                    branding={branding} logoUrl={logoUrl} projectName={project ? project.title : ''} />
                : <ClientPreview rows={clientRows} sym={sym}
                    summaryLines={summaryLines} exVat={exVat} vat={vat} vatVal={vatVal} inclVat={inclVat}
                    branding={branding} logoUrl={logoUrl} projectName={project ? project.title : ''}
                    projectType={project ? project.project_type : ''} />
              }
            </div>
          </div>
        </div>
      )}

      {share && (
        <ShareLinkModal
          t={t}
          url={share.url}
          title={'Send the ' + label.noun + ' to your client'}
          message={'Here’s your ' + label.noun + ' — you can view and accept it here:'}
          onClose={() => setShare(null)}
        />
      )}

      {/* "Update with AI" — chat drawer for amending the bill. Applied changes
          go through the same state as manual edits, so auto-save, the live
          preview, downloads and the share link all pick them up. */}
      {!loading && sections.length > 0 && (
        <AssistantDrawer
          t={t}
          isMobile={isMobile}
          endpoint={`/projects/${id}/builder-pack/assistant`}
          getFormFields={() => ({ pack_state: JSON.stringify(getPackState()) })}
          currency={project && project.currency === 'EUR' ? 'EUR' : 'GBP'}
          onApply={applyAssistantProposal}
          title="✨ Update this bill"
          examples={[
            '"I\'ve got the electrician\'s quote now" — attach it and I\'ll adjust the costs',
            '"Add £400 for a second skip"',
            '"Scaffold\'s gone up to £21,500"',
            '"Set VAT to 20% and add 5% contingency"',
          ]}
          appliedNote="✓ Applied — saved automatically. Download the client copy or re-share when you're ready."
        />
      )}

      {rateModalOpen && rateImport && (
        <RateImportModal
          projectId={id}
          candidates={rateImport.candidates}
          sym={sym}
          onClose={() => setRateModalOpen(false)}
          onImported={(result) => {
            setRateImportResult(result);
            setRateModalOpen(false);
            dismissRateBanner();
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

const inputCell = {
  width: '100%',
  padding: '4px 6px', borderRadius: 5,
  background: 'transparent', color: 'var(--text-primary)',
  border: '1px solid transparent', fontSize: 12, outline: 'none',
  boxSizing: 'border-box',
};
const th = (w) => ({
  padding: '8px 10px', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '0.04em', textTransform: 'uppercase',
  width: w || 'auto', whiteSpace: 'nowrap',
});
const td = () => ({ padding: '4px 8px', verticalAlign: 'top' });

const inputStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 7,
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', fontSize: 12, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const selectStyle = { ...inputStyle, cursor: 'pointer' };

function primaryBtn(color, disabled, textColor) {
  return {
    width: '100%', padding: '11px 16px', borderRadius: 9,
    background: color, color: textColor || '#0A0F1C',
    fontWeight: 700, fontSize: 13.5, border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    marginTop: 6,
  };
}

function ResetRow({ isDirty, onReset }) {
  if (!isDirty) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '7px 10px', borderRadius: 7,
      background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
      marginBottom: 12,
    }}>
      <span style={{ fontSize: 11.5, color: '#F59E0B', fontWeight: 600 }}>You've edited line items</span>
      <button onClick={onReset}
        style={{ background: 'none', border: '1px solid rgba(245,158,11,0.35)', color: '#F59E0B', borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
      >Reset</button>
    </div>
  );
}

// Review-and-confirm dialog for pulling this BOQ's rates into the user's rate
// library. New rates are pre-ticked; rates the user already holds are shown
// with their existing value and are only overwritten if explicitly ticked.
function RateImportModal({ projectId, candidates, sym, onClose, onImported }) {
  const ordered = useMemo(() => {
    const rank = { new: 0, exists_differs: 1, exists_same: 2 };
    return candidates.slice().sort((a, b) =>
      (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.display_name.localeCompare(b.display_name));
  }, [candidates]);

  const [sel, setSel] = useState(() => {
    const s = {};
    for (const c of candidates) s[c.category + '|' + c.item_key + '|' + c.unit] = c.status === 'new';
    return s;
  });
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState('');

  const keyOf = (c) => c.category + '|' + c.item_key + '|' + c.unit;
  const selectedCount = ordered.filter((c) => sel[keyOf(c)]).length;

  const setAllNew = (on) => {
    setSel((prev) => {
      const next = { ...prev };
      for (const c of ordered) if (c.status === 'new') next[keyOf(c)] = on;
      return next;
    });
  };

  async function doImport() {
    setImporting(true); setErr('');
    try {
      const rates = ordered.filter((c) => sel[keyOf(c)]).map((c) => ({
        category: c.category,
        display_name: c.display_name,
        value: c.value,
        unit: c.unit,
        update_existing: c.status === 'exists_differs',
      }));
      const result = await apiFetch(`/projects/${projectId}/rate-import/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      });
      if (result.error) throw new Error(result.error);
      onImported(result);
    } catch (e) {
      setErr(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const catLabel = (cat) => cat.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  const money = (v) => sym + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(820px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 18px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700 }}>Import rates to your library</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            These are the unit rates this BOQ was priced at. New rates are ticked; rates already in your
            library are left unticked — ticking one of those will <strong>overwrite</strong> your saved value with the BOQ's.
          </p>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => setAllNew(true)}
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: 'transparent', color: '#2563EB', border: '1px solid rgba(37,99,235,0.4)', cursor: 'pointer' }}>
              Select all new
            </button>
            <button onClick={() => setAllNew(false)}
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              Clear new
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '6px 20px', flex: 1 }}>
          {ordered.map((c) => {
            const k = keyOf(c);
            const checked = !!sel[k];
            return (
              <label key={k} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 4px',
                borderBottom: '1px solid var(--border)', cursor: 'pointer',
              }}>
                <input type="checkbox" checked={checked}
                  onChange={(e) => setSel((prev) => ({ ...prev, [k]: e.target.checked }))}
                  style={{ marginTop: 3, cursor: 'pointer' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                    {c.display_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>{catLabel(c.category)}</span>
                    <span>·</span>
                    <span>{money(c.value)} / {c.unit}</span>
                    {c.status === 'new' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#10B981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6, padding: '1px 7px' }}>New</span>
                    )}
                    {c.status === 'exists_same' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 6, padding: '1px 7px' }}>Already in your library — same rate</span>
                    )}
                    {c.status === 'exists_differs' && c.existing && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#F59E0B', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '1px 7px' }}>
                        In your library at {money(c.existing.value)} — tick to overwrite with {money(c.value)}
                      </span>
                    )}
                    {c.variant_rates && (
                      <span style={{ fontSize: 10, color: '#F59E0B' }}>
                        Multiple rates in this BOQ ({c.variant_rates.map(money).join(', ')}) — highest-quantity rate shown
                      </span>
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          {err && <span style={{ fontSize: 12, color: '#EF4444' }}>{err}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={doImport} disabled={importing || selectedCount === 0}
              style={{
                padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none',
                background: '#2563EB', color: '#fff',
                cursor: (importing || selectedCount === 0) ? 'not-allowed' : 'pointer',
                opacity: (importing || selectedCount === 0) ? 0.55 : 1,
              }}>
              {importing ? 'Importing…' : `Import ${selectedCount} rate${selectedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BuilderControls({
  builderMargin, setBuilderMargin, materialsMarkup, setMaterialsMarkup,
  onDownload, downloading, disabled, isDirty, onReset,
}) {
  return (
    <>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>Builder margins</h3>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Add your blanket margin on every line, plus an extra uplift on materials only.
      </p>
      <ResetRow isDirty={isDirty} onReset={onReset} />
      <Slider label="Builder margin (all rates)" value={builderMargin} onChange={setBuilderMargin} max={40} hint="Applies to labour and materials" />
      <Slider label="Materials markup (extra)" value={materialsMarkup} onChange={setMaterialsMarkup} max={40} hint="Stacks on top of builder margin, materials only" />
      <button onClick={onDownload} disabled={downloading || disabled} style={primaryBtn('#F59E0B', downloading || disabled)}>
        {downloading ? 'Generating…' : 'Download Builder Pack (3 tabs)'}
      </button>
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '8px 0 0', textAlign: 'center' }}>
        Trade Summary · Materials Schedule · Labour Schedule
      </p>
    </>
  );
}

function ClientControls({
  defaultOhp, setDefaultOhp, profit, setProfit, contingency, setContingency, vat, setVat,
  rounding, setRounding, prelimsMode, setPrelimsMode,
  prelimsAmount, setPrelimsAmount, prelimsPct, setPrelimsPct,
  dayRateOn, setDayRateOn, dayRate, setDayRate,
  provisionalSum, setProvisionalSum,
  perTradeOhp, setPerTradeOhp, sections, sym,
  projectType, onSaveProjectType, savingType, label,
  onDownload, downloading, onShare, sharing, disabled, isDirty, onReset, sourceSeeded,
}) {
  // Local copy so typing stays smooth; the project is saved on blur.
  const [typeDraft, setTypeDraft] = useState(projectType || '');
  useEffect(() => { setTypeDraft(projectType || ''); }, [projectType]);
  return (
    <>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>Client copy controls</h3>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
        What the client sees. No margin shown separately — uplift is baked into rates.
        {sourceSeeded
          ? ' These controls are pre-set to match your delivered BOQ, so the default download has the same bottom line — just rebranded. Adjust them to add your own margin.'
          : ' At 0 the copy matches your delivered BOQ like-for-like — just rebranded.'}
      </p>
      <ResetRow isDirty={isDirty} onReset={onReset} />

      <Field label={'Project type (shown on the ' + label.noun + ')'}>
        <input
          type="text"
          list="project-type-suggestions"
          value={typeDraft}
          onChange={(e) => setTypeDraft(e.target.value)}
          onBlur={() => onSaveProjectType(typeDraft)}
          placeholder="e.g. Single-storey extension"
          style={inputStyle}
        />
        <datalist id="project-type-suggestions">
          {PROJECT_TYPE_SUGGESTIONS.map((o) => <option key={o} value={o} />)}
        </datalist>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
          {savingType
            ? 'Saving…'
            : 'Prints as "Project type" on the ' + label.noun + '. Saves when you click outside the box — re-share to update a link your client already has.'}
        </div>
      </Field>

      <Slider label="Overhead" value={defaultOhp} onChange={setDefaultOhp} max={40} hint="% on net — baked into rates (overridable per trade below)" />
      <Slider label="Profit" value={profit} onChange={setProfit} max={40} hint="% on net + overhead — compounds with overhead" />
      <Slider label="Contingency" value={contingency} onChange={setContingency} max={20} hint="% of construction net — separate summary line" />
      <Slider label="VAT" value={vat} onChange={setVat} max={25} hint="Set 0 if quoting ex-VAT" />

      <Field label="Rounding">
        <select value={rounding} onChange={(e) => setRounding(parseInt(e.target.value, 10))} style={selectStyle}>
          {ROUNDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Preliminaries">
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {[{ v: 'off', l: 'Off' }, { v: 'flat', l: 'Flat £' }, { v: 'pct', l: '% of net' }].map((o) => (
            <button key={o.v} onClick={() => setPrelimsMode(o.v)}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6,
                fontSize: 11.5, fontWeight: 700,
                background: prelimsMode === o.v ? '#A855F7' : 'transparent',
                color: prelimsMode === o.v ? '#fff' : 'var(--text-muted)',
                border: '1px solid ' + (prelimsMode === o.v ? '#A855F7' : 'var(--border)'),
                cursor: 'pointer',
              }}
            >{o.l}</button>
          ))}
        </div>
        {prelimsMode === 'flat' && (
          <input type="number" inputMode="decimal" min="0" step="50" value={prelimsAmount}
            onChange={(e) => setPrelimsAmount(parseFloat(e.target.value) || 0)}
            placeholder="e.g. 2500" style={inputStyle} />
        )}
        {prelimsMode === 'pct' && (
          <input type="number" inputMode="decimal" min="0" max="20" step="0.5" value={prelimsPct}
            onChange={(e) => setPrelimsPct(parseFloat(e.target.value) || 0)}
            placeholder="e.g. 5" style={inputStyle} />
        )}
      </Field>

      <Field label="Provisional sums">
        <input type="number" inputMode="decimal" min="0" step="50" value={provisionalSum}
          onChange={(e) => setProvisionalSum(parseFloat(e.target.value) || 0)}
          placeholder="e.g. 200250" style={inputStyle} />
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
          Lump sum carried from the tender, added flat (no OH&P) — VAT still applies.
        </div>
      </Field>

      <Field label={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Day-rate / mgmt
          <input type="checkbox" checked={dayRateOn} onChange={(e) => setDayRateOn(e.target.checked)} style={{ accentColor: '#A855F7' }} />
        </span>
      }>
        {dayRateOn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="text" value={dayRate.label}
              onChange={(e) => setDayRate((d) => ({ ...d, label: e.target.value }))}
              placeholder="Label (e.g. Site management)" style={inputStyle} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" inputMode="decimal" min="0" step="0.5" value={dayRate.days}
                onChange={(e) => setDayRate((d) => ({ ...d, days: parseFloat(e.target.value) || 0 }))}
                placeholder="Days" style={{ ...inputStyle, flex: 1 }} />
              <input type="number" inputMode="decimal" min="0" step="25" value={dayRate.rate_per_day}
                onChange={(e) => setDayRate((d) => ({ ...d, rate_per_day: parseFloat(e.target.value) || 0 }))}
                placeholder={`${sym}/day`} style={{ ...inputStyle, flex: 1 }} />
            </div>
          </div>
        )}
      </Field>

      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0' }}>
          Per-trade uplift override ({Object.keys(perTradeOhp).length})
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {sections.map((s) => {
            const has = Object.prototype.hasOwnProperty.call(perTradeOhp, s.number);
            return (
              <div key={s.number} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 6,
                background: has ? 'rgba(168,85,247,0.06)' : 'transparent',
                border: '1px solid ' + (has ? 'rgba(168,85,247,0.3)' : 'var(--border)'),
              }}>
                <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.number}. {s.title}
                </span>
                <input type="number" inputMode="decimal" min="0" max="80" step="0.5"
                  value={has ? perTradeOhp[s.number] : ''}
                  placeholder={(Math.round(((1 + defaultOhp / 100) * (1 + profit / 100) - 1) * 1e4) / 100) + '%'}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPerTradeOhp((m) => {
                      const next = { ...m };
                      if (v === '' || v == null) delete next[s.number];
                      else next[s.number] = parseFloat(v) || 0;
                      return next;
                    });
                  }}
                  style={{ ...inputStyle, width: 60, padding: '4px 6px', fontSize: 11 }} />
                {has && (
                  <button onClick={() => setPerTradeOhp((m) => { const n = { ...m }; delete n[s.number]; return n; })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}
                    aria-label="Reset">×</button>
                )}
              </div>
            );
          })}
        </div>
      </details>

      <button onClick={onDownload} disabled={downloading || disabled} style={primaryBtn('#A855F7', downloading || disabled, '#fff')}>
        {downloading ? 'Generating…' : 'Download Client Copy'}
      </button>

      <button onClick={onShare} disabled={sharing || disabled} style={{ ...primaryBtn('#16A34A', sharing || disabled, '#fff'), marginTop: 8 }}>
        {sharing ? 'Preparing link…' : 'Share with client'}
      </button>
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
        Creates a private link your client can open on their phone — branded {label.noun}
        {' '}page with the figures above, PDF download, ask-a-question, and accept
        online with a typed signature. Re-share after edits to refresh the same link.
      </p>
    </>
  );
}

function Slider({ label, value, onChange, max, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#A855F7' }}>{value}%</span>
      </div>
      <input type="range" min="0" max={max} step="0.5" value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#A855F7' }} />
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const previewHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 100px 100px 100px 60px',
  minWidth: 460,
  gap: 8, padding: '9px 12px',
  background: 'rgba(27,42,74,0.06)',
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
  color: 'var(--text-muted)', textTransform: 'uppercase',
};
const previewRowStyle = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 100px 100px 100px 60px',
  minWidth: 460,
  gap: 8, padding: '10px 12px',
  borderTop: '1px solid var(--border)',
  fontSize: 12.5,
};
function moneyCell(color) {
  return {
    textAlign: 'right',
    fontFamily: 'JetBrains Mono, monospace',
    color: color || 'var(--text-primary)',
  };
}

function BuilderPreview({ rows, totals, base, builderMargin, materialsMarkup, sym, branding, logoUrl, projectName }) {
  base = base || { labour: 0, materials: 0, total: 0 };
  const bm = num(builderMargin), mm = num(materialsMarkup);
  const primary = (branding && branding.primary_colour) || '#1B2A4A';
  const accent  = (branding && branding.accent_colour)  || '#F59E0B';
  const company = branding && branding.company_name;
  const builderMarginAmt = base.total * (bm / 100);
  const materialsMarkupAmt = base.materials * (mm / 100);
  const totalAdded = builderMarginAmt + materialsMarkupAmt;
  const bRow = (label, value, opts = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '5px 0',
      borderTop: opts.strong ? '1px solid var(--border)' : 'none', marginTop: opts.strong ? 4 : 0 }}>
      <span style={{ fontSize: opts.strong ? 13.5 : 12.5, fontWeight: opts.strong ? 700 : 500, color: opts.muted ? 'var(--text-muted)' : 'var(--text-primary)' }}>{label}</span>
      <span style={{ fontSize: opts.strong ? 14 : 12.5, fontWeight: opts.strong ? 800 : 600, fontVariantNumeric: 'tabular-nums',
        color: opts.strong ? '#F59E0B' : (opts.muted ? 'var(--text-muted)' : 'var(--text-primary)') }}>{value}</span>
    </div>
  );
  return (
    <>
      {/* Branded header band — the builder's own logo and colours, so the pack
          they download carries their brand. */}
      <div style={{
        borderRadius: 10, overflow: 'hidden', marginBottom: 16,
        background: primary, color: '#fff', borderBottom: '4px solid ' + accent,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 8, flexShrink: 0,
          background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {logoUrl
            ? <img src={logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 9, color: '#888' }}>No logo</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Builder Pack
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2, marginTop: 2, color: '#fff' }}>
            {projectName || 'Project'}
          </div>
          {company && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{company}</div>}
        </div>
      </div>

      {/* Plain-English breakdown so the builder can see the true cost and
          exactly what (if anything) has been added on top. */}
      <div style={{ marginBottom: 18, padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>What's in these figures</div>
        {bRow('True build cost (priced labour + materials)', fmt(sym, base.total, 2))}
        {bRow(`Your builder margin (${bm}% on all rates)`, (builderMarginAmt > 0 ? '+ ' : '') + fmt(sym, builderMarginAmt, 2), { muted: bm === 0 })}
        {bRow(`Your materials markup (extra ${mm}% on materials)`, (materialsMarkupAmt > 0 ? '+ ' : '') + fmt(sym, materialsMarkupAmt, 2), { muted: mm === 0 })}
        {bRow('Builder pack total', fmt(sym, totals.total, 2), { strong: true })}
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          {totalAdded <= 0
            ? 'Nothing has been added on top — the total equals the priced build cost. Move the margin sliders on the left to add your markup, and you’ll see exactly how much it adds here.'
            : 'You’ve added ' + fmt(sym, totalAdded, 2) + ' on top of the priced build cost. The line figures below are the priced labour + materials; your margin is applied to them.'}
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px' }}>Trade summary preview</h2>
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={previewHeaderStyle}>
          <div>#</div><div>Trade</div>
          <div style={{ textAlign: 'right' }}>Labour</div>
          <div style={{ textAlign: 'right' }}>Materials</div>
          <div style={{ textAlign: 'right' }}>Total</div>
          <div style={{ textAlign: 'right' }}>%</div>
        </div>
        {rows.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>No priced sections in this BOQ.</div>}
        {rows.map((s, i) => {
          const pct = totals.total > 0 ? (s.total / totals.total) * 100 : 0;
          return (
            <div key={s.number + '-' + i} style={previewRowStyle}>
              <div style={{ color: 'var(--text-muted)' }}>{i + 1}</div>
              <div style={{ fontWeight: 500 }}>{s.title}<span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8 }}>{s.item_count} items</span></div>
              <div style={moneyCell('#3B82F6')}>{fmt(sym, s.labour)}</div>
              <div style={moneyCell('#A855F7')}>{fmt(sym, s.materials)}</div>
              <div style={{ ...moneyCell(), fontWeight: 700 }}>{fmt(sym, s.total)}</div>
              <div style={moneyCell('var(--text-muted)')}>{pct.toFixed(1)}%</div>
            </div>
          );
        })}
        <div style={{ ...previewRowStyle, background: 'rgba(245,158,11,0.08)', fontWeight: 700, fontSize: 13.5 }}>
          <div></div>
          <div>GRAND TOTAL</div>
          <div style={moneyCell()}>{fmt(sym, totals.labour)}</div>
          <div style={moneyCell()}>{fmt(sym, totals.materials)}</div>
          <div style={moneyCell('#F59E0B')}>{fmt(sym, totals.total)}</div>
          <div style={moneyCell()}>100%</div>
        </div>
        </div>
      </div>
    </>
  );
}

function ClientPreview({ rows, sym, summaryLines, exVat, vat, vatVal, inclVat, branding, logoUrl, projectName, projectType }) {
  const primary = (branding && branding.primary_colour) || '#1B2A4A';
  const accent  = (branding && branding.accent_colour)  || '#A855F7';
  const company = branding && branding.company_name;

  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Client copy preview</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        This is what your client will see. No margin shown separately.
      </p>

      {/* Branded cover band */}
      <div style={{
        borderRadius: 10, overflow: 'hidden', marginBottom: 14,
        background: '#fff', boxShadow: '0 4px 18px rgba(0,0,0,0.08)',
      }}>
        <div style={{
          background: primary, color: '#fff',
          padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14,
          borderBottom: '4px solid ' + accent,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 8, flexShrink: 0,
            background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {logoUrl
              ? <img src={logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <span style={{ fontSize: 9, color: '#888' }}>No logo</span>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Bill of Quantities · Client Copy
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, marginTop: 2, color: '#fff' }}>
              {projectName || 'Project'}
            </div>
            {projectType && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{projectType}</div>}
            {company && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>Issued by {company}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9.5, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Total ex-VAT</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: accent }}>
              {fmt(sym, exVat)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ ...previewHeaderStyle, gridTemplateColumns: '32px 1fr 80px 110px', background: primary, color: '#fff' }}>
          <div>#</div><div>Trade</div>
          <div style={{ textAlign: 'right' }}>OH&P</div>
          <div style={{ textAlign: 'right' }}>Sub-total</div>
        </div>
        {rows.map((s, i) => (
          <div key={s.number + '-' + i} style={{ ...previewRowStyle, gridTemplateColumns: '32px 1fr 80px 110px' }}>
            <div style={{ color: 'var(--text-muted)' }}>{i + 1}</div>
            <div style={{ fontWeight: 500 }}>{s.title}<span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8 }}>{s.item_count} items</span></div>
            <div style={moneyCell(accent)}>{((num(s.uplift) - 1) * 100).toFixed(1)}%</div>
            <div style={{ ...moneyCell(), fontWeight: 600 }}>{fmt(sym, s.subtotal)}</div>
          </div>
        ))}
        </div>
      </div>

      <div style={{
        marginTop: 16, borderRadius: 10, border: '1px solid var(--border)',
        background: 'var(--bg-primary)', padding: '14px 16px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Project summary
        </div>
        {summaryLines.map((l) => (
          <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>{l.label}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, l.value)}</span>
          </div>
        ))}
        <div style={{
          display: 'flex', justifyContent: 'space-between', padding: '8px 0',
          borderTop: '1px solid var(--border)', marginTop: 6,
          fontWeight: 700, fontSize: 14,
        }}>
          <span>Total (excl. VAT)</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, exVat)}</span>
        </div>
        {vat > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>VAT @ {vat}%</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, vatVal)}</span>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '8px 0',
              borderTop: '1px solid var(--border)', marginTop: 4,
              fontWeight: 800, fontSize: 16, color: '#A855F7',
            }}>
              <span>Total (incl. VAT)</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, inclVat)}</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
