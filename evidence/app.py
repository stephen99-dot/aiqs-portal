"""
app.py — the evidence sidecar (brief §3, §4).

A small HTTP service so the Node portal can harvest real geometry from a PDF.
It exists because the agent's tools were VISUAL — view_pdf_page and zoom_region —
and almost every significant finding on record came from vector geometry, colour
layers, pixel tone counts and level ladders. The agent cannot measure what it
cannot harvest.

Deliberately stateless and deterministic: same file in, same numbers out. It
never prices anything and never decides anything — it returns evidence, and the
QS passes in the Node app decide what that evidence means.

Run:  uvicorn app:app --host 127.0.0.1 --port 8021
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from inventory import page_inventory, harvest_layers, file_md5
from scale import (
    classify_residuals, detect_paper_size, check_half_size_reissue,
    build_proof_table, Proof,
)

app = FastAPI(title="AI QS evidence layer", version="1.0")

# Files are read from disk by path; the Node app and the sidecar share the
# uploads volume. Restricting to a root stops a path from reaching elsewhere.
ALLOWED_ROOT = os.environ.get("EVIDENCE_ROOT", "/")


def _check_path(path: str) -> str:
    real = os.path.realpath(path)
    root = os.path.realpath(ALLOWED_ROOT)
    if not real.startswith(root):
        raise HTTPException(status_code=400, detail="path outside the permitted root")
    if not os.path.isfile(real):
        raise HTTPException(status_code=404, detail="file not found")
    return real


class PathIn(BaseModel):
    path: str


class HarvestIn(PathIn):
    page: int = 0
    min_cluster: int = Field(default=1, ge=1)


class ScaleIn(BaseModel):
    """
    Dimensions read off the sheet: (stated_mm, measured_mm) pairs, plus whatever
    independent proofs were obtained. Two proofs is the minimum.
    """
    dimensions: list[tuple[float, float]] = []
    proofs: list[dict[str, Any]] = []
    stated_scale: str | None = None
    stated_paper: str | None = None
    page_width_pt: float | None = None
    page_height_pt: float | None = None


@app.get("/health")
def health():
    return {"ok": True, "service": "evidence"}


@app.post("/page_inventory")
def api_page_inventory(body: PathIn):
    return page_inventory(_check_path(body.path))


@app.post("/harvest_layers")
def api_harvest_layers(body: HarvestIn):
    return harvest_layers(_check_path(body.path), body.page, body.min_cluster)


@app.post("/md5")
def api_md5(body: PathIn):
    return {"md5": file_md5(_check_path(body.path))}


@app.post("/prove_scale")
def api_prove_scale(body: ScaleIn):
    """
    Returns a PROOF TABLE, never a single number, and publishes every proof
    tested rather than only the ones that agree.
    """
    residuals = classify_residuals(body.dimensions) if body.dimensions else {"diagnosis": "insufficient"}

    actual_paper = None
    if body.page_width_pt and body.page_height_pt:
        actual_paper = detect_paper_size(body.page_width_pt, body.page_height_pt)
    half = check_half_size_reissue(body.stated_paper, actual_paper)

    proofs = [
        Proof(
            source=p.get("source", "unnamed"),
            mm_per_pt=float(p.get("mm_per_pt", 0)),
            samples=int(p.get("samples", 0)),
            spread_pct=float(p.get("spread_pct", 0)),
            note=p.get("note", ""),
        )
        for p in body.proofs
    ]

    constant = residuals.get("constant_mm") if residuals.get("diagnosis") == "arrowhead_constant" else None
    table = build_proof_table(
        proofs, stated_scale=body.stated_scale, paper_size=actual_paper,
        arrowhead_constant_mm=constant, half_size=half,
    )
    out = table.to_dict()
    out["residual_analysis"] = residuals
    return out
