"""
test_ade_validation.py -- ADE Model Validation

Validates that our spread estimator correctly implements the normalized
ADE formula from the spec:
  C_ref = C0 / sqrt(4*pi*D/v)
  C_normalized = C_raw / C_ref
  predicted_wqs = C0 * C_normalized

Also tests monotonic decay, stagnant body model, and sqrt(t) scaling.
"""

import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np


def normalized_ade(C0, x, v, D, k=0.0):
    """Expected output of our model: normalized ADE prediction."""
    t = x / v if v > 0 else 1e6
    if t <= 0:
        t = 1

    denom = math.sqrt(4 * math.pi * D * t)
    if denom == 0:
        denom = 1e-10

    exponent = -((x - v * t) ** 2) / (4 * D * t) - k * t
    exponent = max(exponent, -50)
    C_raw = (C0 / denom) * math.exp(exponent)

    ref_t = 1 / v if v > 0 else 1
    ref_denom = math.sqrt(4 * math.pi * D * ref_t)
    C_ref = C0 / ref_denom if ref_denom > 0 else C0

    C_normalized = min(1.0, C_raw / C_ref) if C_ref > 0 else 0
    return C0 * C_normalized


def test_ade_against_expected():
    print("=" * 60)
    print("  ADE Implementation Validation")
    print("=" * 60)

    from analysis.spread_engine import SpreadEstimator

    v = 0.4
    D = 5.0
    k = 2.7e-6
    C0 = 0.5

    distances = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000]

    estimator = SpreadEstimator()
    predictions = estimator._ade_predict(C0, distances, v, D, k)

    print(f"\nParameters: C0={C0}, v={v} m/s, D={D} m^2/s, k={k}")
    print(f"\n{'Distance':>10}  {'Expected':>12}  {'Model':>12}  {'Abs Error':>12}  {'Match':>6}")
    print("-" * 58)

    max_error = 0
    all_match = True
    for pred in predictions:
        x = pred["distance_m"]
        expected = normalized_ade(C0, x, v, D, k)
        actual = pred["predicted_wqs"]
        error = abs(actual - expected)
        match = error < 1e-4
        if not match:
            all_match = False
        max_error = max(max_error, error)
        print(f"{x:>10}m  {expected:>12.6f}  {actual:>12.6f}  {error:>12.6f}  {'OK' if match else 'DIFF':>6}")

    print(f"\nMax absolute error: {max_error:.6f}")
    print(f"TEST 1 {'PASS' if all_match else 'FAIL'}: Model matches expected normalized ADE formula")

    # Test 2: Monotonic decay
    print(f"\n{'-' * 40}")
    print("Test 2: Monotonic downstream decay")
    wqs_values = [p["predicted_wqs"] for p in predictions]
    is_monotonic = all(wqs_values[i] >= wqs_values[i + 1] for i in range(len(wqs_values) - 1))
    print(f"  WQS values: {[round(w, 4) for w in wqs_values]}")
    print(f"  TEST 2 {'PASS' if is_monotonic else 'FAIL'}: WQS {'decreases' if is_monotonic else 'does NOT decrease'} monotonically")

    # Test 3: Boundary behavior
    print(f"\n{'-' * 40}")
    print("Test 3: Attenuation behavior")
    print(f"  Source WQS: {C0}")
    print(f"  At 50m:  {predictions[0]['predicted_wqs']:.4f} ({predictions[0]['predicted_wqs']/C0*100:.1f}% of source)")
    print(f"  At 500m: {predictions[4]['predicted_wqs']:.4f} ({predictions[4]['predicted_wqs']/C0*100:.1f}% of source)")
    print(f"  At 2km:  {predictions[-1]['predicted_wqs']:.4f} ({predictions[-1]['predicted_wqs']/C0*100:.1f}% of source)")
    attenuation_reasonable = predictions[-1]["predicted_wqs"] < C0 * 0.1
    print(f"  TEST 3 {'PASS' if attenuation_reasonable else 'FAIL'}: 2km attenuation > 90%")

    # Test 4: With decay (k > 0 should give faster attenuation)
    print(f"\n{'-' * 40}")
    print("Test 4: Decay parameter effect")
    preds_no_decay = estimator._ade_predict(C0, [500], v, D, k=0.0)
    preds_with_decay = estimator._ade_predict(C0, [500], v, D, k=0.001)
    w_no = preds_no_decay[0]["predicted_wqs"]
    w_with = preds_with_decay[0]["predicted_wqs"]
    decay_works = w_with <= w_no
    print(f"  At 500m without decay: {w_no:.4f}")
    print(f"  At 500m with k=0.001: {w_with:.4f}")
    print(f"  TEST 4 {'PASS' if decay_works else 'FAIL'}: Decay reduces concentration")

    # Test 5: Stagnant water body
    print(f"\n{'-' * 40}")
    print("Test 5: Stagnant water body (2D radial diffusion)")
    stagnant = estimator._stagnant_spread(wqs=0.6, D=10.0)
    print(f"  Model: {stagnant['model']}")
    for p in stagnant["predictions"]:
        print(f"    t={p['time_hours']:>3}h: radius={p['contamination_radius_m']:>8.1f}m, edge_wqs={p['edge_wqs']:.4f} ({p['edge_classification']})")

    radii = [p["contamination_radius_m"] for p in stagnant["predictions"]]
    times = [p["time_hours"] for p in stagnant["predictions"]]
    ratios = [radii[i] / math.sqrt(times[i]) for i in range(len(times))]
    ratio_cv = np.std(ratios) / np.mean(ratios) if np.mean(ratios) > 0 else 0
    print(f"  r/sqrt(t) ratio CV: {ratio_cv:.4f}")
    print(f"  TEST 5 {'PASS' if ratio_cv < 0.01 else 'FAIL'}: Radius scales as sqrt(t)")

    # Summary
    tests = [all_match, is_monotonic, attenuation_reasonable, decay_works, ratio_cv < 0.01]
    print(f"\n{'=' * 40}")
    print(f"  {sum(tests)}/5 tests passed")


if __name__ == "__main__":
    test_ade_against_expected()
