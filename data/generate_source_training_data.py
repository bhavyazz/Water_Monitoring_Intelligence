"""
generate_source_training_data.py — Synthetic Source Training Data

Generates 500 samples per source type with realistic parameter distributions
(Gaussian around profile centers). Validates that chemical distance scoring
correctly classifies >85% on held-out 20%.
"""

import numpy as np
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analysis.source_engine import SourceIdentifier, SOURCE_PROFILES


def generate_samples(n_per_source=500, seed=42):
    rng = np.random.default_rng(seed)
    samples = []

    for key, profile in SOURCE_PROFILES.items():
        for _ in range(n_per_source):
            tds = rng.normal(profile["tds_center"], profile["tds_std"])
            turbidity = max(0.1, rng.normal(profile["turbidity_center"], profile["turbidity_std"]))
            ph = rng.normal(profile["ph_center"], profile["ph_std"])
            ph = max(2.0, min(14.0, ph))
            tds = max(0, tds)
            samples.append({
                "tds": round(tds, 1),
                "turbidity": round(turbidity, 1),
                "ph": round(ph, 2),
                "true_source": profile["label"],
                "true_key": key,
            })

    return samples


def validate(samples, test_fraction=0.20, seed=42):
    rng = np.random.default_rng(seed)
    indices = rng.permutation(len(samples))
    split = int(len(samples) * (1 - test_fraction))
    test_indices = indices[split:]

    identifier = SourceIdentifier()
    correct = 0
    total = 0
    confusion = {}

    for idx in test_indices:
        s = samples[idx]
        result = identifier.identify(
            tds=s["tds"], turbidity=s["turbidity"], ph=s["ph"], skip_osm=True,
        )
        predicted = result["source"]
        actual = s["true_source"]

        confusion.setdefault(actual, {})
        confusion[actual][predicted] = confusion[actual].get(predicted, 0) + 1

        if predicted == actual:
            correct += 1
        total += 1

    accuracy = correct / total if total > 0 else 0
    return accuracy, confusion, total


def main():
    print("Generating synthetic source training data...")
    samples = generate_samples(n_per_source=500)
    print(f"Generated {len(samples)} samples ({len(samples) // 4} per source type)")

    print("\nValidating chemical-only classification on held-out 20%...")
    accuracy, confusion, total = validate(samples)

    print(f"\nAccuracy: {accuracy:.1%} ({int(accuracy * total)}/{total})")
    print(f"Target: >85%  {'PASS' if accuracy > 0.85 else 'FAIL'}")

    print("\nConfusion Matrix:")
    all_labels = sorted(set(s["true_source"] for s in samples))
    header = f"{'Actual':<25}" + "".join(f"{l[:15]:<16}" for l in all_labels)
    print(header)
    print("-" * len(header))
    for actual in all_labels:
        row = f"{actual:<25}"
        for predicted in all_labels:
            count = confusion.get(actual, {}).get(predicted, 0)
            row += f"{count:<16}"
        print(row)


if __name__ == "__main__":
    main()
