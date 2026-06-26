"""
cpcb_loader.py — Synthetic CPCB Multi-Station River Water Quality Data

Generates a realistic dataset mimicking Central Pollution Control Board (India)
multi-station river monitoring data for the Vrushabavathi River.

Stations (upstream → downstream):
  STN_A  Kengeri Bridge        (upstream reference)
  STN_B  Nayandahalli Junction  (3 km downstream)
  STN_C  Mysore Road Bridge     (6 km downstream)
  STN_D  RR Nagar Outfall       (9 km downstream)

Parameters: DO, pH, conductivity, turbidity, BOD, nitrate
Hourly timestamps over ~6 months (4320 hours)

Baked-in pollution events (each ~48 hours):
  1. Industrial discharge  (hours 500-548)
  2. Agricultural runoff   (hours 1800-1848)
  3. Sewage contamination  (hours 3200-3248)
"""

from __future__ import annotations
import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

STATIONS = ["STN_A", "STN_B", "STN_C", "STN_D"]
PARAMS = ["DO", "pH", "conductivity", "turbidity", "BOD", "nitrate"]
TOTAL_HOURS = 4320  # ~6 months
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "cpcb_data.csv")

# Inter-station lag (hours): B lags A by 3h, C lags B by 3h, D lags C by 2h
STATION_LAGS = {"STN_A": 0, "STN_B": 3, "STN_C": 6, "STN_D": 8}

# Baseline values per station (slight downstream degradation)
BASELINES = {
    "STN_A": {"DO": 6.8, "pH": 7.4, "conductivity": 320, "turbidity": 8.0, "BOD": 4.0, "nitrate": 5.0},
    "STN_B": {"DO": 6.2, "pH": 7.3, "conductivity": 380, "turbidity": 12.0, "BOD": 6.0, "nitrate": 7.0},
    "STN_C": {"DO": 5.5, "pH": 7.1, "conductivity": 450, "turbidity": 18.0, "BOD": 9.0, "nitrate": 10.0},
    "STN_D": {"DO": 4.8, "pH": 7.0, "conductivity": 520, "turbidity": 25.0, "BOD": 12.0, "nitrate": 13.0},
}

# Noise standard deviations
NOISE_STD = {"DO": 0.3, "pH": 0.08, "conductivity": 15, "turbidity": 1.5, "BOD": 0.8, "nitrate": 0.6}

EVENTS = [
    {
        "type": "industrial_discharge",
        "start_hour": 500,
        "duration": 48,
        "origin_station": "STN_A",
        "pattern": [
            ("conductivity", 0, 250),   # spikes first
            ("pH", 2, -1.8),            # pH drops 2h later
            ("DO", 3, -3.5),            # DO drops 3h later
            ("turbidity", 1, 15),       # turbidity rises 1h later
            ("BOD", 4, 8),              # BOD rises 4h later
        ],
    },
    {
        "type": "agricultural_runoff",
        "start_hour": 1800,
        "duration": 48,
        "origin_station": "STN_A",
        "pattern": [
            ("nitrate", 0, 30),         # nitrate spikes first
            ("turbidity", 4, 25),       # turbidity rises 4h later
            ("DO", 6, -3.0),            # DO drops 6h later
            ("conductivity", 2, 80),    # conductivity mild rise 2h later
            ("BOD", 5, 5),              # BOD rises 5h later
        ],
    },
    {
        "type": "sewage_contamination",
        "start_hour": 3200,
        "duration": 48,
        "origin_station": "STN_B",
        "pattern": [
            ("BOD", 0, 20),             # BOD spikes first
            ("DO", 2, -4.0),            # DO drops 2h later
            ("conductivity", 1, 60),    # conductivity rises mildly 1h later
            ("turbidity", 3, 18),       # turbidity rises 3h later
            ("nitrate", 4, 8),          # nitrate mild rise 4h later
        ],
    },
]


def _diurnal(hour: int, param: str) -> float:
    """Diurnal cycle (24h period) amplitude for realism."""
    t = (hour % 24) / 24.0
    if param == "DO":
        return 0.5 * np.sin(2 * np.pi * t)  # DO peaks in afternoon (photosynthesis)
    if param == "temperature":
        return 2.0 * np.sin(2 * np.pi * (t - 0.25))
    if param == "pH":
        return 0.1 * np.sin(2 * np.pi * t)
    return 0


def _event_signal(hour: int, event: dict, station: str) -> dict:
    """Compute pollution event contribution at a given hour and station."""
    deltas = {}
    origin = event["origin_station"]
    origin_idx = STATIONS.index(origin)
    station_idx = STATIONS.index(station)

    if station_idx < origin_idx:
        return deltas

    propagation_lag = STATION_LAGS[station] - STATION_LAGS[origin]
    attenuation = 0.7 ** (station_idx - origin_idx)

    for param, param_lag, magnitude in event["pattern"]:
        total_lag = param_lag + propagation_lag
        event_start = event["start_hour"] + total_lag
        event_end = event_start + event["duration"]

        if event_start <= hour < event_end:
            progress = (hour - event_start) / event["duration"]
            # Bell-shaped envelope: ramp up then decay
            envelope = np.sin(np.pi * progress)
            deltas[param] = magnitude * envelope * attenuation

    return deltas


def generate_cpcb_data(seed: int = 42) -> pd.DataFrame:
    """Generate the full synthetic CPCB dataset."""
    rng = np.random.RandomState(seed)
    start_time = datetime(2025, 1, 1, 0, 0, 0)
    rows = []

    for hour in range(TOTAL_HOURS):
        ts = start_time + timedelta(hours=hour)
        for station in STATIONS:
            base = BASELINES[station]
            record = {"station_id": station, "timestamp": ts}

            for param in PARAMS:
                val = base[param]
                val += _diurnal(hour, param)
                # Slow seasonal drift
                val += 0.3 * np.sin(2 * np.pi * hour / (TOTAL_HOURS * 0.8))
                # Gaussian noise
                val += rng.normal(0, NOISE_STD[param])

                # Add event signals
                for event in EVENTS:
                    deltas = _event_signal(hour, event, station)
                    if param in deltas:
                        val += deltas[param]

                # Clamp to realistic ranges
                if param == "DO":
                    val = max(0.5, min(12.0, val))
                elif param == "pH":
                    val = max(4.0, min(9.5, val))
                elif param == "conductivity":
                    val = max(50, min(2000, val))
                elif param == "turbidity":
                    val = max(0.5, min(200, val))
                elif param == "BOD":
                    val = max(0.5, min(80, val))
                elif param == "nitrate":
                    val = max(0.1, min(100, val))

                record[param] = round(val, 2)

            rows.append(record)

    df = pd.DataFrame(rows)
    return df


def get_event_windows() -> list:
    """Return labelled event windows for training the classifier."""
    windows = []
    for event in EVENTS:
        windows.append({
            "type": event["type"],
            "start_hour": event["start_hour"],
            "end_hour": event["start_hour"] + event["duration"],
            "origin_station": event["origin_station"],
        })
    return windows


def load_or_generate(force: bool = False) -> pd.DataFrame:
    """Load from CSV if exists, otherwise generate and save."""
    if not force and os.path.exists(OUTPUT_PATH):
        return pd.read_csv(OUTPUT_PATH, parse_dates=["timestamp"])
    df = generate_cpcb_data()
    df.to_csv(OUTPUT_PATH, index=False)
    return df


if __name__ == "__main__":
    print("Generating synthetic CPCB data...")
    df = generate_cpcb_data()
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"Saved {len(df)} rows to {OUTPUT_PATH}")
    print(f"Stations: {df['station_id'].unique()}")
    print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    print(f"\nEvent windows:")
    for w in get_event_windows():
        print(f"  {w['type']}: hours {w['start_hour']}-{w['end_hour']} at {w['origin_station']}")
