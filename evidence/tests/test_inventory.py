import sys, os, pymupdf, pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from inventory import page_inventory, harvest_layers, file_md5


def _sheet(tmp_path, rotation=0, text="", n_lines=60, n_rects=20):
    doc = pymupdf.open()
    p = doc.new_page(width=1684, height=2384)  # A1
    sh = p.new_shape()
    for i in range(n_lines):
        sh.draw_line(pymupdf.Point(100, 100 + i * 10), pymupdf.Point(900, 100 + i * 10))
    sh.finish(color=(0.5, 0.5, 0.5), width=0.5)          # grey STROKE, no fill
    sh.commit()
    sh2 = p.new_shape()
    for i in range(n_rects):
        sh2.draw_rect(pymupdf.Rect(1000, 100 + i * 20, 1300, 110 + i * 20))
    sh2.finish(color=(0.5, 0.5, 0.5), fill=(0.5, 0.5, 0.5), width=0.5)  # grey FILL
    sh2.commit()
    if text:
        p.insert_text(pymupdf.Point(120, 60), text, fontsize=11)
    if rotation:
        p.set_rotation(rotation)
    out = str(tmp_path / f"sheet_{rotation}_{n_lines}.pdf")
    doc.save(out)
    doc.close()
    return out


def test_inventory_reports_size_rotation_and_md5(tmp_path):
    path = _sheet(tmp_path)
    inv = page_inventory(path)
    assert len(inv["md5"]) == 32
    assert inv["md5"] == file_md5(path)
    pg = inv["pages"][0]
    assert round(pg["width_pt"]) == 1684 and round(pg["height_pt"]) == 2384
    assert pg["rotation"] == 0
    assert pg["primitives"] > 0


def test_rotation_is_flagged_as_step_one(tmp_path):
    inv = page_inventory(_sheet(tmp_path, rotation=90))
    pg = inv["pages"][0]
    assert pg["rotation"] == 90
    assert any("/Rotate" in n for n in pg["notes"])
    assert any("media space" in n for n in pg["notes"])


def test_path_converted_sheet_is_not_mistaken_for_drawing_only(tmp_path):
    # Many primitives, no extractable text — the sheet whose spec is drawn.
    inv = page_inventory(_sheet(tmp_path, n_lines=600, n_rects=200))
    pg = inv["pages"][0]
    assert pg["path_converted"] is True
    assert any("PATH-CONVERTED" in n for n in pg["notes"])
    assert any("never conclude" in n.lower() for n in pg["notes"])


def test_a_sheet_with_real_text_is_not_path_converted(tmp_path):
    inv = page_inventory(_sheet(tmp_path, text="X" * 400, n_lines=600))
    assert inv["pages"][0]["path_converted"] is False


def test_identical_sheets_share_an_md5(tmp_path):
    # A pack routinely contains the same sheet twice.
    a = _sheet(tmp_path / "a" if False else tmp_path, n_lines=30)
    import shutil
    b = str(tmp_path / "copy.pdf")
    shutil.copyfile(a, b)
    assert file_md5(a) == file_md5(b)


def test_harvest_separates_a_grey_stroke_from_a_grey_fill(tmp_path):
    # Two greys usually exist and only one means demolish: retained walls as a
    # grey FILL, demolition as a grey STROKE with no fill.
    h = harvest_layers(_sheet(tmp_path))
    strokes = [c for c in h["clusters"] if c["fill"] == "None"]
    fills = [c for c in h["clusters"] if c["fill"] != "None"]
    assert strokes and fills, "the two greys must not be merged into one cluster"
    assert strokes[0]["total_length_pt"] > 0


def test_every_cluster_starts_unnamed(tmp_path):
    h = harvest_layers(_sheet(tmp_path))
    assert h["unnamed"] == len(h["clusters"])
    assert all(c["named"] is False for c in h["clusters"])
    assert "cannot name" in h["rule"]


def test_harvest_flattens_a_rotated_page(tmp_path):
    # Must not throw, and must still cluster, once rotation is removed.
    h = harvest_layers(_sheet(tmp_path, rotation=270))
    assert len(h["clusters"]) >= 2
