"""
test_hotspot_injection.py — Hotspot Detection Validation

Injects known polluted and clean readings, verifies:
1. Injected polluted cluster detected as CONFIRMED_HOTSPOT
2. Isolated severe reading classified as SEVERE_ANOMALY not HOTSPOT
3. Clean readings not flagged as hotspots
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analysis.wqs_engine import WQSEngine
from analysis.hotspot_engine import HotspotEngine


def make_sample(id, lat, lon, tds, turbidity, ph, temperature):
    wqs = WQSEngine()
    result = wqs.compute(tds=tds, turbidity=turbidity, ph=ph, temperature=temperature)
    return {
        "id": id,
        "label": f"Test {id}",
        "lat": lat,
        "lon": lon,
        "tds": tds,
        "turbidity": turbidity,
        "ph": ph,
        "temperature": temperature,
        "wqs": result["wqs"],
        "classification": result["classification"],
        "parameter_scores": result["parameter_scores"],
    }


def test_hotspot_detection():
    print("=" * 60)
    print("  Hotspot Detection Injection Test")
    print("=" * 60)

    # Injected polluted cluster: 4 readings within 300m, all with WQS > 0.40
    polluted_cluster = [
        make_sample("INJ-01", 12.9200, 77.5000, tds=850, turbidity=15, ph=5.5, temperature=30),
        make_sample("INJ-02", 12.9202, 77.5002, tds=780, turbidity=12, ph=5.8, temperature=29),
        make_sample("INJ-03", 12.9198, 77.4998, tds=900, turbidity=18, ph=5.3, temperature=31),
        make_sample("INJ-04", 12.9201, 77.5001, tds=820, turbidity=14, ph=5.6, temperature=30),
    ]

    # Isolated severe reading (far from cluster)
    isolated_severe = [
        make_sample("INJ-05", 12.9500, 77.5200, tds=1200, turbidity=40, ph=4.5, temperature=35),
    ]

    # Clean readings scattered elsewhere
    clean_readings = [
        make_sample(f"CLN-{i:02d}", 12.930 + i * 0.002, 77.490 + i * 0.002,
                    tds=200 + i * 20, turbidity=0.5 + i * 0.1, ph=7.0 + i * 0.05, temperature=26)
        for i in range(8)
    ]

    all_samples = polluted_cluster + isolated_severe + clean_readings

    print(f"\nInjected {len(polluted_cluster)} polluted readings (cluster)")
    print(f"Injected {len(isolated_severe)} isolated severe reading")
    print(f"Injected {len(clean_readings)} clean readings")
    print(f"Total: {len(all_samples)} samples")

    for s in all_samples:
        print(f"  {s['id']:<10} WQS={s['wqs']:.3f}  {s['classification']:<20} ({s['lat']:.4f}, {s['lon']:.4f})")

    engine = HotspotEngine(eps_meters=400, min_samples=2)
    result = engine.detect_batch(all_samples)

    hotspots = result["hotspots"]
    anomalies = result["anomalies"]
    clean_clusters = result["clean_clusters"]

    print(f"\n{'-' * 40}")
    print(f"Results:")
    print(f"  Hotspots:       {len(hotspots)}")
    print(f"  Anomalies:      {len(anomalies)}")
    print(f"  Clean clusters: {len(clean_clusters)}")

    # Test 1: Injected polluted cluster detected
    injected_ids = set(s["id"] for s in polluted_cluster)
    found_hotspot = False
    for h in hotspots:
        members = set(h.get("member_ids", []))
        overlap = injected_ids & members
        if len(overlap) >= 2:
            found_hotspot = True
            print(f"\n  TEST 1 PASS: Injected cluster detected as CONFIRMED_HOTSPOT")
            print(f"    Members: {members}")
            print(f"    Mean WQS: {h['mean_wqs']:.3f}")
            break

    if not found_hotspot:
        print(f"\n  TEST 1 FAIL: Injected polluted cluster NOT detected as hotspot")

    # Test 2: Isolated severe reading classified as anomaly, not hotspot
    isolated_id = isolated_severe[0]["id"]
    found_anomaly = False
    for a in anomalies:
        if isolated_id in a.get("member_ids", []):
            found_anomaly = True
            cls = a.get("classification", "")
            if cls in ("SEVERE_ANOMALY", "MODERATE_ANOMALY"):
                print(f"  TEST 2 PASS: Isolated severe reading classified as {cls}")
            else:
                print(f"  TEST 2 FAIL: Isolated reading classified as {cls} instead of ANOMALY")
            break

    if not found_anomaly:
        # Check if it's in a hotspot (would be wrong)
        for h in hotspots:
            if isolated_id in h.get("member_ids", []):
                print(f"  TEST 2 FAIL: Isolated reading incorrectly included in a hotspot")
                break
        else:
            print(f"  TEST 2 INFO: Isolated reading not found in any category")

    # Test 3: Clean readings not in any hotspot
    clean_ids = set(s["id"] for s in clean_readings)
    clean_in_hotspot = False
    for h in hotspots:
        members = set(h.get("member_ids", []))
        if clean_ids & members:
            clean_in_hotspot = True
            print(f"  TEST 3 FAIL: Clean readings found in hotspot: {clean_ids & members}")
            break

    if not clean_in_hotspot:
        print(f"  TEST 3 PASS: No clean readings classified as hotspots")

    # Summary
    tests_passed = sum([found_hotspot, found_anomaly and cls in ("SEVERE_ANOMALY", "MODERATE_ANOMALY"), not clean_in_hotspot])
    print(f"\n{'-' * 40}")
    print(f"  {tests_passed}/3 tests passed")


if __name__ == "__main__":
    test_hotspot_detection()
