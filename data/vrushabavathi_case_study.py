"""
vrushabavathi_case_study.py — Vrushabavathi River Case Study Dataset

Field-collected water quality data from sampling points along the
Vrushabavathi River and connected water bodies near RV College of
Engineering (RVCE), Bangalore, India.

The Vrushabavathi is a heavily polluted river carrying industrial
effluents and untreated sewage from central Bangalore southwestward.
It passes through industrial zones (Nayandahalli), residential areas
(RVCE campus), and agricultural regions (Kengeri/Kommaghatta).

Water body network:
    Nayandahalli (industrial) → Mysore Road Bridge → RVCE area
        → Jnana Bharathi Lake (via campus drain)
        → Kengeri → Kommaghatta Lake (via agricultural channel)
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple


# ── Water Body Definitions ───────────────────────────────────────────

@dataclass
class WaterBody:
    """A node in the water body connectivity graph."""
    id: str
    name: str
    body_type: str              # river, lake, drain, pond, channel
    latitude: float
    longitude: float
    description: str


WATER_BODIES: Dict[str, WaterBody] = {
    "vrushabavathi_nayandahalli": WaterBody(
        id="vrushabavathi_nayandahalli",
        name="Vrushabavathi at Nayandahalli",
        body_type="river",
        latitude=12.9550, longitude=77.5180,
        description="Upstream segment through industrial zone; receives factory effluents",
    ),
    "vrushabavathi_mysore_road": WaterBody(
        id="vrushabavathi_mysore_road",
        name="Vrushabavathi at Mysore Road Bridge",
        body_type="river",
        latitude=12.9450, longitude=77.5100,
        description="Major road crossing; mixed industrial and residential discharge",
    ),
    "vrushabavathi_rvce": WaterBody(
        id="vrushabavathi_rvce",
        name="Vrushabavathi near RVCE",
        body_type="river",
        latitude=12.9240, longitude=77.4990,
        description="River segment adjacent to RV College campus; residential sewage dominant",
    ),
    "campus_drain": WaterBody(
        id="campus_drain",
        name="Campus Drain (RVCE-BU Nala)",
        body_type="drain",
        latitude=12.9270, longitude=77.5010,
        description="Storm drain connecting campus area to Vrushabavathi; carries domestic sewage",
    ),
    "jnana_bharathi_lake": WaterBody(
        id="jnana_bharathi_lake",
        name="Jnana Bharathi Lake",
        body_type="lake",
        latitude=12.9350, longitude=77.5050,
        description="Lake near Bangalore University campus; receives runoff via campus drain",
    ),
    "vrushabavathi_kengeri": WaterBody(
        id="vrushabavathi_kengeri",
        name="Vrushabavathi at Kengeri",
        body_type="river",
        latitude=12.9120, longitude=77.4850,
        description="Downstream segment; pollution diluted by tributaries",
    ),
    "kengeri_pond": WaterBody(
        id="kengeri_pond",
        name="Kengeri Village Pond",
        body_type="pond",
        latitude=12.9100, longitude=77.4870,
        description="Small village pond connected to river via overflow channel",
    ),
    "agricultural_canal": WaterBody(
        id="agricultural_canal",
        name="Kengeri Agricultural Canal",
        body_type="channel",
        latitude=12.9050, longitude=77.4800,
        description="Irrigation channel drawing from river; serves downstream farms",
    ),
    "kommaghatta_lake": WaterBody(
        id="kommaghatta_lake",
        name="Kommaghatta Lake",
        body_type="lake",
        latitude=12.8950, longitude=77.4750,
        description="Downstream lake; receives diluted upstream pollution via canal",
    ),
}


# ── Water Body Connectivity (adjacency with distances in km) ─────────
# Each entry: source_id → [(neighbor_id, distance_km), ...]

WATER_BODY_CONNECTIONS: Dict[str, List[Tuple[str, float]]] = {
    "vrushabavathi_nayandahalli": [
        ("vrushabavathi_mysore_road", 1.2),
    ],
    "vrushabavathi_mysore_road": [
        ("vrushabavathi_nayandahalli", 1.2),
        ("vrushabavathi_rvce", 2.5),
    ],
    "vrushabavathi_rvce": [
        ("vrushabavathi_mysore_road", 2.5),
        ("campus_drain", 0.3),
        ("vrushabavathi_kengeri", 1.5),
    ],
    "campus_drain": [
        ("vrushabavathi_rvce", 0.3),
        ("jnana_bharathi_lake", 0.5),
    ],
    "jnana_bharathi_lake": [
        ("campus_drain", 0.5),
    ],
    "vrushabavathi_kengeri": [
        ("vrushabavathi_rvce", 1.5),
        ("kengeri_pond", 0.4),
        ("kommaghatta_lake", 2.0),
    ],
    "kengeri_pond": [
        ("vrushabavathi_kengeri", 0.4),
    ],
    "agricultural_canal": [
        ("vrushabavathi_kengeri", 0.8),
        ("kommaghatta_lake", 0.6),
    ],
    "kommaghatta_lake": [
        ("agricultural_canal", 0.6),
        ("vrushabavathi_kengeri", 2.0),
    ],
}


# ── Sampling Points ──────────────────────────────────────────────────
# Simulated field-collected water samples at specific GPS locations.
# Values reflect documented Vrushabavathi pollution characteristics.

@dataclass
class SamplingPoint:
    """One water sample collected at a specific location."""
    sample_id: str
    location_name: str
    water_body_id: str
    latitude: float
    longitude: float
    tds: float           # ppm
    turbidity: float     # NTU
    ph: float            # 0-14
    temperature: float   # Celsius
    rgb: Tuple[int, int, int]
    expected_source: str
    notes: str


# ── Cluster A: Industrial Zone (Nayandahalli / Mysore Road) ──────────
# High TDS, low pH (acidic from chemicals), high turbidity
# Expected source: Industrial Discharge

CLUSTER_A_INDUSTRIAL = [
    SamplingPoint("A1", "Nayandahalli Bridge - Left Bank", "vrushabavathi_nayandahalli",
                  12.9555, 77.5185, tds=1050, turbidity=12.3, ph=5.8, temperature=30.5,
                  rgb=(95, 78, 60), expected_source="Industrial Discharge",
                  notes="Dark water, chemical odor, foam visible on surface"),
    SamplingPoint("A2", "Nayandahalli Bridge - Right Bank", "vrushabavathi_nayandahalli",
                  12.9548, 77.5175, tds=980, turbidity=11.5, ph=6.0, temperature=30.2,
                  rgb=(100, 82, 65), expected_source="Industrial Discharge",
                  notes="Discolored water near factory outfall pipe"),
    SamplingPoint("A3", "Factory Outfall - 50m downstream", "vrushabavathi_nayandahalli",
                  12.9540, 77.5178, tds=1180, turbidity=14.8, ph=5.5, temperature=31.0,
                  rgb=(88, 70, 55), expected_source="Industrial Discharge",
                  notes="Direct industrial discharge point, foul chemical smell"),
    SamplingPoint("A4", "Nayandahalli - 100m downstream", "vrushabavathi_nayandahalli",
                  12.9535, 77.5172, tds=920, turbidity=10.2, ph=6.2, temperature=29.8,
                  rgb=(105, 85, 68), expected_source="Industrial Discharge",
                  notes="Slightly diluted downstream of outfall"),
    SamplingPoint("A5", "Mysore Road Bridge - Upstream", "vrushabavathi_mysore_road",
                  12.9455, 77.5105, tds=870, turbidity=9.5, ph=6.3, temperature=29.5,
                  rgb=(110, 88, 72), expected_source="Industrial Discharge",
                  notes="Mixed industrial and residential discharge visible"),
    SamplingPoint("A6", "Mysore Road Bridge - Downstream", "vrushabavathi_mysore_road",
                  12.9445, 77.5095, tds=850, turbidity=8.8, ph=6.5, temperature=29.2,
                  rgb=(112, 90, 74), expected_source="Industrial Discharge",
                  notes="Post-bridge section, slightly clearer due to aeration"),
]


# ── Cluster B: Residential / RVCE Area ───────────────────────────────
# Moderate-high TDS, alkaline pH (sewage), warm temperature
# Expected source: Sewage Contamination

CLUSTER_B_RESIDENTIAL = [
    SamplingPoint("B1", "RVCE Campus - River Bank", "vrushabavathi_rvce",
                  12.9245, 77.4995, tds=680, turbidity=6.5, ph=7.8, temperature=29.0,
                  rgb=(130, 110, 85), expected_source="Sewage Contamination",
                  notes="Sewage odor, residential area discharge visible"),
    SamplingPoint("B2", "RVCE Campus - Drain Outfall", "campus_drain",
                  12.9265, 77.5005, tds=720, turbidity=7.2, ph=8.0, temperature=29.5,
                  rgb=(125, 105, 80), expected_source="Sewage Contamination",
                  notes="Campus and residential drain merging into river"),
    SamplingPoint("B3", "RVCE - 50m from Campus Gate", "vrushabavathi_rvce",
                  12.9235, 77.4988, tds=650, turbidity=5.8, ph=7.9, temperature=28.8,
                  rgb=(135, 115, 90), expected_source="Sewage Contamination",
                  notes="Domestic wastewater discharge from nearby apartments"),
    SamplingPoint("B4", "Jnana Bharathi Lake - North Shore", "jnana_bharathi_lake",
                  12.9280, 77.5020, tds=520, turbidity=4.5, ph=8.2, temperature=28.2,
                  rgb=(140, 120, 95), expected_source="Sewage Contamination",
                  notes="Lake receiving runoff from campus drain, algal presence"),
    SamplingPoint("B5", "Jnana Bharathi Lake - South Shore", "jnana_bharathi_lake",
                  12.9275, 77.5015, tds=480, turbidity=4.0, ph=8.3, temperature=28.0,
                  rgb=(145, 125, 100), expected_source="Sewage Contamination",
                  notes="Stagnant water, greenish tint from algal growth"),
    SamplingPoint("B6", "Campus Drain - Mid Point", "campus_drain",
                  12.9258, 77.5008, tds=700, turbidity=6.8, ph=7.7, temperature=29.2,
                  rgb=(128, 108, 83), expected_source="Sewage Contamination",
                  notes="Open drain carrying mixed residential wastewater"),
]


# ── Cluster C: Downstream / Kengeri / Agricultural ───────────────────
# Low-moderate TDS, neutral pH, lower turbidity
# Expected source: Agricultural Runoff

CLUSTER_C_AGRICULTURAL = [
    SamplingPoint("C1", "Kengeri River Section", "vrushabavathi_kengeri",
                  12.9125, 77.4855, tds=420, turbidity=3.8, ph=7.3, temperature=27.0,
                  rgb=(155, 135, 110), expected_source="Agricultural Runoff",
                  notes="Upstream pollution diluted, agricultural land nearby"),
    SamplingPoint("C2", "Kengeri Village Pond - Center", "kengeri_pond",
                  12.9105, 77.4875, tds=380, turbidity=3.2, ph=7.5, temperature=26.5,
                  rgb=(160, 140, 115), expected_source="Agricultural Runoff",
                  notes="Village pond, turbid from soil runoff after rains"),
    SamplingPoint("C3", "Agricultural Canal - Inlet", "agricultural_canal",
                  12.9055, 77.4805, tds=350, turbidity=4.2, ph=7.2, temperature=26.8,
                  rgb=(150, 130, 108), expected_source="Agricultural Runoff",
                  notes="Irrigation canal drawing river water, soil sediment visible"),
    SamplingPoint("C4", "Kommaghatta Lake - Inlet", "kommaghatta_lake",
                  12.9080, 77.4830, tds=310, turbidity=2.8, ph=7.4, temperature=26.0,
                  rgb=(165, 145, 120), expected_source="Agricultural Runoff",
                  notes="Lake receiving agricultural runoff, relatively cleaner"),
    SamplingPoint("C5", "Kommaghatta Lake - Center", "kommaghatta_lake",
                  12.9075, 77.4825, tds=290, turbidity=2.5, ph=7.6, temperature=25.8,
                  rgb=(170, 150, 125), expected_source="Agricultural Runoff",
                  notes="Deeper lake water, diluted but persistent turbidity"),
]


# ── Noise / Isolated Points (scattered, not clustered) ───────────────
# Clean or ambiguous readings at distant locations

ISOLATED_POINTS = [
    SamplingPoint("N1", "Upstream Clean Stream (Reference)", "vrushabavathi_nayandahalli",
                  12.9700, 77.5350, tds=180, turbidity=1.2, ph=7.1, temperature=25.0,
                  rgb=(185, 170, 150), expected_source="Natural/Background",
                  notes="Upstream reference point, relatively unpolluted tributary"),
    SamplingPoint("N2", "Isolated Pond - 2km from River", "vrushabavathi_kengeri",
                  12.9300, 77.4600, tds=220, turbidity=1.5, ph=7.0, temperature=25.5,
                  rgb=(180, 165, 145), expected_source="Natural/Background",
                  notes="Isolated rainwater pond, no direct river connection"),
    SamplingPoint("N3", "Hilltop Spring - Reference", "vrushabavathi_rvce",
                  12.9500, 77.4700, tds=150, turbidity=0.8, ph=6.9, temperature=24.5,
                  rgb=(190, 175, 155), expected_source="Natural/Background",
                  notes="Natural spring water, baseline reference"),
]


# ── Combined dataset ─────────────────────────────────────────────────

ALL_SAMPLING_POINTS: List[SamplingPoint] = (
    CLUSTER_A_INDUSTRIAL
    + CLUSTER_B_RESIDENTIAL
    + CLUSTER_C_AGRICULTURAL
    + ISOLATED_POINTS
)


# ── Expected Validation Results ──────────────────────────────────────

EXPECTED_CLUSTERS = {
    "Cluster A (Industrial Zone)": {
        "sample_ids": ["A1", "A2", "A3", "A4", "A5", "A6"],
        "expected_severity": "HIGH",
        "expected_source": "Industrial Discharge",
        "approx_center": (12.951, 77.515),
    },
    "Cluster B (Residential/RVCE)": {
        "sample_ids": ["B1", "B2", "B3", "B4", "B5", "B6"],
        "expected_severity": "HIGH",
        "expected_source": "Sewage Contamination",
        "approx_center": (12.930, 77.502),
    },
    "Cluster C (Agricultural/Kengeri)": {
        "sample_ids": ["C1", "C2", "C3", "C4", "C5"],
        "expected_severity": "MODERATE",
        "expected_source": "Agricultural Runoff",
        "approx_center": (12.904, 77.479),
    },
}

EXPECTED_NOISE = ["N1", "N2", "N3"]


def get_water_body_distance(body_a: str, body_b: str) -> float | None:
    """Return direct distance between two connected water bodies, or None."""
    for neighbor_id, dist in WATER_BODY_CONNECTIONS.get(body_a, []):
        if neighbor_id == body_b:
            return dist
    return None
