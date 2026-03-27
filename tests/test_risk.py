"""综合风险系数与单调性校验。"""

from __future__ import annotations

import pytest

import app as app_mod
from app import (
    WEIGHT_DRYNESS_LEVEL,
    WEIGHT_VEGETATION_DENSITY,
    calculate_comprehensive_risk,
    clamp01,
    validate_risk_correlation,
)


def test_weights_sum_to_one() -> None:
    assert WEIGHT_VEGETATION_DENSITY + WEIGHT_DRYNESS_LEVEL == pytest.approx(1.0)


def test_clamped_risk_matches_weighted_sum() -> None:
    v, d = 0.66, 0.50
    assert clamp01(calculate_comprehensive_risk(v, d)) == pytest.approx(
        WEIGHT_VEGETATION_DENSITY * v + WEIGHT_DRYNESS_LEVEL * d
    )


def test_monotonic_dryness_fixed_density_066() -> None:
    veg = 0.66
    steps = tuple(i / 10.0 for i in range(1, 10))
    risks = [clamp01(calculate_comprehensive_risk(veg, d)) for d in steps]
    for i in range(len(risks) - 1):
        assert risks[i] < risks[i + 1]
    assert validate_risk_correlation(veg, steps, strict_increasing=True)


def test_validate_helper_default_steps() -> None:
    assert validate_risk_correlation(0.2) is True
    assert validate_risk_correlation(0.66, (0.9, 0.1)) is False


def test_apply_dryness_soft_floor_lower_than_standard(monkeypatch: pytest.MonkeyPatch) -> None:
    """高植被 + 原始干燥很低时：soft 上限应低于 historical standard。"""
    monkeypatch.setattr(app_mod, "LUSH_DAMPEN_ENABLED", False)
    monkeypatch.setattr(app_mod, "DRYNESS_SCALE", 1.0)
    monkeypatch.setattr(app_mod, "DRYNESS_CAP", "")
    js = {"result": []}

    monkeypatch.setattr(app_mod, "DRYNESS_FLOOR_MODE", "soft")
    d_soft = app_mod.apply_dryness_post_processing(0.05, 0.66, understanding_js=js)

    monkeypatch.setattr(app_mod, "DRYNESS_FLOOR_MODE", "standard")
    d_std = app_mod.apply_dryness_post_processing(0.05, 0.66, understanding_js=js)

    assert d_soft < d_std
    assert d_std == pytest.approx(0.503, abs=0.02)


def test_lush_dampen_reduces_dryness(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_mod, "DRYNESS_FLOOR_MODE", "off")
    monkeypatch.setattr(app_mod, "LUSH_DAMPEN_ENABLED", True)
    monkeypatch.setattr(app_mod, "LUSH_DAMPEN_STRENGTH", 0.5)
    monkeypatch.setattr(app_mod, "DRYNESS_SCALE", 1.0)
    monkeypatch.setattr(app_mod, "DRYNESS_CAP", "")

    js = {
        "result": [
            {"keyword": "森林", "root": "自然风景", "score": 0.8},
            {"keyword": "绿色植物", "root": "植被", "score": 0.7},
        ]
    }
    base = 0.55
    adj = app_mod.apply_dryness_post_processing(base, 0.66, understanding_js=js)
    assert adj < base


def test_easydl_branch_only_scale_and_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_mod, "DRYNESS_SCALE", 0.8)
    monkeypatch.setattr(app_mod, "DRYNESS_CAP", "0.3")

    out = app_mod.apply_dryness_post_processing(0.9, 0.66, understanding_js=None)
    assert out == pytest.approx(0.3)
