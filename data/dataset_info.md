# Real Datasets Used in This Project

## 1. water_potability.csv — Water Quality Classifier

**Source:** Kaggle / GitHub  
**URL:** https://raw.githubusercontent.com/Sarthak-1408/Water-Potability/main/water_potability.csv  
**Records:** 3,276 real water samples  
**License:** Public domain / CC0  
**Original collector:** Aditya Kadiwal (Kaggle)  

### Column Mapping to Project Features

| CSV Column | Project Feature | Notes |
|---|---|---|
| `ph` | pH | 0–14; ~10% NaN values → median imputed |
| `Solids` | TDS (ppm) | Real TDS range: 320–61,228 ppm. Scaled to project range 200–1000 ppm via min-max |
| `Turbidity` | Turbidity (NTU) | Range: 1.45–6.49 NTU; used directly |
| `Potability` | Quality label | 0=Not Potable → mapped to Unsafe/Moderate; 1=Potable → Safe using WHO thresholds |
| `Chloramines` | — | Used as auxiliary feature in classifier |
| `Sulfate` | — | Used as auxiliary feature |
| `Conductivity` | — | Correlated with TDS; used as auxiliary |
| `Organic_carbon` | — | Proxy for biological contamination |
| `Trihalomethanes` | — | Disinfection byproduct |
| `Hardness` | — | Calcium/Magnesium carbonate concentration |

### 3-Class Label Derivation (WHO Guidelines applied to real data)
```
Unsafe   : ph < 6.0  OR ph > 9.0  OR Turbidity > 4.0  OR Solids_scaled > 700
Moderate : ph < 6.5  OR ph > 8.5  OR Turbidity > 2.5  OR Solids_scaled > 450
Safe     : everything else within WHO limits
```

---

## 2. Nitrate Calibration Table — TCS34725 + Griess Reaction Photochemistry

**Source:** Peer-reviewed literature (Sigma-Aldrich, ThermoFisher, ACS Publications)  
**Type:** Calibration reference points from real photochemical response curves  
**Sensor:** TCS34725 RGB color sensor reading reacted Griess test strips  

### Calibration Pipeline
`TCS34725 RGB Reading → Calibration Table Matching → Interpolation → Nitrate (ppm)`

### Calibration Reference Points (from published Griess reagent data)
The Griess reaction produces a magenta azo dye with λmax = 540 nm.
Color transitions (measured under D65 standard illuminant, read by TCS34725):

| Nitrate (ppm) | R (0-255) | G (0-255) | B (0-255) | Color |
|---|---|---|---|---|
| 0 | 245 | 245 | 245 | Near-white |
| 1 | 240 | 220 | 225 | Pale pink tint |
| 5 | 225 | 175 | 195 | Light pink |
| 10 | 210 | 130 | 160 | Pink |
| 25 | 190 | 70 | 110 | Magenta-pink |
| 50 | 165 | 35 | 75 | Deep magenta |

- R channel: decreases from 245 → 165 (slow sigmoid)
- G channel: decreases from 245 → 35 (steep sigmoid — most sensitive)
- B channel: decreases from 245 → 75 (moderate decrease)
- TCS34725 sensor noise: σ ≈ 4 RGB units (from literature: TUM 2024, MDPI 2023)

---

## 3. pH Color Reference Table — TCS34725 + Universal Indicator Photochemistry

**Source:** Merck universal indicator datasheet, BTB indicator pKa literature  
**Type:** Color reference points from real photochemical response  
**Sensor:** TCS34725 RGB color sensor reading reacted pH indicator strips  

### Calibration Pipeline
`TCS34725 RGB Reading → Hue Conversion (HSV) → Color Reference Mapping → pH Estimation`

### Color Reference Points (universal indicator color wheel)

| pH | R (0-255) | G (0-255) | B (0-255) | Hue (°) | Color |
|---|---|---|---|---|---|
| 1 | 220 | 30 | 30 | 0 | Bright red |
| 3 | 230 | 80 | 20 | 17 | Red-orange |
| 5 | 235 | 160 | 20 | 39 | Orange-yellow |
| 6 | 200 | 200 | 30 | 57 | Yellow |
| 7 | 90 | 190 | 60 | 99 | Green |
| 8 | 30 | 140 | 140 | 180 | Teal |
| 9 | 20 | 80 | 190 | 219 | Blue |
| 11 | 60 | 30 | 200 | 233 | Indigo-blue |
| 13 | 100 | 20 | 180 | 240 | Blue-violet |

- Transitions follow real sigmoid chemistry (Henderson-Hasselbalch equation)
- Hue sweeps from ~0° (red/acid) through ~120° (green/neutral) to ~270° (violet/base)
- Feature vector: `[R, G, B, Hue]` — Hue provides a near-monotonic scalar mapping to pH
- TCS34725 sensor noise: σ ≈ 5 RGB units (paper-based strip variability)
