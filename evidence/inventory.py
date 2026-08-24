"""
inventory.py — page_inventory and vector harvesting (brief §3.1, §3.2).

Step one on every sheet, before any measurement:

  /ROTATE IS STEP ONE. On a rotated page get_text() returns MEDIA space while
  get_drawings() returns DISPLAY space. Measuring across the two without
  flattening silently mixes coordinate systems. remove_rotation() re-saves flat.

  MD5 EVERY FILE. Packs routinely contain the same sheet twice, and a "plain +
  TENDER watermarked" pair differs by md5 while being the same 26 sheets, not 52.

  HIGH PRIMITIVE COUNT + TINY TEXT = A PATH-CONVERTED SHEET, not a drawing-only
  sheet. Three such sheets on one job held the entire governing specification
  and all three U-value calculations. Never conclude "no figured dimensions" or
  "no spec" from the text layer alone.
"""
from __future__ import annotations

import hashlib
from collections import Counter

import pymupdf  # PyMuPDF

# Below this much extractable text, with plenty of vector primitives, the page
# is almost certainly path-converted: its words are drawn, not encoded.
PATH_CONVERTED_TEXT_LIMIT = 200
PATH_CONVERTED_PRIMITIVE_FLOOR = 500


def file_md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _colour_key(value):
    """PyMuPDF gives colours as float tuples; round so near-identical layers group."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return round(float(value), 3)
    return tuple(round(float(c), 3) for c in value)


def page_inventory(path: str) -> dict:
    """Per-sheet inventory. Cheap, and it decides how every later tool behaves."""
    doc = pymupdf.open(path)
    pages = []
    for i, page in enumerate(doc):
        rect = page.rect
        try:
            drawings = page.get_drawings()
        except Exception:
            drawings = []
        try:
            text = page.get_text() or ""
        except Exception:
            text = ""

        images = []
        try:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    info = doc.extract_image(xref)
                    images.append({
                        "xref": xref,
                        "width": info.get("width"),
                        "height": info.get("height"),
                        "ext": info.get("ext"),
                    })
                except Exception:
                    pass
        except Exception:
            pass

        primitives = sum(len(d.get("items", [])) for d in drawings)
        text_len = len(text.strip())
        path_converted = (primitives >= PATH_CONVERTED_PRIMITIVE_FLOOR
                          and text_len < PATH_CONVERTED_TEXT_LIMIT)

        notes = []
        if page.rotation:
            notes.append(
                f"/Rotate is {page.rotation}. get_text() returns media space while get_drawings() "
                "returns display space — flatten with remove_rotation() before any vector measurement."
            )
        if path_converted:
            notes.append(
                f"{primitives} vector primitives against {text_len} characters of extractable text: this "
                "is a PATH-CONVERTED sheet, not a drawing-only sheet. Its dimensions and specification are "
                "drawn as paths. Never conclude 'no figured dimensions' or 'no spec' from the text layer."
            )

        pages.append({
            "index": i,
            "width_pt": round(rect.width, 2),
            "height_pt": round(rect.height, 2),
            "rotation": page.rotation,
            "primitives": primitives,
            "drawing_groups": len(drawings),
            "text_length": text_len,
            "images": images,
            "path_converted": path_converted,
            "notes": notes,
        })

    result = {
        "md5": file_md5(path),
        "page_count": len(pages),
        "pages": pages,
    }
    doc.close()
    return result


def harvest_layers(path: str, page_index: int = 0, min_cluster: int = 1) -> dict:
    """
    Census every vector item by the tuple (type, stroke colour, fill colour, width),
    which is what a CAD layer becomes once it is in a PDF.

    Demolition layers have their own exact colour; harvesting them beats eyeballing
    (a visual 4.0 m estimate measured 8-10 m once clustered). Two greys usually
    exist and only one means demolish — retained walls as a grey FILL, demolition
    as a grey STROKE with no fill. The same colour is also used for two different
    things on one sheet, so a cluster must be RENDERED before it is believed.

    HARD RULE, enforced by the caller: never issue with a harvested cluster you
    cannot name. A cluster logged as "curvy lines in the middle, resolve later"
    was the wayleave corridor of a live overhead 33 kV line.
    """
    doc = pymupdf.open(path)
    page = doc[page_index]
    if page.rotation:
        page.remove_rotation()

    counts = Counter()
    lengths = {}
    for d in page.get_drawings():
        stroke = _colour_key(d.get("color"))
        fill = _colour_key(d.get("fill"))
        width = round(float(d.get("width") or 0), 3)
        for item in d.get("items", []):
            kind = item[0]  # 'l' line, 're' rect, 'c' curve, 'qu' quad
            key = (kind, str(stroke), str(fill), width)
            counts[key] += 1
            if kind == "l" and len(item) >= 3:
                p1, p2 = item[1], item[2]
                try:
                    lengths[key] = lengths.get(key, 0.0) + abs(p2 - p1)
                except Exception:
                    pass

    clusters = []
    for (kind, stroke, fill, width), n in counts.most_common():
        if n < min_cluster:
            continue
        clusters.append({
            "type": kind, "stroke": stroke, "fill": fill, "width": width,
            "count": n,
            "total_length_pt": round(lengths.get((kind, stroke, fill, width), 0.0), 2),
            "named": False,   # the caller must name it before it can be priced
        })

    doc.close()
    return {
        "page": page_index,
        "clusters": clusters,
        "unnamed": len(clusters),
        "rule": ("Never issue with a harvested cluster you cannot name. Render the largest clusters and "
                 "name each one before pricing — the same colour is routinely used for two different things "
                 "on one sheet, and a stroke-only grey is demolition where a filled grey is retained."),
    }
