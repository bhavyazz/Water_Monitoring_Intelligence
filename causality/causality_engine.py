"""
causality_engine.py — Granger Causality Pollution Fingerprinting & Early Warning

Three classes:
  GrangerCausalityAnalyzer  — pairwise Granger causality tests on time series
  PollutionEventLabeler     — RF classifier trained on lag matrix fingerprints
  EarlyWarningEngine        — live monitoring on the ring buffer, background thread
"""

from __future__ import annotations
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import warnings
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

warnings.filterwarnings("ignore", message="verbose is deprecated")

logger = logging.getLogger(__name__)

PARAMS = ["DO", "pH", "conductivity", "turbidity", "BOD", "nitrate"]
PARAM_PAIRS = [(a, b) for a in PARAMS for b in PARAMS if a != b]  # 30 pairs


class GrangerCausalityAnalyzer:
    """Pairwise Granger causality between water quality parameters."""

    def __init__(self, max_lag: int = 12, significance: float = 0.05):
        self.max_lag = max_lag
        self.significance = significance

    def analyze(self, df: pd.DataFrame) -> Dict[str, Dict[str, Dict[str, float]]]:
        """
        Compute pairwise Granger causality on a DataFrame with columns = PARAMS.

        Returns lag_matrix[param_A][param_B] = {"lag": int, "p_value": float, "strength": float}
        Only includes pairs where p_value < significance.
        """
        from statsmodels.tsa.stattools import grangercausalitytests

        lag_matrix: Dict[str, Dict[str, Dict[str, float]]] = {}

        for cause in PARAMS:
            if cause not in df.columns:
                continue
            for effect in PARAMS:
                if effect not in df.columns or cause == effect:
                    continue

                series = df[[effect, cause]].dropna()
                if len(series) < self.max_lag + 10:
                    continue

                try:
                    results = grangercausalitytests(
                        series.values, maxlag=self.max_lag, verbose=False,
                    )

                    best_lag = None
                    best_p = 1.0
                    for lag_val in range(1, self.max_lag + 1):
                        if lag_val not in results:
                            continue
                        test_results = results[lag_val]
                        # Use F-test p-value (ssr_ftest)
                        p_val = test_results[0]["ssr_ftest"][1]
                        if p_val < best_p:
                            best_p = p_val
                            best_lag = lag_val

                    if best_lag is not None and best_p < self.significance:
                        strength = max(0.0, min(1.0, 1.0 - best_p))
                        if cause not in lag_matrix:
                            lag_matrix[cause] = {}
                        lag_matrix[cause][effect] = {
                            "lag": best_lag,
                            "p_value": round(best_p, 6),
                            "strength": round(strength, 4),
                        }
                except Exception:
                    continue

        return lag_matrix

    def get_causality_graph(self, lag_matrix: Dict) -> List[Dict[str, Any]]:
        """Convert lag matrix to directed edge list for visualization."""
        edges = []
        for cause, effects in lag_matrix.items():
            for effect, info in effects.items():
                edges.append({
                    "from": cause,
                    "to": effect,
                    "lag": info["lag"],
                    "strength": info["strength"],
                    "p_value": info["p_value"],
                })
        edges.sort(key=lambda e: e["strength"], reverse=True)
        return edges


class PollutionEventLabeler:
    """
    Trains an RF classifier on lag matrix fingerprints from labelled CPCB events.
    Predicts pollution type from a live lag matrix.
    """

    def __init__(self):
        self.classifier = RandomForestClassifier(
            n_estimators=100, max_depth=8, random_state=42,
        )
        self.is_trained = False
        self._feature_names = self._build_feature_names()

    @staticmethod
    def _build_feature_names() -> List[str]:
        """Feature names: lag and strength for each parameter pair."""
        names = []
        for cause in PARAMS:
            for effect in PARAMS:
                if cause != effect:
                    names.append(f"{cause}_to_{effect}_lag")
                    names.append(f"{cause}_to_{effect}_str")
        return names

    def _lag_matrix_to_features(self, lag_matrix: Dict) -> List[float]:
        """Flatten a lag matrix into a fixed-length feature vector."""
        features = []
        for cause in PARAMS:
            for effect in PARAMS:
                if cause == effect:
                    continue
                if cause in lag_matrix and effect in lag_matrix[cause]:
                    info = lag_matrix[cause][effect]
                    features.append(float(info["lag"]))
                    features.append(float(info["strength"]))
                else:
                    features.append(0.0)
                    features.append(0.0)
        return features

    def train(self, cpcb_df: pd.DataFrame, event_windows: List[Dict]) -> None:
        """
        Train classifier on CPCB data with labelled event windows.
        Extracts lag matrices for each event window and for normal windows.
        """
        analyzer = GrangerCausalityAnalyzer(max_lag=12)
        X, y = [], []

        # Extract features from each event window
        for event in event_windows:
            start = event["start_hour"]
            end = event["end_hour"]
            station = event["origin_station"]

            event_df = cpcb_df[cpcb_df["station_id"] == station].copy()
            event_df = event_df.sort_values("timestamp").reset_index(drop=True)

            # Window: event hours plus some context before
            window_start = max(0, start - 20)
            window_end = min(len(event_df), end + 20)
            window = event_df.iloc[window_start:window_end][PARAMS]

            if len(window) < 30:
                continue

            lag_matrix = analyzer.analyze(window)
            features = self._lag_matrix_to_features(lag_matrix)
            X.append(features)
            y.append(event["type"])

            # Augment: shifted windows around the event
            for shift in [-8, -4, 4, 8]:
                ws = max(0, window_start + shift)
                we = min(len(event_df), window_end + shift)
                w = event_df.iloc[ws:we][PARAMS]
                if len(w) < 30:
                    continue
                lm = analyzer.analyze(w)
                X.append(self._lag_matrix_to_features(lm))
                y.append(event["type"])

        # Normal windows (no event active)
        event_hours = set()
        for event in event_windows:
            for h in range(event["start_hour"] - 10, event["end_hour"] + 10):
                event_hours.add(h)

        for station in ["STN_A", "STN_B"]:
            stn_df = cpcb_df[cpcb_df["station_id"] == station].sort_values("timestamp").reset_index(drop=True)
            for start_idx in range(0, len(stn_df) - 60, 200):
                if start_idx in event_hours:
                    continue
                window = stn_df.iloc[start_idx:start_idx + 60][PARAMS]
                if len(window) < 30:
                    continue
                lm = analyzer.analyze(window)
                X.append(self._lag_matrix_to_features(lm))
                y.append("normal")

        if len(X) < 4:
            logger.warning("Insufficient training data for causality classifier (%d samples)", len(X))
            return

        X_arr = np.array(X)
        self.classifier.fit(X_arr, y)
        self.is_trained = True
        logger.info("Causality classifier trained: %d samples, %d classes", len(X), len(set(y)))

    def predict(self, lag_matrix: Dict) -> Dict[str, Any]:
        """Predict pollution type from a lag matrix."""
        if not self.is_trained:
            return {"type": "unknown", "confidence": 0.0, "warning_horizon_hours": 0.0}

        features = np.array([self._lag_matrix_to_features(lag_matrix)])
        proba = self.classifier.predict_proba(features)[0]
        classes = self.classifier.classes_
        best_idx = int(np.argmax(proba))
        predicted_type = classes[best_idx]
        confidence = float(proba[best_idx])

        # Warning horizon = minimum lag in the detected causal chain
        min_lag = self._min_lag_in_matrix(lag_matrix)

        return {
            "type": predicted_type,
            "confidence": round(confidence, 3),
            "warning_horizon_hours": round(min_lag, 1),
        }

    @staticmethod
    def _min_lag_in_matrix(lag_matrix: Dict) -> float:
        """Find the minimum non-zero lag in the matrix."""
        min_lag = 12.0
        for cause_effects in lag_matrix.values():
            for info in cause_effects.values():
                lag = info.get("lag", 12)
                if 0 < lag < min_lag:
                    min_lag = lag
        return min_lag


class EarlyWarningEngine:
    """
    Monitors the live ring buffer and generates causal early warnings.
    Runs Granger tests in a background thread to never block the API.
    """

    def __init__(self, storage, labeler: PollutionEventLabeler, check_interval: int = 10):
        self.storage = storage
        self.labeler = labeler
        self.check_interval = check_interval
        self.analyzer = GrangerCausalityAnalyzer(max_lag=12)

        self._warnings: deque = deque(maxlen=20)
        self._current_graph: List[Dict] = []
        self._current_prediction: Dict = {}
        self._current_warning: Optional[Dict] = None
        self._current_lag_matrix: Dict = {}
        self._last_count = 0
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        """Start background monitoring thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="CausalityEngine")
        self._thread.start()
        logger.info("Early warning engine started (check every %d readings)", self.check_interval)

    def stop(self) -> None:
        self._running = False

    def _run_loop(self) -> None:
        while self._running:
            try:
                current_count = self.storage.count()
                if current_count >= 50 and current_count - self._last_count >= self.check_interval:
                    self._last_count = current_count
                    self._analyze_live()
            except Exception as e:
                logger.error("Early warning analysis failed: %s", e)
            time.sleep(5)

    def _analyze_live(self) -> None:
        """Run Granger analysis on recent readings from the ring buffer."""
        readings = self.storage.last_n(100)
        if len(readings) < 50:
            return

        # Build DataFrame from readings
        rows = []
        for r in readings:
            rows.append({
                "DO": max(0.5, 10.0 - (r.contamination_score or 30) / 10.0) if r.contamination_score else 6.0,
                "pH": r.ph or 7.0,
                "conductivity": (r.tds or 300) * 1.5,
                "turbidity": r.turbidity or 5.0,
                "BOD": max(1.0, (r.contamination_score or 20) / 5.0) if r.contamination_score else 4.0,
                "nitrate": r.nitrate or 8.0,
            })

        df = pd.DataFrame(rows)
        lag_matrix = self.analyzer.analyze(df)
        graph = self.analyzer.get_causality_graph(lag_matrix)
        prediction = self.labeler.predict(lag_matrix)

        warning = None
        if (prediction["confidence"] > 0.7
                and prediction["type"] != "normal"
                and prediction["type"] != "unknown"):
            trigger = self._find_trigger_param(lag_matrix)
            chain = self._build_causal_chain(lag_matrix)
            severity = "HIGH" if prediction["confidence"] > 0.85 else "MODERATE"

            warning = {
                "warning": True,
                "pollution_type": prediction["type"],
                "confidence": prediction["confidence"],
                "predicted_impact_in_hours": prediction["warning_horizon_hours"],
                "trigger_parameter": trigger,
                "causal_chain": chain,
                "severity": severity,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        with self._lock:
            self._current_graph = graph
            self._current_prediction = prediction
            self._current_lag_matrix = lag_matrix
            self._current_warning = warning
            if warning:
                self._warnings.append(warning)

    @staticmethod
    def _find_trigger_param(lag_matrix: Dict) -> str:
        """Find the parameter that causes the most other parameters (most outgoing edges)."""
        counts: Dict[str, int] = {}
        for cause, effects in lag_matrix.items():
            counts[cause] = counts.get(cause, 0) + len(effects)
        if not counts:
            return "unknown"
        return max(counts, key=counts.get)

    @staticmethod
    def _build_causal_chain(lag_matrix: Dict) -> List[str]:
        """Build human-readable causal chain from the strongest edges."""
        edges = []
        for cause, effects in lag_matrix.items():
            for effect, info in effects.items():
                edges.append((cause, effect, info["lag"], info["strength"]))
        edges.sort(key=lambda e: e[3], reverse=True)
        return [f"{e[0]} -> {e[1]} (lag {e[2]}h)" for e in edges[:5]]

    def get_current_state(self) -> Dict[str, Any]:
        """Get current analysis state (thread-safe). Called by API endpoint."""
        with self._lock:
            reading_count = self.storage.count()
            if reading_count < 50:
                return {"insufficient_data": True, "reading_count": reading_count, "minimum_required": 50}

            return {
                "insufficient_data": False,
                "reading_count": reading_count,
                "graph": list(self._current_graph),
                "lag_matrix": {k: dict(v) for k, v in self._current_lag_matrix.items()},
                "prediction": dict(self._current_prediction) if self._current_prediction else None,
                "active_warning": dict(self._current_warning) if self._current_warning else None,
            }

    def get_warning_history(self) -> List[Dict]:
        """Get last 20 warnings (thread-safe)."""
        with self._lock:
            return list(self._warnings)
