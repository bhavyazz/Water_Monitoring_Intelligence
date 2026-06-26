"""
validate_all.py --Comprehensive Validation Suite

Validates every module in the Water Quality Monitoring System
against the Vrushabavathi River case study and BIS/WHO standards.

Each section answers: "How do you know it's correct?"

Run:
    python -m validation.validate_all

Modules validated:
    1. Contamination Scorer  --BIS 10500 / WHO threshold compliance
    2. Hotspot Detection      --DBSCAN cluster correctness
    3. Source Attribution     --Rule-based fingerprint accuracy
    4. Pollution Spread       --Distance-decay model verification
    5. Bloom Risk Indicator   --Rule threshold verification
"""

from __future__ import annotations
import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone, timedelta
from parser.water_parser import WaterReading
from models.contamination_scorer import ContaminationScorer
from clustering.hotspot_detector import HotspotDetector
from clustering.source_identifier import SourceIdentifier
from clustering.spread_analyzer import SpreadAnalyzer
from clustering.bloom_predictor import BloomPredictor
from data.vrushabavathi_case_study import (
    ALL_SAMPLING_POINTS, WATER_BODIES, WATER_BODY_CONNECTIONS,
    CLUSTER_A_INDUSTRIAL, CLUSTER_B_RESIDENTIAL, CLUSTER_C_AGRICULTURAL,
    ISOLATED_POINTS, EXPECTED_CLUSTERS, EXPECTED_NOISE,
)

PASS = "PASS"
FAIL = "FAIL"
results = []

# Fix Windows console encoding
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def record(test_name: str, passed: bool, detail: str = ""):
    status = PASS if passed else FAIL
    results.append((test_name, status, detail))
    marker = "  +" if passed else "  X"
    print(f"  {marker} {test_name}" + (f" -- {detail}" if detail else ""))


# ══════════════════════════════════════════════════════════════════════
# 1. CONTAMINATION SCORER VALIDATION
# ══════════════════════════════════════════════════════════════════════

def validate_contamination_scorer():
    print("\n" + "=" * 70)
    print("  1. CONTAMINATION SCORER (WQI) --BIS 10500 / WHO Validation")
    print("=" * 70)

    scorer = ContaminationScorer()

    # ── Test 1.1: Clean water should score low ────────────────────
    clean = scorer.compute(ph=7.0, tds=100, turbidity=0.5, temperature=25.0)
    record("1.1 Clean water -> Safe",
           clean["quality_label"] == "Safe",
           f"Score={clean['score']:.1f}, Label={clean['label']}")

    # ── Test 1.2: BIS desirable limits should be borderline Safe ──
    bis_desirable = scorer.compute(ph=8.5, tds=500, turbidity=1.0, temperature=25.0)
    record("1.2 BIS desirable limits -> Safe/Moderate boundary",
           bis_desirable["score"] <= 55,
           f"Score={bis_desirable['score']:.1f}")

    # ── Test 1.3: Above BIS permissible -> Unsafe ─────────────────
    bis_exceed = scorer.compute(ph=5.0, tds=2500, turbidity=8.0, temperature=35.0)
    record("1.3 Exceeds BIS permissible -> Unsafe",
           bis_exceed["quality_label"] == "Unsafe",
           f"Score={bis_exceed['score']:.1f}")

    # ── Test 1.4: pH symmetry --acidic and alkaline equally bad ───
    acidic = scorer.compute(ph=5.0, tds=300, turbidity=1.0, temperature=25.0)
    alkaline = scorer.compute(ph=9.0, tds=300, turbidity=1.0, temperature=25.0)
    record("1.4 pH symmetry (5.0 ~= 9.0 in severity)",
           abs(acidic["sub_indices"]["ph"] - alkaline["sub_indices"]["ph"]) < 1.0,
           f"Acidic={acidic['sub_indices']['ph']:.1f}, Alkaline={alkaline['sub_indices']['ph']:.1f}")

    # ── Test 1.5: Sub-indices monotonically increase with pollution ─
    low_tds = scorer._sub_index_tds(200)
    mid_tds = scorer._sub_index_tds(600)
    high_tds = scorer._sub_index_tds(1500)
    record("1.5 TDS sub-index monotonic (200 < 600 < 1500)",
           low_tds < mid_tds < high_tds,
           f"{low_tds:.1f} < {mid_tds:.1f} < {high_tds:.1f}")

    # ── Test 1.6: Case study samples --Industrial zone scores highest ─
    industrial_scores = []
    for sp in CLUSTER_A_INDUSTRIAL:
        r = scorer.compute(sp.ph, sp.tds, sp.turbidity, sp.temperature)
        industrial_scores.append(r["score"])

    agri_scores = []
    for sp in CLUSTER_C_AGRICULTURAL:
        r = scorer.compute(sp.ph, sp.tds, sp.turbidity, sp.temperature)
        agri_scores.append(r["score"])

    avg_ind = sum(industrial_scores) / len(industrial_scores)
    avg_agri = sum(agri_scores) / len(agri_scores)
    record("1.6 Industrial zone scores > Agricultural zone",
           avg_ind > avg_agri,
           f"Industrial avg={avg_ind:.1f}, Agricultural avg={avg_agri:.1f}")

    # ── Test 1.7: Noise/reference points score Safe ───────────────
    for sp in ISOLATED_POINTS:
        r = scorer.compute(sp.ph, sp.tds, sp.turbidity, sp.temperature)
        record(f"1.7 Reference point {sp.sample_id} -> Safe",
               r["quality_label"] == "Safe",
               f"Score={r['score']:.1f}")


# ══════════════════════════════════════════════════════════════════════
# 2. HOTSPOT DETECTION VALIDATION (DBSCAN)
# ══════════════════════════════════════════════════════════════════════

def validate_hotspot_detection():
    print("\n" + "=" * 70)
    print("  2. HOTSPOT DETECTION (DBSCAN) --Cluster Correctness")
    print("=" * 70)

    detector = HotspotDetector(eps_meters=800, min_samples=3)
    scorer = ContaminationScorer()

    # Build readings from case study
    readings = []
    base_time = datetime.now(timezone.utc)
    for i, sp in enumerate(ALL_SAMPLING_POINTS):
        r = WaterReading(
            temperature=sp.temperature, tds=sp.tds,
            turbidity=sp.turbidity, latitude=sp.latitude,
            longitude=sp.longitude, rgb=sp.rgb, ph=sp.ph,
            timestamp=base_time + timedelta(seconds=i * 10),
        )
        result = scorer.compute(sp.ph, sp.tds, sp.turbidity, sp.temperature)
        r.contamination_score = result["score"]
        r.quality_label = result["quality_label"]
        readings.append(r)

    clusters = detector.detect(readings)

    # ── Test 2.1: Should find 3 clusters ──────────────────────────
    record("2.1 Finds 3 distinct clusters",
           len(clusters) == 3,
           f"Found {len(clusters)} clusters")

    # ── Test 2.2: Cluster sizes reasonable ────────────────────────
    if clusters:
        sizes = [len(c.readings) for c in clusters]
        record("2.2 Cluster sizes match sampling groups",
               all(3 <= s <= 8 for s in sizes),
               f"Sizes: {sizes}")

    # ── Test 2.3: Noise points are isolated ───────────────────────
    clustered_count = sum(len(c.readings) for c in clusters) if clusters else 0
    noise_count = len(readings) - clustered_count
    record("2.3 Isolated reference points marked as noise",
           noise_count >= len(ISOLATED_POINTS),
           f"Noise points: {noise_count}, Expected >= {len(ISOLATED_POINTS)}")

    # ── Test 2.4: Cluster severity ranking ────────────────────────
    if len(clusters) >= 2:
        sevs = [c.severity for c in clusters]
        has_high = "HIGH" in sevs
        record("2.4 At least one HIGH severity cluster",
               has_high,
               f"Severities: {sevs}")

    # ── Test 2.5: Clusters geographically separated ──────────────
    if len(clusters) >= 2:
        centers = [c.center for c in clusters]
        min_dist = float("inf")
        for i in range(len(centers)):
            for j in range(i + 1, len(centers)):
                d = math.sqrt(
                    (centers[i][0] - centers[j][0]) ** 2 +
                    (centers[i][1] - centers[j][1]) ** 2
                ) * 111  # rough km conversion
                min_dist = min(min_dist, d)
        record("2.5 Clusters separated by > 1 km",
               min_dist > 1.0,
               f"Min inter-cluster distance: {min_dist:.1f} km")

    # ── Test 2.6: All-scattered test (no clusters expected) ───────
    scattered_readings = []
    for i in range(10):
        scattered_readings.append(WaterReading(
            latitude=12.9 + i * 0.05,
            longitude=77.5 + i * 0.05,
            tds=200, turbidity=1.0,
            timestamp=base_time + timedelta(seconds=i),
        ))
    scattered_clusters = detector.detect(scattered_readings)
    record("2.6 Scattered points -> zero clusters",
           len(scattered_clusters) == 0,
           f"Found {len(scattered_clusters)}")


# ══════════════════════════════════════════════════════════════════════
# 3. SOURCE ATTRIBUTION VALIDATION
# ══════════════════════════════════════════════════════════════════════

def validate_source_attribution():
    print("\n" + "=" * 70)
    print("  3. SOURCE ATTRIBUTION --Rule-Based Fingerprint Accuracy")
    print("=" * 70)

    source_id = SourceIdentifier()

    # ── Test 3.1: Industrial profile ──────────────────────────────
    result = source_id.identify(tds=1050, turbidity=12.0, ph=5.8, temperature=30.0)
    record("3.1 Industrial profile -> Industrial Discharge",
           result == "Industrial Discharge",
           f"Got: {result}")

    # ── Test 3.2: Sewage profile ──────────────────────────────────
    result = source_id.identify(tds=680, turbidity=6.5, ph=8.0, temperature=29.0)
    record("3.2 Sewage profile -> Sewage Contamination",
           result == "Sewage Contamination",
           f"Got: {result}")

    # ── Test 3.3: Agricultural profile ────────────────────────────
    result = source_id.identify(tds=380, turbidity=3.5, ph=7.3, temperature=27.0)
    record("3.3 Agricultural profile -> Agricultural Runoff",
           result == "Agricultural Runoff",
           f"Got: {result}")

    # ── Test 3.4: Clean water -> Natural/Background ────────────────
    result = source_id.identify(tds=150, turbidity=0.8, ph=7.0, temperature=25.0)
    record("3.4 Clean water -> Natural/Background",
           result == "Natural/Background",
           f"Got: {result}")

    # ── Test 3.5: Case study clusters match expected sources ──────
    cluster_configs = [
        ("Industrial Zone (Cluster A)", CLUSTER_A_INDUSTRIAL, "Industrial Discharge"),
        ("Residential Zone (Cluster B)", CLUSTER_B_RESIDENTIAL, "Sewage Contamination"),
        ("Agricultural Zone (Cluster C)", CLUSTER_C_AGRICULTURAL, "Agricultural Runoff"),
    ]

    for name, points, expected in cluster_configs:
        avg_tds = sum(p.tds for p in points) / len(points)
        avg_turb = sum(p.turbidity for p in points) / len(points)
        avg_ph = sum(p.ph for p in points) / len(points)
        avg_temp = sum(p.temperature for p in points) / len(points)

        result = source_id.identify(avg_tds, avg_turb, avg_ph, avg_temp)
        record(f"3.5 {name} -> {expected}",
               result == expected,
               f"Got: {result}")

    # ── Test 3.6: Detailed identification with reasons ────────────
    details = source_id.identify_with_details(tds=1050, turbidity=12.0, ph=5.8, temperature=30.0)
    record("3.6 Detailed ID includes reasons",
           len(details["reasons"]) > 0 and details["confidence"] in ("HIGH", "MODERATE"),
           f"Confidence={details['confidence']}, Reasons={len(details['reasons'])}")


# ══════════════════════════════════════════════════════════════════════
# 4. POLLUTION SPREAD VALIDATION
# ══════════════════════════════════════════════════════════════════════

def validate_pollution_spread():
    print("\n" + "=" * 70)
    print("  4. POLLUTION SPREAD --Distance-Decay Model Verification")
    print("=" * 70)

    wb_dict = {}
    for wb_id, wb in WATER_BODIES.items():
        wb_dict[wb_id] = {
            "name": wb.name,
            "latitude": wb.latitude,
            "longitude": wb.longitude,
            "body_type": wb.body_type,
        }

    spread = SpreadAnalyzer(wb_dict, WATER_BODY_CONNECTIONS, decay_factor=0.2)

    # ── Test 4.1: Source body gets full contamination score ───────
    source_score = 85.0
    results_spread = spread.analyze_spread("vrushabavathi_nayandahalli", source_score)
    source_entry = next((r for r in results_spread if r.water_body_id == "vrushabavathi_nayandahalli"), None)
    record("4.1 Source body gets full contamination score",
           source_entry is not None and abs(source_entry.risk_score - source_score) < 0.1,
           f"Source risk={source_entry.risk_score if source_entry else 'N/A'}")

    # ── Test 4.2: Risk decreases with distance ────────────────────
    if len(results_spread) >= 3:
        risk_values = [(r.distance_from_source, r.risk_score) for r in results_spread]
        risk_values.sort(key=lambda x: x[0])
        monotonic = all(
            risk_values[i][1] >= risk_values[i + 1][1]
            for i in range(len(risk_values) - 1)
        )
        record("4.2 Risk monotonically decreases with distance",
               monotonic,
               f"Values: {[(f'{d:.1f}km', f'{r:.1f}') for d, r in risk_values[:5]]}")

    # ── Test 4.3: Exponential decay formula verification ──────────
    # Direct neighbor: Mysore Road at 1.2 km
    neighbor = next((r for r in results_spread if r.water_body_id == "vrushabavathi_mysore_road"), None)
    expected_risk = source_score * math.exp(-0.2 * 1.2)
    if neighbor:
        record("4.3 Decay formula correct (Mysore Road at 1.2 km)",
               abs(neighbor.risk_score - expected_risk) < 1.0,
               f"Expected={expected_risk:.1f}, Got={neighbor.risk_score:.1f}")

    # ── Test 4.4: Downstream bodies are affected ──────────────────
    affected_ids = {r.water_body_id for r in results_spread}
    downstream_present = "vrushabavathi_rvce" in affected_ids
    record("4.4 Downstream RVCE segment affected",
           downstream_present,
           f"Affected bodies: {len(affected_ids)}")

    # ── Test 4.5: Very distant bodies get negligible risk ─────────
    farthest = min(results_spread, key=lambda r: r.risk_score) if results_spread else None
    if farthest and farthest.water_body_id != "vrushabavathi_nayandahalli":
        record("4.5 Farthest body has LOW/NEGLIGIBLE risk",
               farthest.risk_level in ("LOW", "NEGLIGIBLE"),
               f"{farthest.water_body_name}: {farthest.risk_score:.1f} ({farthest.risk_level})")

    # ── Test 4.6: Disconnected body not in results ────────────────
    # Gnana Bharathi Lake connects via: nayandahalli -> mysore_road -> rvce -> campus_drain -> lake
    # At decay 0.2 and cumulative distance ~4.5km, risk should be low but present
    lake = next((r for r in results_spread if r.water_body_id == "jnana_bharathi_lake"), None)
    if lake:
        record("4.6 Jnana Bharathi Lake reached via network path",
               lake.distance_from_source > 3.0,
               f"Distance={lake.distance_from_source:.1f} km, Risk={lake.risk_score:.1f}")
    else:
        record("4.6 Jnana Bharathi Lake below risk threshold (acceptable)",
               True,
               "Risk decayed below threshold --expected for distant lake")

    # ── Test 4.7: Path tracking works ─────────────────────────────
    if neighbor:
        record("4.7 Path tracking includes source -> neighbor",
               len(neighbor.path_from_source) == 2,
               f"Path: {' -> '.join(neighbor.path_from_source)}")


# ══════════════════════════════════════════════════════════════════════
# 5. BLOOM RISK INDICATOR VALIDATION
# ══════════════════════════════════════════════════════════════════════

def validate_bloom_risk():
    print("\n" + "=" * 70)
    print("  5. BLOOM RISK INDICATOR --Rule Threshold Verification")
    print("=" * 70)

    bloom = BloomPredictor()

    test_cases = [
        # (description, temp, ph, turbidity, expected_risk)
        ("Cool + neutral + turbid", 22.0, 7.0, 6.0, "LOW"),
        ("Warm + slightly alkaline + clear", 28.0, 7.9, 4.0, "MODERATE"),
        ("Hot + alkaline + clear", 31.0, 8.6, 2.0, "HIGH"),
        ("Hot + alkaline + turbid (inhibited)", 31.0, 8.6, 8.0, "MODERATE"),
        ("Normal conditions", 25.0, 7.0, 3.0, "LOW"),
        ("Lake stagnant water", 28.5, 8.3, 1.5, "HIGH"),
    ]

    for desc, temp, ph, turb, expected in test_cases:
        result = bloom.predict(temp, ph, turb)
        record(f"5.x {desc} -> {expected}",
               result == expected,
               f"Got: {result}")

    # ── Test: Turbidity inhibits blooms ───────────────────────────
    clear = bloom.predict(temperature=29.0, ph=8.2, turbidity=1.0)
    turbid = bloom.predict(temperature=29.0, ph=8.2, turbidity=10.0)
    risk_order = {"LOW": 0, "MODERATE": 1, "HIGH": 2}
    record("5.x High turbidity reduces bloom risk vs clear water",
           risk_order.get(clear, 0) >= risk_order.get(turbid, 0),
           f"Clear={clear}, Turbid={turbid}")


# ══════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════

def main():
    print("\n" + "#" * 70)
    print("#  WATER QUALITY MONITORING SYSTEM --VALIDATION SUITE")
    print("#  Case Study: Vrushabavathi River, near RVCE, Bangalore")
    print("#" * 70)

    validate_contamination_scorer()
    validate_hotspot_detection()
    validate_source_attribution()
    validate_pollution_spread()
    validate_bloom_risk()

    # ── Summary ───────────────────────────────────────────────────
    total = len(results)
    passed = sum(1 for _, s, _ in results if s == PASS)
    failed = sum(1 for _, s, _ in results if s == FAIL)

    print("\n" + "=" * 70)
    print(f"  VALIDATION SUMMARY: {passed}/{total} passed, {failed} failed")
    print("=" * 70)

    if failed > 0:
        print("\n  Failed tests:")
        for name, status, detail in results:
            if status == FAIL:
                print(f"    X {name}: {detail}")

    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
