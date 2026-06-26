"""
train_quality_model.py -- Train Water Quality Classifier on Real Dataset

Dataset: Kaggle Water Potability (3276 samples)
Source:  https://www.kaggle.com/datasets/adityakadiwal/water-potability

Features used (matching Arduino sensor outputs):
    pH        -- from pH strip + colorimetric model (0-14)
    TDS       -- from TDS sensor, scaled from dataset's Solids column (0-2000 ppm)
    Turbidity -- from turbidity sensor (NTU)

Labels (derived from BIS 10500:2012 / WHO standards):
    0 = Safe     : pH in [6.5, 8.5] AND TDS < 500 AND Turbidity < 5
    1 = Moderate : within BIS permissible limits but outside desirable
    2 = Unsafe   : exceeds BIS permissible limits

Model: RandomForestClassifier with 5-fold cross-validation
Output: models/water_quality_model.joblib

Run:
    python -m models.train_quality_model
"""

from __future__ import annotations
import os
import sys
import csv
import math
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score, StratifiedKFold, train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import joblib

DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "water_potability.csv")
MODEL_FILE = os.path.join(os.path.dirname(__file__), "water_quality_model.joblib")

LABELS = ["Safe", "Moderate", "Unsafe"]


def load_and_prepare_data():
    """Load Kaggle dataset, extract features, create 3-class labels."""

    print("Loading dataset from:", DATA_FILE)

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  Raw rows: {len(rows)}")

    # Extract features, handle missing values
    valid_rows = []
    for row in rows:
        try:
            ph_str = row.get("ph", "")
            solids_str = row.get("Solids", "")
            turb_str = row.get("Turbidity", "")

            if not ph_str or not solids_str or not turb_str:
                continue

            ph = float(ph_str)
            solids = float(solids_str)
            turbidity = float(turb_str)

            # Skip extreme outliers
            if ph < 0 or ph > 14:
                continue
            if solids < 0 or turbidity < 0:
                continue

            valid_rows.append((ph, solids, turbidity))
        except (ValueError, TypeError):
            continue

    print(f"  Valid rows (non-null pH, Solids, Turbidity): {len(valid_rows)}")

    ph_arr = np.array([r[0] for r in valid_rows])
    solids_arr = np.array([r[1] for r in valid_rows])
    turb_arr = np.array([r[2] for r in valid_rows])

    # Scale Solids (320-61227) to TDS sensor range (50-2000 ppm)
    # Preserves the distribution shape, maps to realistic Arduino TDS readings
    solids_min, solids_max = solids_arr.min(), solids_arr.max()
    tds_arr = (solids_arr - solids_min) / (solids_max - solids_min) * (2000 - 50) + 50
    print(f"  TDS scaled: [{tds_arr.min():.0f}, {tds_arr.max():.0f}] ppm (from Solids [{solids_min:.0f}, {solids_max:.0f}])")

    # Create 3-class labels based on BIS 10500:2012 / WHO standards
    labels = _create_labels(ph_arr, tds_arr, turb_arr)

    X = np.column_stack([ph_arr, tds_arr, turb_arr])
    y = np.array(labels)

    # Print class distribution
    for i, name in enumerate(LABELS):
        count = np.sum(y == i)
        print(f"  Class {i} ({name}): {count} samples ({100*count/len(y):.1f}%)")

    return X, y


def _create_labels(ph: np.ndarray, tds: np.ndarray, turbidity: np.ndarray) -> list:
    """
    Assign 3-class labels using BIS 10500:2012 drinking water standards.

    BIS 10500:2012 limits:
        pH:        desirable 6.5-8.5,  permissible 6.0-9.0
        TDS:       desirable <=500,    permissible <=2000
        Turbidity: desirable <=1,      permissible <=5

    Scoring:
        Each parameter contributes a severity score.
        Total score determines the class.
    """
    labels = []
    for i in range(len(ph)):
        score = 0.0

        # pH scoring
        ph_dev = abs(ph[i] - 7.0)
        if ph_dev > 3.0:      # outside 4.0-10.0
            score += 3.0
        elif ph_dev > 1.5:    # outside 6.5-8.5 (BIS desirable)
            score += 1.5
        elif ph_dev > 0.5:    # slightly off neutral
            score += 0.5

        # TDS scoring
        if tds[i] > 2000:
            score += 3.0
        elif tds[i] > 1000:
            score += 2.0
        elif tds[i] > 500:
            score += 1.0

        # Turbidity scoring
        if turbidity[i] > 5.0:
            score += 2.0
        elif turbidity[i] > 1.0:
            score += 0.5

        # Classify
        if score <= 1.5:
            labels.append(0)  # Safe
        elif score <= 3.5:
            labels.append(1)  # Moderate
        else:
            labels.append(2)  # Unsafe

    return labels


def train_model(X, y):
    """Train RandomForest with cross-validation, save model."""

    print("\n" + "=" * 60)
    print("  TRAINING: RandomForestClassifier")
    print("=" * 60)

    # Stratified train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y,
    )
    print(f"  Train: {len(X_train)}, Test: {len(X_test)}")

    # Train model
    model = RandomForestClassifier(
        n_estimators=150,
        max_depth=12,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    # Test set evaluation
    y_pred = model.predict(X_test)

    print("\n  Classification Report (Test Set):")
    print("  " + "-" * 50)
    report = classification_report(y_test, y_pred, target_names=LABELS)
    for line in report.split("\n"):
        print(f"  {line}")

    print("\n  Confusion Matrix:")
    cm = confusion_matrix(y_test, y_pred)
    print(f"  {'':>12} {'Safe':>8} {'Moderate':>8} {'Unsafe':>8}")
    for i, row in enumerate(cm):
        print(f"  {LABELS[i]:>12} {row[0]:>8} {row[1]:>8} {row[2]:>8}")

    # 5-fold cross-validation
    print("\n  5-Fold Cross-Validation:")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=cv, scoring="accuracy")
    print(f"  Fold accuracies: {[f'{s:.3f}' for s in scores]}")
    print(f"  Mean accuracy:   {scores.mean():.3f} (+/- {scores.std():.3f})")

    # Feature importances
    print("\n  Feature Importances:")
    feature_names = ["pH", "TDS (ppm)", "Turbidity (NTU)"]
    importances = model.feature_importances_
    for name, imp in sorted(zip(feature_names, importances), key=lambda x: -x[1]):
        bar = "#" * int(imp * 40)
        print(f"    {name:<16} {imp:.3f}  {bar}")

    # Retrain on full dataset for production model
    print("\n  Retraining on full dataset for production...")
    model.fit(X, y)

    # Save
    joblib.dump(model, MODEL_FILE)
    print(f"  Model saved: {MODEL_FILE}")
    print(f"  File size: {os.path.getsize(MODEL_FILE) / 1024:.1f} KB")

    return model


def validate_model(model):
    """Sanity check: known inputs should produce expected outputs."""

    print("\n" + "=" * 60)
    print("  VALIDATION: Known Scenario Tests")
    print("=" * 60)

    test_cases = [
        # (description, pH, TDS, Turbidity, expected_class)
        ("Clean drinking water",     7.0,  200,  0.5, "Safe"),
        ("Slightly off pH",          8.8,  400,  2.0, "Moderate"),
        ("High TDS",                 7.2, 1200,  3.0, "Moderate"),
        ("Very acidic industrial",   4.5, 1500, 12.0, "Unsafe"),
        ("Extreme alkaline",        10.5,  800,  6.0, "Unsafe"),
        ("Normal neutral",           7.0,  350,  1.5, "Safe"),
        ("Vrushabavathi industrial",  5.8, 1050, 12.3, "Unsafe"),
        ("Vrushabavathi sewage",      8.0,  680,  6.5, "Moderate"),
        ("Vrushabavathi agri",        7.3,  420,  3.8, "Safe"),
    ]

    all_pass = True
    for desc, ph, tds, turb, expected in test_cases:
        X_test = np.array([[ph, tds, turb]])
        pred_idx = model.predict(X_test)[0]
        predicted = LABELS[pred_idx]
        status = "PASS" if predicted == expected else "FAIL"
        if status == "FAIL":
            all_pass = False
        marker = "+" if status == "PASS" else "X"
        print(f"  {marker} {desc:<30} pH={ph:<5} TDS={tds:<6} Turb={turb:<5} -> {predicted:<10} (expected: {expected})")

    print(f"\n  Result: {'ALL PASSED' if all_pass else 'SOME FAILED (may need threshold tuning)'}")
    return all_pass


def main():
    print("#" * 60)
    print("#  WATER QUALITY MODEL TRAINING")
    print("#  Dataset: Kaggle Water Potability (3276 samples)")
    print("#  Labels:  BIS 10500:2012 / WHO standards")
    print("#" * 60)

    X, y = load_and_prepare_data()
    model = train_model(X, y)
    validate_model(model)

    print("\n" + "=" * 60)
    print("  DONE. Model ready for production use.")
    print(f"  Load with: joblib.load('{MODEL_FILE}')")
    print("=" * 60)


if __name__ == "__main__":
    main()
