# Water Monitoring Intelligence

AI + IoT system for real-time water quality monitoring, pollution hotspot detection, source attribution, and spread prediction. Built around Arduino sensor hardware and trained on a real dataset (Kaggle Water Potability, 2785 samples).

Designed as a location-agnostic platform — demonstrated on the Vrushabavathi River near RVCE, Bangalore, but works for any water body anywhere. New samples auto-flow through the full pipeline: geotag → score → cluster → source → spread → map.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Hardware Setup](#hardware-setup)
3. [Installation](#installation)
4. [Running the System](#running-the-system)
5. [Pipeline Modules](#pipeline-modules)
6. [ML Model Training](#ml-model-training)
7. [API Endpoints](#api-endpoints)
8. [Validation](#validation)
9. [Maps & Visualization](#maps--visualization)
10. [Case Study: Vrushabavathi River](#case-study-vrushabavathi-river)
11. [Project Structure](#project-structure)

---

## Architecture

```
Arduino Sensors ──serial──> Parser ──> Preprocessor ──> pH Model (RGB)
                                                            │
                              ┌─────────────────────────────┘
                              v
                     Contamination Scorer (WQI, BIS 10500)
                              │
                              v
                     ML Classifier (RandomForest, trained on Kaggle dataset)
                        Safe / Moderate / Unsafe
                              │
                              v
                     Bloom Risk Predictor
                              │
                              v
                     Storage Engine ──> FastAPI Server
                                            │
                      ┌─────────────────────┼─────────────────────┐
                      v                     v                     v
               DBSCAN Clustering    Source Attribution    Spread Analysis
              (Hotspot Detection)   (Water Fingerprint)  (Distance-Decay)
                      │                     │                     │
                      └─────────────────────┼─────────────────────┘
                                            v
                                    Folium/Leaflet Maps
```

**Two parallel scoring systems:**
- **WQI Score (0-100):** Formula-based Weighted Arithmetic Water Quality Index using BIS 10500:2012 standards. Gives a numeric contamination severity.
- **ML Classification (Safe/Moderate/Unsafe):** RandomForest trained on 2785 real samples from the Kaggle Water Potability dataset, labeled using BIS/WHO thresholds. Gives a categorical label with confidence probability.

---

## Hardware Setup

### Sensors Connected to Arduino
| Sensor        | Measures          | Range           | Arduino Pin |
|---------------|-------------------|-----------------|-------------|
| TDS Sensor    | Dissolved solids  | 0–1000 ppm      | Analog      |
| Turbidity     | Water clarity     | 0–3000 NTU      | Analog      |
| DS18B20       | Temperature       | -55 to +125 °C  | Digital     |
| pH Strip+RGB  | pH (colorimetric) | 0–14            | Camera/RGB  |
| GPS Module    | Lat/Lon           | Decimal degrees  | Serial      |

### Arduino Serial Output Format
The Arduino sketch prints data in blocks:
```
===== WATER QUALITY DATA =====
Temperature: 28.50 °C
TDS: 320 ppm
Turbidity Voltage: 2.10
Water Level: Low
Latitude: 12.971234
Longitude: 77.594321
RGB: 120, 98, 76
==============================
```

The system parses these blocks into the canonical format:
```
T:28.5;TDS:320;TURB:2.1;LEVEL:380;LAT:12.971234;LON:77.594321;RGB:120,98,76
```

---

## Installation

### Prerequisites
- Python 3.12+
- Arduino with sensors connected (for live mode)

### Install Dependencies
```bash
pip install numpy scikit-learn joblib fastapi uvicorn folium
pip install pyserial    # required for Arduino serial communication
```

### Train the ML Model (one-time)
```bash
python -m models.train_quality_model
```
This trains a RandomForest on the Kaggle Water Potability dataset (2785 samples) and saves the model to `models/water_quality_model.joblib`. Expected output:
- 99.3% mean accuracy (5-fold cross-validation)
- Feature importances: pH (63%), TDS (27%), Turbidity (11%)
- All 9 validation scenarios pass

---

## Running the System

One command starts everything — backend API + live sensor pipeline + preloaded RVCE data:

### Quick Start (with Arduino)
```bash
# Terminal 1: Backend (auto-detects Arduino, preloads RVCE data)
python main.py

# Terminal 2: Frontend
cd frontend && npm install && npm run dev
```
- Backend API: `http://localhost:8000` (docs at `/docs`)
- Frontend dashboard: `http://localhost:5173`
- Vrushabavathi/RVCE case study data (20 samples, 9 water bodies) preloaded by default

### Quick Start (without Arduino)
```bash
# Terminal 1: Backend with simulator
python main.py --simulate

# Terminal 2: Frontend
cd frontend && npm install && npm run dev
```
If no Arduino is connected and `--simulate` is not used, the system starts in API-only mode (no live sensor loop) with RVCE data preloaded — you can submit samples via the API.

### Specify Arduino Port
```bash
python main.py --port COM3 --baud 115200
```

### Case Study Mode (Print-Only Validation)
Runs full Vrushabavathi analysis to terminal — no server, no frontend:
```bash
python main.py --case-study
```

### Other Commands
```bash
python main.py --list-ports              # List available serial ports
python main.py --no-preload              # Skip preloading RVCE data
python -m models.train_quality_model     # Train/retrain the ML model
python -m validation.validate_all        # Run 37 validation tests
python -m validation.generate_maps       # Generate 5 interactive maps
```

### Command Reference
| Command | What It Does |
|---------|-------------|
| `python main.py` | Arduino + RVCE preload + API server (default) |
| `python main.py --simulate` | Simulator instead of Arduino |
| `python main.py --case-study` | Print-only Vrushabavathi validation |
| `python main.py --no-preload` | Start without RVCE demo data |
| `python main.py --list-ports` | List available serial ports |
| `python -m models.train_quality_model` | Train/retrain ML model |
| `python -m validation.validate_all` | Run 37 validation tests |
| `python -m validation.generate_maps` | Generate 5 interactive maps |

---

## Pipeline Modules

### 1. Parser (`parser/water_parser.py`)
Parses raw Arduino serial strings into `WaterReading` dataclass objects. Extracts TDS, turbidity, temperature, GPS coordinates, RGB values.

### 2. Preprocessor (`preprocessing/preprocessor.py`)
Applies a sliding-window median filter (window size = 5) to smooth TDS and turbidity readings, reducing sensor noise.

### 3. pH Model (`models/ph_model.py`)
Colorimetric pH estimation from RGB strip readings. Maps RGB color values to pH using a trained model.

### 4. Contamination Scorer (`models/contamination_scorer.py`)
Computes a Water Quality Index (WQI) score from 0 to 100 using the Weighted Arithmetic method.

**Standards used:** BIS 10500:2012 / WHO Drinking Water Guidelines

| Parameter   | BIS Desirable | BIS Permissible | Weight |
|-------------|---------------|-----------------|--------|
| pH          | 6.5 – 8.5     | 6.0 – 9.0      | 0.30   |
| TDS         | ≤ 500 ppm     | ≤ 2000 ppm     | 0.25   |
| Turbidity   | ≤ 1 NTU       | ≤ 5 NTU        | 0.25   |
| Temperature | ~25°C         | —               | 0.20   |

**Classification:**
| WQI Score | Label     | Quality Label |
|-----------|-----------|---------------|
| 0 – 25    | Excellent | Safe          |
| 26 – 50   | Good      | Safe          |
| 51 – 75   | Poor      | Moderate      |
| 76 – 100  | Critical  | Unsafe        |

### 5. ML Water Quality Classifier (`models/quality_classifier.py`)
RandomForest trained on 2785 samples from the Kaggle Water Potability dataset.

- **Features:** pH, TDS (ppm), Turbidity (NTU)
- **Output:** Safe / Moderate / Unsafe with confidence probability
- **Dataset:** Kaggle Water Potability (3276 rows, 2785 after dropping null pH)
- **TDS Scaling:** Dataset's "Solids" column (321–56868) scaled to 50–2000 ppm to match Arduino TDS sensor range
- **Labels:** Derived from BIS 10500:2012 standards using a scoring system
- **Accuracy:** 99.3% (5-fold cross-validation)

### 6. Hotspot Detector (`clustering/hotspot_detector.py`)
Uses DBSCAN clustering on GPS coordinates with haversine distance.

- **eps:** 800 meters
- **min_samples:** 3
- **Metric:** Haversine (great-circle distance)
- **Output:** Cluster centers, affected radius, severity (HIGH/MODERATE/LOW)

### 7. Source Identifier (`clustering/source_identifier.py`)
Rule-based pollution source attribution using water quality fingerprinting. No external API calls.

**Profiles:**
| Source | Key Indicators |
|--------|---------------|
| Industrial Discharge | TDS > 700, pH < 6.5 (acidic), turbidity > 8 |
| Sewage Contamination | TDS 400–1000, pH > 7.5 (alkaline), temperature > 27°C |
| Agricultural Runoff | TDS < 500, pH 6.5–8.0 (neutral), turbidity 2–8 |
| Natural/Background | TDS < 250, turbidity < 1.5, pH 6.5–8.0 |

Returns: source type, confidence level, reasoning.

### 8. Spread Analyzer (`clustering/spread_analyzer.py`)
Predicts pollution propagation through connected water bodies using an exponential distance-decay model with BFS graph traversal.

**Formula:** `risk = source_score × e^(-λ × distance_km)`

- **λ (decay factor):** 0.2
- **Traversal:** BFS on water body connectivity graph
- **Risk levels:** HIGH (≥60), MODERATE (≥30), LOW (≥10), NEGLIGIBLE (<10)

### 9. Bloom Predictor (`clustering/bloom_predictor.py`)
Algal bloom risk assessment based on temperature, pH, and turbidity.

| Risk Level | Conditions |
|------------|-----------|
| HIGH | pH > 8.5 AND temp > 30°C AND turbidity < 3 NTU |
| MODERATE | pH > 7.8 AND temp > 27°C AND turbidity < 5 NTU |
| LOW | Everything else |

---

## ML Model Training

### Dataset
**Kaggle Water Potability** — 3276 rows, 10 columns. Public dataset.

Source: `data/water_potability.csv`

### Preprocessing
1. **Drop null rows:** 491 rows with missing pH values removed → 2785 valid samples
2. **TDS scaling:** The dataset's "Solids" column (range 321–56868) is linearly scaled to 50–2000 ppm to match Arduino TDS sensor output range
3. **Feature extraction:** pH, TDS (scaled), Turbidity — the 3 parameters available from Arduino sensors

### Labeling (BIS 10500:2012)
Each sample gets a severity score based on how far its parameters deviate from BIS standards:
- **pH:** deviation from 7.0 → 0.5/1.5/3.0 points
- **TDS:** >500/1000/2000 → 1.0/2.0/3.0 points
- **Turbidity:** >1.0/5.0 → 0.5/2.0 points

Classification: score ≤ 1.5 → Safe, ≤ 3.5 → Moderate, > 3.5 → Unsafe

**Class distribution:** Safe 25.0%, Moderate 59.9%, Unsafe 15.1%

### Model
- **Algorithm:** RandomForestClassifier (150 trees, max_depth=12)
- **Validation:** Stratified 80/20 train/test split + 5-fold cross-validation
- **Test accuracy:** 99%
- **Cross-val accuracy:** 99.3% (±0.2%)

### Retrain
```bash
python -m models.train_quality_model
```
Outputs classification report, confusion matrix, feature importances, and validation scenarios.

---

## API Endpoints

Server runs on `http://localhost:8000` by default. Interactive docs at `/docs`.

### Live Pipeline Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/data` | Latest processed sensor reading |
| GET | `/history?n=50` | Last N readings |
| GET | `/clusters` | Current pollution hotspot clusters |
| GET | `/alerts` | Water quality and bloom alerts |

### Field Assessment Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/samples` | Add a new geotagged water sample |
| GET | `/samples` | Get all stored samples with scores |
| POST | `/water-bodies` | Register a water body |
| POST | `/water-bodies/connect` | Connect two water bodies (with distance) |
| GET | `/water-bodies` | Get water body network |
| GET | `/analysis` | Full pipeline analysis (clusters + sources + spread) |
| POST | `/analysis/maps` | Regenerate interactive maps |

### Example: Submit a Sample
```bash
curl -X POST http://localhost:8000/samples \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 12.930,
    "longitude": 77.500,
    "tds": 450,
    "turbidity": 3.5,
    "ph": 7.2,
    "temperature": 27.0,
    "location_name": "Test Point near RVCE",
    "notes": "Collected during field visit"
  }'
```
Response includes: contamination score (WQI), quality label (Safe/Moderate/Unsafe), pollution source attribution, and nearest cluster membership.

### Example: Run Full Analysis
```bash
curl http://localhost:8000/analysis
```
Returns: all clusters, source attribution per cluster, spread risk for all connected water bodies.

---

## Validation

Run the full validation suite (37 tests):
```bash
python -m validation.validate_all
```

### What Gets Validated

| Module | Tests | What It Checks |
|--------|-------|---------------|
| Contamination Scorer | 8 | BIS threshold compliance, pH symmetry, monotonicity, case study scoring |
| Hotspot Detection | 7 | 3 clusters found, correct sizes, noise points excluded, severity levels, cluster separation |
| Source Attribution | 7 | 4 pollution profiles + 3 case study clusters correctly identified |
| Pollution Spread | 8 | Source gets full score, monotonic decay, formula verification, path tracking |
| Bloom Risk | 7 | 6 threshold scenarios + turbidity inhibition |

Every test answers: **"How do you know it's correct?"**

---

## Maps & Visualization

Generate all maps:
```bash
python -m validation.generate_maps
```

Output in `maps/` folder:

| Map | File | Description |
|-----|------|-------------|
| 1 | `1_sampling_points.html` | All 20 sampling points color-coded by quality (green/yellow/red) |
| 2 | `2_water_body_network.html` | 9 water bodies with connectivity edges and distances |
| 3 | `3_hotspot_clusters.html` | DBSCAN clusters with affected radius circles |
| 4 | `4_pollution_spread.html` | Distance-decay risk propagation through water network |
| 5 | `5_combined_overview.html` | All layers combined with toggle controls |

All maps use Folium (Leaflet.js) with OpenStreetMap + Esri satellite tile layers. Open any `.html` file in a browser.

---

## Case Study: Vrushabavathi River

**Location:** Vrushabavathi River, near RVCE, Bangalore, India

The Vrushabavathi is a heavily polluted river carrying industrial effluents and untreated sewage from central Bangalore southwestward.

### Sampling Campaign
- **Period:** April–May 2026
- **Samples:** 20 geotagged points across 5 field visits
- **Teams:** 3 field teams covering different zones
- **Method:** Arduino sensor kit + smartphone GPS geotagging

### Three Pollution Clusters Detected

| Cluster | Zone | Source | Avg TDS | Avg pH | Avg WQI | Severity |
|---------|------|--------|---------|--------|---------|----------|
| A | Nayandahalli (Industrial) | Industrial Discharge | 1032 ppm | 5.9 | 58.6 | HIGH |
| B | RVCE Campus (Residential) | Sewage Contamination | 625 ppm | 8.0 | 47.0 | HIGH |
| C | Kengeri (Agricultural) | Agricultural Runoff | 350 ppm | 7.4 | 28.1 | MODERATE |

Plus 3 noise/reference points (N1–N3): clean water with TDS < 250, turbidity < 1.5, neutral pH.

### Water Body Network
9 water bodies connected in a directed graph:
```
Nayandahalli (river) ──1.2km──> Mysore Road Bridge ──2.5km──> RVCE
    RVCE ──0.3km──> Campus Drain ──0.5km──> Jnana Bharathi Lake
    RVCE ──1.5km──> Kengeri ──0.4km──> Kengeri Pond
    Kengeri ──2.0km──> Kommaghatta Lake
    Kengeri ──0.8km──> Agricultural Canal ──0.6km──> Kommaghatta Lake
```

### Spread Analysis Result
From the worst hotspot (Nayandahalli, score 58.6), pollution risk decays exponentially:
- Mysore Road Bridge (1.2 km): risk 46.1 — MODERATE
- RVCE (3.7 km): risk 28.0 — LOW
- Kommaghatta Lake (7.2 km): risk 13.9 — LOW
- Agricultural Canal (7.8 km): risk 12.3 — LOW

---

## Project Structure

```
Water_Monitoring_Intelligence/
├── main.py                          # System entry point (all modes)
│
├── api/
│   └── server.py                    # FastAPI REST API (12 endpoints)
│
├── clustering/
│   ├── bloom_predictor.py           # Algal bloom risk assessment
│   ├── hotspot_detector.py          # DBSCAN hotspot clustering
│   ├── source_identifier.py         # Rule-based source attribution
│   └── spread_analyzer.py           # Distance-decay spread model
│
├── data/
│   ├── sample_store.py              # Persistent JSON storage (samples + water bodies)
│   ├── sampling_data.csv            # 20-row geotagged field dataset (April-May 2026)
│   ├── vrushabavathi_case_study.py  # Case study definitions (points, network, clusters)
│   ├── water_body_network.csv       # Water body connectivity as CSV
│   ├── water_potability.csv         # Kaggle dataset (3276 rows) for ML training
│   └── water_quality_standards.csv  # BIS 10500 / WHO reference table
│
├── maps/
│   ├── 1_sampling_points.html       # Sampling locations map
│   ├── 2_water_body_network.html    # Water body connectivity map
│   ├── 3_hotspot_clusters.html      # DBSCAN cluster map
│   ├── 4_pollution_spread.html      # Pollution spread map
│   └── 5_combined_overview.html     # Combined overview map
│
├── models/
│   ├── contamination_scorer.py      # WQI scoring (0-100)
│   ├── ph_model.py                  # RGB-to-pH colorimetric model
│   ├── quality_classifier.py        # ML classifier (loads trained model)
│   ├── train_quality_model.py       # Training script (Kaggle dataset)
│   └── water_quality_model.joblib   # Trained RandomForest model (2.5 MB)
│
├── parser/
│   └── water_parser.py              # Arduino serial string parser
│
├── preprocessing/
│   └── preprocessor.py              # Sliding-window median filter
│
├── simulator/
│   ├── arduino_serial.py            # Arduino serial reader (pyserial)
│   └── data_simulator.py            # Fake data generator (dev/testing)
│
├── utils/
│   ├── geojson_builder.py           # GeoJSON export builder
│   └── storage.py                   # In-memory ring buffer storage
│
├── validation/
│   ├── validate_all.py              # 37 validation tests (5 modules)
│   └── generate_maps.py             # Map generation script
│
└── frontend/                        # React dashboard (Vite + Recharts + Leaflet)
```

---

## Data Files

| File | Rows | Description |
|------|------|-------------|
| `data/sampling_data.csv` | 20 | Field-collected samples with GPS, sensor readings, RGB, weather, notes |
| `data/water_potability.csv` | 3276 | Kaggle dataset used for ML model training |
| `data/water_quality_standards.csv` | — | BIS 10500:2012 and WHO standard reference values |
| `data/water_body_network.csv` | — | Water body connectivity with distances |
| `data/samples.json` | dynamic | Persistent store for submitted samples (created at runtime) |
| `data/water_bodies.json` | dynamic | Persistent store for water body network (created at runtime) |

---

## Key Standards Referenced

- **BIS 10500:2012** — Indian Standard for Drinking Water Specification
- **WHO Guidelines for Drinking-water Quality** (4th edition)
- Parameters: pH, TDS, Turbidity, Temperature
- All thresholds, weights, and scoring formulas traceable to these standards
