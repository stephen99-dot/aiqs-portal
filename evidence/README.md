# Evidence layer

A small Python sidecar that harvests real geometry from a PDF, so the takeoff
can be **proven** rather than eyeballed.

## Why it is a separate service

Atlas's drawing tools are `view_pdf_page` and `zoom_region` — both **visual**.
Almost every significant find on record came from vector geometry, colour
layers, pixel tone counts and level ladders instead: a visual read of an
interior elevation was 21% out on a room height; a gridded screenshot read a
block 7.85 m wide against a profiled 12.97 m. The agent cannot measure what it
cannot harvest.

That work is PyMuPDF work. There is no credible Node equivalent — `pdfjs-dist`
can rasterise, but it will not give you the vector primitive census nearly every
one of those findings depends on. So the geometry lives here, behind HTTP, and
the Node app keeps the pricing and the judgement.

## Running it

```bash
cd evidence
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8021
```

The portal finds it via `EVIDENCE_URL` (default `http://127.0.0.1:8021`).

**It is always optional.** If the sidecar is not running, every call resolves to
`{ available: false }` and the portal carries on — but a takeoff made without it
is reported as `visual_only`: *"Measured visually … quantities are estimates, not
proven measurements."* A missing evidence layer must lower the stated confidence
of a takeoff, never break the portal, and never silently substitute a guess for
a measurement.

Both processes need the same uploads volume, since files are passed by path.
`EVIDENCE_ROOT` restricts which paths the service will open.

## What it does

| Endpoint | Purpose |
|---|---|
| `POST /page_inventory` | Per sheet: size in points, `/Rotate`, md5, vector primitive count, extractable text length, embedded images. **Step one on every sheet.** |
| `POST /harvest_layers` | Vector census by `(type, stroke, fill, width)` — what a CAD layer becomes inside a PDF. |
| `POST /prove_scale` | Returns a **proof table**, never a single number. |
| `POST /md5` | File fingerprint. |

### Three things `page_inventory` exists to catch

- **`/Rotate` is step one.** On a rotated page `get_text()` returns media space
  while `get_drawings()` returns display space. Measuring across the two mixes
  coordinate systems silently. `harvest_layers` flattens first.
- **md5 every file.** A pack routinely contains the same sheet twice, and a
  "plain + TENDER watermarked" pair differs by md5 while being the same 26
  sheets, not 52.
- **High primitive count + tiny text = a path-converted sheet**, not a
  drawing-only sheet. Three such sheets on one job held the entire governing
  specification and all three U-value calculations. Never conclude "no figured
  dimensions" or "no spec" from the text layer alone.

### The scale rule

> Prove the scale **twice**, from independent evidence, on every sheet — and
> publish every proof tested, not just the ones that agree.

`prove_scale` returns every proof, their spread, and a verdict:

- **no proof** → *the correct output is no BOQ.* A pack that cannot support a
  measurement should be declined, not estimated.
- **one proof** → provisional until a second, independent proof agrees.
- **proofs agreeing within 0.5%** → settled.
- **scattering up to 5%** → usable for large items, **not safe for small ones**,
  and every quantity carries that band.
- **beyond that** → not a scale, two populations. Resolve before measuring.

### The arrowhead test

The highest-yield discrimination in the whole engine. A CAD export routinely
stops its dimension line short of (or past) the arrowheads, so every measured
dimension is out by a **constant** — invisible in a median, catastrophic in a
bill. One undetected inset was 300 mm on every dimension; an overshoot was
49.9 mm across 30 dimensions on three sheets.

Plot residual against dimension value:

- residual **flat** with length → an arrowhead constant. Remove it and re-fit.
- residual **growing** with length → the scale itself is wrong.

Treat a constant as the **default expectation** on a CAD-exported domestic set,
not a curiosity.

### Half-size reissue

Each ISO step divides every length by √2. A title block reading `1:500 @ A0` on
a page that measures A1 is **1:707** — not 1:500 and not 1:1000. Read as the
stated scale it under-measures by 29%.

## Tests

```bash
cd evidence && python3 -m pytest tests -q
```

20 tests: the arrowhead/scale-error discrimination in both directions, paper
size detection, half-size reissue, the proof-table verdicts, and the inventory
and harvesting behaviours against real generated PDFs.
