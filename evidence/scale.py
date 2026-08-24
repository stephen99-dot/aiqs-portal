"""
scale.py — the scale proof engine's arithmetic (brief §4).

Pure functions, no PDF dependency, so the reasoning that matters most can be
tested exhaustively and read without a drawing in front of you.

The governing rule:

    Prove the scale TWICE, from independent evidence, on every sheet — and
    publish every proof tested, not just the ones that agree.

The single highest-yield discrimination in here is the arrowhead test. A CAD
export routinely stops its dimension line short of (or past) the arrowheads, so
every measured dimension is out by a CONSTANT. That is invisible in a median and
catastrophic in a bill: one undetected inset was 300 mm on every dimension.

    Plot residual against dimension value.
      residual FLAT with length          -> an arrowhead constant. Remove it.
      residual GROWING with length       -> the scale itself is wrong.

Never accept a median across a scattered fit: a naive median of 37.5 mm/pt
against a true 35.28 reads as "a sloppy set" when it is actually two populations.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Iterable

# ISO paper sizes in points (1 pt = 1/72"). Used to detect a half-size reissue:
# A0 -> A1 divides every length by sqrt(2), so a sheet whose title block says
# 1:500 @ A0 but which measures A1 is really 1:707 — not 1:500, not 1:1000.
PAPER_SIZES_PT = {
    "A0": (2384, 3370), "A1": (1684, 2384), "A2": (1191, 1684),
    "A3": (842, 1191), "A4": (595, 842),
}
SQRT2 = math.sqrt(2.0)

# A residual whose slope against length is below this is flat: the error does
# not grow with the dimension, so it is a constant offset, not a scale error.
FLAT_SLOPE_TOLERANCE = 0.02  # mm of residual per mm of dimension


@dataclass
class Proof:
    """One independent proof of a sheet's scale."""
    source: str           # e.g. "figured dimensions", "level datums", "door swings"
    mm_per_pt: float
    samples: int
    spread_pct: float     # max deviation across the samples, as a percentage
    note: str = ""

    def scale_ratio(self) -> float:
        """1:N, where N is how many real mm one drawing mm represents."""
        return self.mm_per_pt * 72.0 / 25.4


@dataclass
class ScaleProofTable:
    proofs: list = field(default_factory=list)
    arrowhead_constant_mm: float | None = None
    paper_size: str | None = None
    stated_scale: str | None = None
    half_size_suspected: bool = False
    agreed_mm_per_pt: float | None = None
    agreement_pct: float | None = None
    usable: bool = False
    verdict: str = ""
    warnings: list = field(default_factory=list)

    def to_dict(self):
        d = asdict(self)
        d["proofs"] = [asdict(p) | {"scale_ratio": round(p.scale_ratio(), 2)} for p in self.proofs]
        return d


def classify_residuals(pairs: Iterable[tuple[float, float]]) -> dict:
    """
    Distinguish an arrowhead constant from a scale error.

    `pairs` is (stated_dimension_mm, measured_dimension_mm).

    Returns the diagnosis plus the constant to remove, if there is one.
    """
    pts = [(float(s), float(m)) for s, m in pairs if s and float(s) > 0]
    if len(pts) < 3:
        return {"diagnosis": "insufficient", "samples": len(pts),
                "note": "At least 3 dimensions are needed to separate a constant from a scale error."}

    residuals = [m - s for s, m in pts]
    lengths = [s for s, _ in pts]

    # Least-squares slope of residual against length.
    n = len(pts)
    mean_x = sum(lengths) / n
    mean_y = sum(residuals) / n
    sxx = sum((x - mean_x) ** 2 for x in lengths)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(lengths, residuals))
    slope = (sxy / sxx) if sxx > 0 else 0.0
    intercept = mean_y - slope * mean_x

    spread = max(residuals) - min(residuals)
    flat = abs(slope) < FLAT_SLOPE_TOLERANCE

    if flat and abs(mean_y) > 1.0:
        direction = "overshoot (dimension line runs past the arrowheads; every dimension reads LONG)" \
            if mean_y > 0 else "inset (dimension line stops short; every dimension reads SHORT)"
        return {
            "diagnosis": "arrowhead_constant",
            "constant_mm": round(mean_y, 2),
            "slope": round(slope, 5),
            "residual_spread_mm": round(spread, 2),
            "samples": n,
            "note": f"Residual is flat against length ({slope:+.4f} mm/mm), so the error does not grow "
                    f"with the dimension: an arrowhead {direction}. Remove the {mean_y:+.1f} mm constant "
                    f"and re-fit. Treat this as the DEFAULT EXPECTATION on a CAD-exported domestic set.",
        }
    if not flat:
        return {
            "diagnosis": "scale_error",
            "slope": round(slope, 5),
            "implied_correction": round(1.0 + slope, 5),
            "residual_spread_mm": round(spread, 2),
            "samples": n,
            "note": f"Residual grows with length ({slope:+.4f} mm/mm), so this is a SCALE error, not an "
                    f"arrowhead offset. The scale is out by about {abs(slope) * 100:.2f}%.",
        }
    return {
        "diagnosis": "clean",
        "constant_mm": round(mean_y, 2),
        "slope": round(slope, 5),
        "residual_spread_mm": round(spread, 2),
        "samples": n,
        "note": "Residuals are flat and near zero — no arrowhead constant and no scale error.",
    }


def detect_paper_size(width_pt: float, height_pt: float, tolerance_pt: float = 12.0) -> str | None:
    """Name the ISO size of a page, orientation-independent."""
    w, h = sorted((float(width_pt), float(height_pt)))
    for name, (pw, ph) in PAPER_SIZES_PT.items():
        if abs(w - pw) <= tolerance_pt and abs(h - ph) <= tolerance_pt:
            return name
    return None


def check_half_size_reissue(stated_paper: str | None, actual_paper: str | None) -> dict:
    """
    A title block reading "1:500 @ A0" on a page that measures A1 is 1:707 —
    not 1:500 and not 1:1000. Each ISO step divides lengths by sqrt(2).
    """
    if not stated_paper or not actual_paper or stated_paper == actual_paper:
        return {"half_size": False}
    order = ["A0", "A1", "A2", "A3", "A4"]
    if stated_paper not in order or actual_paper not in order:
        return {"half_size": False}
    steps = order.index(actual_paper) - order.index(stated_paper)
    if steps <= 0:
        return {"half_size": False}
    factor = SQRT2 ** steps
    return {
        "half_size": True,
        "steps": steps,
        "factor": round(factor, 4),
        "note": f"The title block states {stated_paper} but the page measures {actual_paper} "
                f"({steps} ISO step{'s' if steps > 1 else ''} down). Every length is divided by "
                f"{factor:.4f}, so the true scale is the stated one multiplied by {factor:.4f} — "
                f"not the stated value and not a round doubling. A {steps}-step reduction read as "
                f"the stated scale under-measures by {(1 - 1 / factor) * 100:.1f}%.",
    }


def build_proof_table(proofs: list, stated_scale: str | None = None,
                      paper_size: str | None = None,
                      arrowhead_constant_mm: float | None = None,
                      half_size: dict | None = None) -> ScaleProofTable:
    """
    Assemble the proof table. Two independent proofs are the minimum; a set whose
    proofs scatter is usable for big items and not safe for small ones, and the
    table must say so rather than quietly averaging them.
    """
    t = ScaleProofTable(proofs=list(proofs), stated_scale=stated_scale,
                        paper_size=paper_size, arrowhead_constant_mm=arrowhead_constant_mm)

    if half_size and half_size.get("half_size"):
        t.half_size_suspected = True
        t.warnings.append(half_size["note"])

    if len(t.proofs) == 0:
        t.usable = False
        t.verdict = ("NO PROOF. Nothing on this sheet establishes its scale. The correct output is "
                     "no BOQ — a pack that cannot support a measurement should be declined, not estimated.")
        return t

    if len(t.proofs) == 1:
        t.agreed_mm_per_pt = t.proofs[0].mm_per_pt
        t.usable = False
        t.verdict = (f"ONE PROOF ONLY ({t.proofs[0].source}). The rule is two independent proofs per sheet. "
                     f"Quantities from this sheet are provisional until a second, independent proof agrees.")
        return t

    values = [p.mm_per_pt for p in t.proofs]
    lo, hi = min(values), max(values)
    mid = (lo + hi) / 2.0
    spread_pct = ((hi - lo) / mid * 100.0) if mid else 0.0
    t.agreed_mm_per_pt = sum(values) / len(values)
    t.agreement_pct = round(spread_pct, 2)

    if spread_pct <= 0.5:
        t.usable = True
        t.verdict = (f"{len(t.proofs)} independent proofs agree to {spread_pct:.2f}% "
                     f"({', '.join(p.source for p in t.proofs)}). The scale is settled.")
    elif spread_pct <= 5.0:
        t.usable = True
        t.verdict = (f"{len(t.proofs)} proofs scatter by {spread_pct:.2f}%. Usable for large items; "
                     f"NOT safe for small ones. Every quantity derived from this sheet carries that band.")
        t.warnings.append("Do not take a median across a scattered fit — find out why the outliers are out.")
    else:
        t.usable = False
        t.verdict = (f"{len(t.proofs)} proofs disagree by {spread_pct:.2f}%. That is not a scale, it is two "
                     f"populations. Resolve the disagreement before measuring anything.")
    return t
