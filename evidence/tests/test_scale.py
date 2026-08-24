import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from scale import (classify_residuals, detect_paper_size, check_half_size_reissue,
                   build_proof_table, Proof)


def test_arrowhead_constant_is_flat_against_length():
    # 49.9 mm overshoot on 30 dimensions across three sheets — a real case.
    pairs = [(1000, 1049.9), (2500, 2549.9), (4000, 4049.9), (6000, 6049.9), (8500, 8549.9)]
    r = classify_residuals(pairs)
    assert r["diagnosis"] == "arrowhead_constant"
    assert abs(r["constant_mm"] - 49.9) < 0.1
    assert "overshoot" in r["note"]


def test_arrowhead_inset_reads_short():
    pairs = [(1000, 700), (2500, 2200), (4000, 3700), (6000, 5700)]
    r = classify_residuals(pairs)
    assert r["diagnosis"] == "arrowhead_constant"
    assert r["constant_mm"] < 0
    assert "inset" in r["note"]


def test_scale_error_grows_with_length():
    pairs = [(1000, 1040), (2500, 2600), (4000, 4160), (6000, 6240)]
    r = classify_residuals(pairs)
    assert r["diagnosis"] == "scale_error"
    assert abs(r["slope"] - 0.04) < 0.005


def test_clean_set_is_neither():
    pairs = [(1000, 1000.2), (2500, 2499.8), (4000, 4000.1), (6000, 5999.9)]
    assert classify_residuals(pairs)["diagnosis"] == "clean"


def test_too_few_dimensions_refuses_to_guess():
    assert classify_residuals([(1000, 1050), (2000, 2050)])["diagnosis"] == "insufficient"


def test_paper_size_is_orientation_independent():
    assert detect_paper_size(1684, 2384) == "A1"
    assert detect_paper_size(2384, 1684) == "A1"
    assert detect_paper_size(500, 500) is None


def test_half_size_reissue_is_root_two_not_a_doubling():
    r = check_half_size_reissue("A0", "A1")
    assert r["half_size"] is True
    assert abs(r["factor"] - 1.41421) < 0.001
    assert "not the stated value and not a round doubling" in r["note"]
    # Two steps down, A0 stated on an A2 page.
    assert abs(check_half_size_reissue("A0", "A2")["factor"] - 2.0) < 0.001
    assert check_half_size_reissue("A1", "A1")["half_size"] is False


def test_no_proof_means_no_boq():
    t = build_proof_table([])
    assert t.usable is False
    assert "no BOQ" in t.verdict


def test_one_proof_is_not_enough():
    t = build_proof_table([Proof("figured dimensions", 0.49, 6, 0.1)])
    assert t.usable is False
    assert "ONE PROOF ONLY" in t.verdict


def test_two_agreeing_proofs_settle_the_scale():
    t = build_proof_table([
        Proof("figured dimensions", 0.4900, 6, 0.1),
        Proof("level datums", 0.4902, 4, 0.2),
    ])
    assert t.usable is True
    assert "settled" in t.verdict


def test_scattered_proofs_are_usable_only_for_big_items():
    t = build_proof_table([
        Proof("figured dimensions", 0.49, 6, 0.1),
        Proof("door swing radii", 0.50, 12, 0.4),
    ])
    assert t.usable is True
    assert "NOT safe for small ones" in t.verdict
    assert any("median" in w for w in t.warnings)


def test_wildly_disagreeing_proofs_are_two_populations():
    t = build_proof_table([
        Proof("figured dimensions", 0.49, 6, 0.1),
        Proof("scale bar", 0.70, 2, 1.0),
    ])
    assert t.usable is False
    assert "two populations" in t.verdict
