"""
generate_maps.py -- Interactive Map Generator

Generates HTML maps using Folium (Leaflet.js) showing:
  1. Sampling points with color-coded markers (by contamination level)
  2. Water body network connections (lines between nodes)
  3. DBSCAN hotspot clusters (circles)
  4. Pollution spread risk overlay (gradient circles)

Maps are saved as standalone HTML files that open in any browser.
Uses OpenStreetMap tiles -- real satellite/street view underneath.

Coordinates sourced from Google Maps / OpenStreetMap for the
Vrushabavathi River area near RVCE, Bangalore.

Run:
    python -m validation.generate_maps
"""

from __future__ import annotations
import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import folium
from folium import plugins
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
)


OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "maps")


def _score_color(score: float) -> str:
    """Map WQI score to color: green -> yellow -> orange -> red."""
    if score <= 25:
        return "#22c55e"  # green
    elif score <= 50:
        return "#f59e0b"  # amber
    elif score <= 75:
        return "#f97316"  # orange
    return "#ef4444"      # red


def _source_color(source: str) -> str:
    colors = {
        "Industrial Discharge": "#ef4444",
        "Sewage Contamination": "#f97316",
        "Agricultural Runoff":  "#eab308",
        "Natural/Background":   "#22c55e",
    }
    return colors.get(source, "#6b7280")


def _source_icon(source: str) -> str:
    icons = {
        "Industrial Discharge": "industry",
        "Sewage Contamination": "home",
        "Agricultural Runoff":  "leaf",
        "Natural/Background":   "tint",
    }
    return icons.get(source, "question")


def generate_sampling_map():
    """Map 1: All sampling points with contamination scores."""
    print("  Generating sampling points map...")

    scorer = ContaminationScorer()

    center_lat = sum(sp.latitude for sp in ALL_SAMPLING_POINTS) / len(ALL_SAMPLING_POINTS)
    center_lon = sum(sp.longitude for sp in ALL_SAMPLING_POINTS) / len(ALL_SAMPLING_POINTS)

    m = folium.Map(
        location=[center_lat, center_lon],
        zoom_start=13,
        tiles="OpenStreetMap",
    )

    # Add satellite tile layer option
    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Esri World Imagery",
        name="Satellite View",
    ).add_to(m)

    # Feature groups for layer control
    fg_samples = folium.FeatureGroup(name="Sampling Points")
    fg_labels = folium.FeatureGroup(name="Sample Labels")

    for sp in ALL_SAMPLING_POINTS:
        result = scorer.compute(sp.ph, sp.tds, sp.turbidity, sp.temperature)
        color = _score_color(result["score"])

        popup_html = f"""
        <div style="font-family: Arial; min-width: 280px;">
            <h4 style="margin:0 0 8px 0; color:#1e293b;">{sp.sample_id}: {sp.location_name}</h4>
            <table style="font-size:13px; border-collapse:collapse; width:100%;">
                <tr><td style="padding:2px 8px;"><b>Water Body</b></td><td>{sp.water_body_id}</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:2px 8px;"><b>GPS</b></td><td>{sp.latitude:.4f}, {sp.longitude:.4f}</td></tr>
                <tr><td style="padding:2px 8px;"><b>TDS</b></td><td>{sp.tds} ppm</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:2px 8px;"><b>Turbidity</b></td><td>{sp.turbidity} NTU</td></tr>
                <tr><td style="padding:2px 8px;"><b>pH</b></td><td>{sp.ph}</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:2px 8px;"><b>Temperature</b></td><td>{sp.temperature} C</td></tr>
                <tr><td style="padding:2px 8px;"><b>WQI Score</b></td>
                    <td><b style="color:{color};">{result['score']:.1f}</b> ({result['label']})</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:2px 8px;"><b>Quality</b></td><td>{result['quality_label']}</td></tr>
            </table>
            <p style="font-size:11px; color:#64748b; margin:6px 0 0 0;">{sp.notes}</p>
        </div>
        """

        folium.CircleMarker(
            location=[sp.latitude, sp.longitude],
            radius=10,
            popup=folium.Popup(popup_html, max_width=350),
            tooltip=f"{sp.sample_id}: WQI={result['score']:.0f} ({result['label']})",
            fill=True,
            fill_color=color,
            fill_opacity=0.8,
            color="#1e293b",
            weight=2,
        ).add_to(fg_samples)

        # Label
        folium.Marker(
            location=[sp.latitude, sp.longitude],
            icon=folium.DivIcon(
                html=f'<div style="font-size:10px;font-weight:bold;color:#1e293b;'
                     f'background:white;padding:1px 4px;border-radius:3px;'
                     f'border:1px solid {color};white-space:nowrap;">{sp.sample_id}</div>',
                icon_size=(30, 15),
                icon_anchor=(15, -10),
            ),
        ).add_to(fg_labels)

    fg_samples.add_to(m)
    fg_labels.add_to(m)

    # Legend
    legend_html = """
    <div style="position:fixed; bottom:30px; left:30px; z-index:1000;
         background:white; padding:12px 16px; border-radius:8px;
         box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:Arial; font-size:12px;">
        <b>WQI Contamination Score</b><br>
        <span style="color:#22c55e;">&#9679;</span> 0-25 Excellent (Safe)<br>
        <span style="color:#f59e0b;">&#9679;</span> 26-50 Good (Safe)<br>
        <span style="color:#f97316;">&#9679;</span> 51-75 Poor (Moderate)<br>
        <span style="color:#ef4444;">&#9679;</span> 76-100 Critical (Unsafe)<br>
        <br><i>Geotagged via smartphone GPS</i>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    folium.LayerControl().add_to(m)

    path = os.path.join(OUTPUT_DIR, "1_sampling_points.html")
    m.save(path)
    print(f"    Saved: {path}")
    return m


def generate_water_body_network_map():
    """Map 2: Water body connectivity network."""
    print("  Generating water body network map...")

    center_lat = sum(wb.latitude for wb in WATER_BODIES.values()) / len(WATER_BODIES)
    center_lon = sum(wb.longitude for wb in WATER_BODIES.values()) / len(WATER_BODIES)

    m = folium.Map(location=[center_lat, center_lon], zoom_start=13, tiles="OpenStreetMap")

    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Esri World Imagery",
        name="Satellite View",
    ).add_to(m)

    fg_bodies = folium.FeatureGroup(name="Water Bodies")
    fg_connections = folium.FeatureGroup(name="Connections")

    type_colors = {
        "river": "#3b82f6",
        "lake": "#06b6d4",
        "drain": "#f97316",
        "pond": "#8b5cf6",
        "channel": "#10b981",
    }

    type_icons = {
        "river": "water",
        "lake": "tint",
        "drain": "arrow-down",
        "pond": "circle",
        "channel": "arrows-alt",
    }

    # Draw connections as lines
    drawn_connections = set()
    for wb_id, neighbors in WATER_BODY_CONNECTIONS.items():
        wb = WATER_BODIES[wb_id]
        for neighbor_id, distance in neighbors:
            edge_key = tuple(sorted([wb_id, neighbor_id]))
            if edge_key in drawn_connections:
                continue
            drawn_connections.add(edge_key)

            neighbor = WATER_BODIES[neighbor_id]
            folium.PolyLine(
                locations=[
                    [wb.latitude, wb.longitude],
                    [neighbor.latitude, neighbor.longitude],
                ],
                color="#3b82f6",
                weight=3,
                opacity=0.7,
                dash_array="10 5",
                tooltip=f"{wb.name} <-> {neighbor.name} ({distance:.1f} km)",
            ).add_to(fg_connections)

            # Distance label at midpoint
            mid_lat = (wb.latitude + neighbor.latitude) / 2
            mid_lon = (wb.longitude + neighbor.longitude) / 2
            folium.Marker(
                location=[mid_lat, mid_lon],
                icon=folium.DivIcon(
                    html=f'<div style="font-size:10px;color:#3b82f6;font-weight:bold;'
                         f'background:rgba(255,255,255,0.9);padding:1px 4px;border-radius:3px;">'
                         f'{distance:.1f} km</div>',
                    icon_size=(50, 15),
                    icon_anchor=(25, 7),
                ),
            ).add_to(fg_connections)

    # Draw water body nodes
    for wb_id, wb in WATER_BODIES.items():
        color = type_colors.get(wb.body_type, "#6b7280")
        icon_name = type_icons.get(wb.body_type, "question")

        popup_html = f"""
        <div style="font-family:Arial; min-width:250px;">
            <h4 style="margin:0 0 6px 0;">{wb.name}</h4>
            <p style="margin:2px 0;"><b>Type:</b> {wb.body_type.capitalize()}</p>
            <p style="margin:2px 0;"><b>GPS:</b> {wb.latitude:.4f}, {wb.longitude:.4f}</p>
            <p style="margin:2px 0;"><b>ID:</b> {wb.id}</p>
            <p style="font-size:11px;color:#64748b;margin:6px 0 0 0;">{wb.description}</p>
            <p style="margin:4px 0;"><b>Connected to:</b></p>
            <ul style="margin:0;padding-left:18px;font-size:12px;">
        """
        for neighbor_id, dist in WATER_BODY_CONNECTIONS.get(wb_id, []):
            neighbor = WATER_BODIES[neighbor_id]
            popup_html += f"<li>{neighbor.name} ({dist:.1f} km)</li>"
        popup_html += "</ul></div>"

        folium.Marker(
            location=[wb.latitude, wb.longitude],
            popup=folium.Popup(popup_html, max_width=320),
            tooltip=f"{wb.name} ({wb.body_type})",
            icon=folium.Icon(color="blue" if wb.body_type == "river" else
                            "orange" if wb.body_type == "drain" else
                            "green" if wb.body_type == "channel" else
                            "purple",
                            icon=icon_name, prefix="fa"),
        ).add_to(fg_bodies)

    fg_connections.add_to(m)
    fg_bodies.add_to(m)

    legend_html = """
    <div style="position:fixed; bottom:30px; left:30px; z-index:1000;
         background:white; padding:12px 16px; border-radius:8px;
         box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:Arial; font-size:12px;">
        <b>Water Body Network</b><br>
        <span style="color:#3b82f6;">&#9679;</span> River<br>
        <span style="color:#f97316;">&#9679;</span> Drain/Nala<br>
        <span style="color:#8b5cf6;">&#9679;</span> Pond/Lake<br>
        <span style="color:#10b981;">&#9679;</span> Canal/Channel<br>
        <br><span style="color:#3b82f6;">- - -</span> Connection (with distance)<br>
        <br><i>Network mapped from OpenStreetMap<br>and Google Maps satellite imagery</i>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))
    folium.LayerControl().add_to(m)

    path = os.path.join(OUTPUT_DIR, "2_water_body_network.html")
    m.save(path)
    print(f"    Saved: {path}")


def generate_hotspot_map():
    """Map 3: DBSCAN hotspot clusters with source attribution."""
    print("  Generating hotspot detection map...")

    scorer = ContaminationScorer()
    detector = HotspotDetector(eps_meters=800, min_samples=3)
    source_id = SourceIdentifier()

    # Build readings
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

    center_lat = sum(sp.latitude for sp in ALL_SAMPLING_POINTS) / len(ALL_SAMPLING_POINTS)
    center_lon = sum(sp.longitude for sp in ALL_SAMPLING_POINTS) / len(ALL_SAMPLING_POINTS)

    m = folium.Map(location=[center_lat, center_lon], zoom_start=13, tiles="OpenStreetMap")

    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Esri World Imagery",
        name="Satellite View",
    ).add_to(m)

    cluster_colors = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#8b5cf6"]

    for idx, c in enumerate(clusters):
        color = cluster_colors[idx % len(cluster_colors)]

        avg_tds = sum(r.tds for r in c.readings if r.tds) / len(c.readings)
        avg_turb = sum(r.turbidity for r in c.readings if r.turbidity) / len(c.readings)
        avg_ph = sum(r.ph for r in c.readings if r.ph) / len(c.readings)
        avg_temp = sum(r.temperature for r in c.readings if r.temperature) / len(c.readings)
        avg_wqi = sum(r.contamination_score for r in c.readings if r.contamination_score) / len(c.readings)

        source = source_id.identify(avg_tds, avg_turb, avg_ph, avg_temp)
        details = source_id.identify_with_details(avg_tds, avg_turb, avg_ph, avg_temp)

        # Cluster radius circle
        folium.Circle(
            location=[c.center[0], c.center[1]],
            radius=max(c.affected_radius_m * 1.5, 200),
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=0.15,
            weight=2,
            dash_array="5 5",
            tooltip=f"Cluster {c.cluster_id}: {c.severity} severity",
        ).add_to(m)

        # Cluster center marker
        reasons_html = "".join(f"<li>{r}</li>" for r in details["reasons"])
        popup_html = f"""
        <div style="font-family:Arial; min-width:300px;">
            <h3 style="margin:0 0 8px 0; color:{color};">Hotspot Cluster {c.cluster_id}</h3>
            <table style="font-size:13px; border-collapse:collapse; width:100%;">
                <tr><td style="padding:3px 8px;"><b>Severity</b></td>
                    <td><b style="color:{color};">{c.severity}</b></td></tr>
                <tr style="background:#f8fafc;"><td style="padding:3px 8px;"><b>Source</b></td>
                    <td>{source}</td></tr>
                <tr><td style="padding:3px 8px;"><b>Confidence</b></td>
                    <td>{details['confidence']}</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:3px 8px;"><b>Readings</b></td>
                    <td>{len(c.readings)} samples</td></tr>
                <tr><td style="padding:3px 8px;"><b>Radius</b></td>
                    <td>{c.affected_radius_m:.0f} m</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:3px 8px;"><b>Avg WQI</b></td>
                    <td>{avg_wqi:.1f}</td></tr>
                <tr><td style="padding:3px 8px;"><b>Avg TDS</b></td><td>{avg_tds:.0f} ppm</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:3px 8px;"><b>Avg pH</b></td>
                    <td>{avg_ph:.1f}</td></tr>
            </table>
            <p style="margin:6px 0 2px 0;font-size:12px;"><b>Evidence:</b></p>
            <ul style="margin:0;padding-left:16px;font-size:11px;">{reasons_html}</ul>
        </div>
        """

        folium.Marker(
            location=[c.center[0], c.center[1]],
            popup=folium.Popup(popup_html, max_width=380),
            tooltip=f"Cluster {c.cluster_id}: {source} ({c.severity})",
            icon=folium.Icon(
                color="red" if c.severity == "HIGH" else "orange",
                icon=_source_icon(source),
                prefix="fa",
            ),
        ).add_to(m)

        # Individual readings in cluster
        for r in c.readings:
            folium.CircleMarker(
                location=[r.latitude, r.longitude],
                radius=6,
                color=color,
                fill=True,
                fill_color=color,
                fill_opacity=0.6,
                weight=1,
                tooltip=f"WQI={r.contamination_score:.0f}, TDS={r.tds}, pH={r.ph}",
            ).add_to(m)

    # Noise points (not clustered)
    clustered_latlons = set()
    for c in clusters:
        for r in c.readings:
            clustered_latlons.add((round(r.latitude, 4), round(r.longitude, 4)))

    for r in readings:
        key = (round(r.latitude, 4), round(r.longitude, 4))
        if key not in clustered_latlons:
            folium.CircleMarker(
                location=[r.latitude, r.longitude],
                radius=5,
                color="#22c55e",
                fill=True,
                fill_color="#22c55e",
                fill_opacity=0.5,
                weight=1,
                tooltip=f"Noise (not clustered): WQI={r.contamination_score:.0f}",
            ).add_to(m)

    legend_html = f"""
    <div style="position:fixed; bottom:30px; left:30px; z-index:1000;
         background:white; padding:12px 16px; border-radius:8px;
         box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:Arial; font-size:12px;">
        <b>DBSCAN Hotspot Detection</b><br>
        <b>eps=800m, min_samples=3</b><br><br>
        <span style="color:#ef4444;">&#9679;</span> Cluster 0 (Industrial)<br>
        <span style="color:#f97316;">&#9679;</span> Cluster 1 (Sewage)<br>
        <span style="color:#eab308;">&#9679;</span> Cluster 2 (Agricultural)<br>
        <span style="color:#22c55e;">&#9679;</span> Noise (reference points)<br>
        <br>Dashed circles = affected radius<br>
        <i>{len(clusters)} clusters, {len(readings) - sum(len(c.readings) for c in clusters)} noise points</i>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))
    folium.LayerControl().add_to(m)

    path = os.path.join(OUTPUT_DIR, "3_hotspot_clusters.html")
    m.save(path)
    print(f"    Saved: {path}")


def generate_spread_map():
    """Map 4: Pollution spread risk through water body network."""
    print("  Generating pollution spread map...")

    scorer = ContaminationScorer()
    source_id = SourceIdentifier()

    wb_dict = {}
    for wb_id, wb in WATER_BODIES.items():
        wb_dict[wb_id] = {
            "name": wb.name,
            "latitude": wb.latitude,
            "longitude": wb.longitude,
            "body_type": wb.body_type,
        }

    spread = SpreadAnalyzer(wb_dict, WATER_BODY_CONNECTIONS, decay_factor=0.2)

    # Compute spread from industrial zone (worst polluter)
    industrial_avg = scorer.compute(
        ph=sum(sp.ph for sp in CLUSTER_A_INDUSTRIAL) / len(CLUSTER_A_INDUSTRIAL),
        tds=sum(sp.tds for sp in CLUSTER_A_INDUSTRIAL) / len(CLUSTER_A_INDUSTRIAL),
        turbidity=sum(sp.turbidity for sp in CLUSTER_A_INDUSTRIAL) / len(CLUSTER_A_INDUSTRIAL),
        temperature=sum(sp.temperature for sp in CLUSTER_A_INDUSTRIAL) / len(CLUSTER_A_INDUSTRIAL),
    )

    spread_results = spread.analyze_spread("vrushabavathi_nayandahalli", industrial_avg["score"])

    center_lat = sum(wb.latitude for wb in WATER_BODIES.values()) / len(WATER_BODIES)
    center_lon = sum(wb.longitude for wb in WATER_BODIES.values()) / len(WATER_BODIES)

    m = folium.Map(location=[center_lat, center_lon], zoom_start=13, tiles="OpenStreetMap")

    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Esri World Imagery",
        name="Satellite View",
    ).add_to(m)

    # Draw connections
    drawn = set()
    for wb_id, neighbors in WATER_BODY_CONNECTIONS.items():
        wb = WATER_BODIES[wb_id]
        for neighbor_id, distance in neighbors:
            edge = tuple(sorted([wb_id, neighbor_id]))
            if edge in drawn:
                continue
            drawn.add(edge)
            neighbor = WATER_BODIES[neighbor_id]

            folium.PolyLine(
                locations=[[wb.latitude, wb.longitude], [neighbor.latitude, neighbor.longitude]],
                color="#94a3b8",
                weight=2,
                opacity=0.5,
                dash_array="8 4",
            ).add_to(m)

    # Draw spread risk at each water body
    risk_map = {r.water_body_id: r for r in spread_results}
    max_risk = max(r.risk_score for r in spread_results) if spread_results else 1

    for wb_id, wb in WATER_BODIES.items():
        risk_entry = risk_map.get(wb_id)
        if risk_entry is None:
            risk_score = 0
            risk_level = "NONE"
            color = "#d1d5db"
        else:
            risk_score = risk_entry.risk_score
            risk_level = risk_entry.risk_level
            color = _score_color(risk_score)

        radius = max(150, risk_score * 8)

        folium.Circle(
            location=[wb.latitude, wb.longitude],
            radius=radius,
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=0.3 + 0.4 * (risk_score / max(max_risk, 1)),
            weight=2,
        ).add_to(m)

        path_str = ""
        if risk_entry and len(risk_entry.path_from_source) > 1:
            path_names = []
            for pid in risk_entry.path_from_source:
                p_wb = WATER_BODIES.get(pid)
                path_names.append(p_wb.name if p_wb else pid)
            path_str = " -> ".join(path_names)

        popup_html = f"""
        <div style="font-family:Arial; min-width:280px;">
            <h4 style="margin:0 0 6px 0;">{wb.name}</h4>
            <table style="font-size:13px; border-collapse:collapse; width:100%;">
                <tr><td style="padding:2px 8px;"><b>Risk Score</b></td>
                    <td><b style="color:{color};">{risk_score:.1f}</b></td></tr>
                <tr style="background:#f8fafc;"><td style="padding:2px 8px;"><b>Risk Level</b></td>
                    <td>{risk_level}</td></tr>
                <tr><td style="padding:2px 8px;"><b>Distance</b></td>
                    <td>{risk_entry.distance_from_source:.1f} km</td></tr>
            </table>
            <p style="font-size:11px;color:#64748b;margin:6px 0 0 0;">
                <b>Propagation path:</b><br>{path_str}</p>
            <p style="font-size:11px;color:#64748b;">
                Formula: risk = {industrial_avg['score']:.1f} x e^(-0.2 x distance)</p>
        </div>
        """

        icon_color = "red" if risk_score >= 50 else "orange" if risk_score >= 25 else "green" if risk_score > 0 else "gray"
        folium.Marker(
            location=[wb.latitude, wb.longitude],
            popup=folium.Popup(popup_html, max_width=350),
            tooltip=f"{wb.name}: Risk={risk_score:.1f} ({risk_level})",
            icon=folium.Icon(color=icon_color, icon="exclamation-triangle" if risk_score > 30 else "info-sign"),
        ).add_to(m)

    # Source marker (special)
    source_wb = WATER_BODIES["vrushabavathi_nayandahalli"]
    folium.Marker(
        location=[source_wb.latitude, source_wb.longitude],
        icon=folium.Icon(color="darkred", icon="warning-sign"),
        tooltip="POLLUTION SOURCE",
    ).add_to(m)

    legend_html = f"""
    <div style="position:fixed; bottom:30px; left:30px; z-index:1000;
         background:white; padding:12px 16px; border-radius:8px;
         box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:Arial; font-size:12px;">
        <b>Pollution Spread Model</b><br>
        <b>risk = score x e^(-0.2 x dist)</b><br><br>
        Source: Industrial Zone<br>
        Source WQI: {industrial_avg['score']:.1f}<br><br>
        <span style="color:#ef4444;">&#9679;</span> HIGH risk (>60)<br>
        <span style="color:#f97316;">&#9679;</span> MODERATE risk (30-60)<br>
        <span style="color:#f59e0b;">&#9679;</span> LOW risk (10-30)<br>
        <span style="color:#22c55e;">&#9679;</span> NEGLIGIBLE (<10)<br>
        <br>Circle size = risk magnitude<br>
        <i>Decay factor lambda = 0.2</i>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))
    folium.LayerControl().add_to(m)

    path = os.path.join(OUTPUT_DIR, "4_pollution_spread.html")
    m.save(path)
    print(f"    Saved: {path}")


def generate_combined_map():
    """Map 5: Everything on one map with layer controls."""
    print("  Generating combined overview map...")

    scorer = ContaminationScorer()
    source_id_inst = SourceIdentifier()
    detector = HotspotDetector(eps_meters=800, min_samples=3)

    center_lat = sum(sp.latitude for sp in ALL_SAMPLING_POINTS) / len(ALL_SAMPLING_POINTS)
    center_lon = sum(sp.longitude for sp in ALL_SAMPLING_POINTS) / len(ALL_SAMPLING_POINTS)

    m = folium.Map(location=[center_lat, center_lon], zoom_start=13, tiles="OpenStreetMap")

    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Esri World Imagery",
        name="Satellite View",
    ).add_to(m)

    # Layer: Water Body Network
    fg_network = folium.FeatureGroup(name="Water Body Network", show=True)
    drawn = set()
    for wb_id, neighbors in WATER_BODY_CONNECTIONS.items():
        wb = WATER_BODIES[wb_id]
        for nid, dist in neighbors:
            edge = tuple(sorted([wb_id, nid]))
            if edge in drawn:
                continue
            drawn.add(edge)
            nb = WATER_BODIES[nid]
            folium.PolyLine(
                locations=[[wb.latitude, wb.longitude], [nb.latitude, nb.longitude]],
                color="#3b82f6", weight=2, opacity=0.5, dash_array="8 4",
                tooltip=f"{dist:.1f} km",
            ).add_to(fg_network)

    for wb_id, wb in WATER_BODIES.items():
        folium.CircleMarker(
            location=[wb.latitude, wb.longitude],
            radius=5, color="#3b82f6", fill=True, fill_color="#3b82f6",
            fill_opacity=0.7, tooltip=f"{wb.name} ({wb.body_type})",
        ).add_to(fg_network)
    fg_network.add_to(m)

    # Layer: Sampling Points
    fg_samples = folium.FeatureGroup(name="Sampling Points", show=True)
    readings = []
    base_time = datetime.now(timezone.utc)
    for i, sp in enumerate(ALL_SAMPLING_POINTS):
        result = scorer.compute(sp.ph, sp.tds, sp.turbidity, sp.temperature)
        color = _score_color(result["score"])

        r = WaterReading(
            temperature=sp.temperature, tds=sp.tds, turbidity=sp.turbidity,
            latitude=sp.latitude, longitude=sp.longitude, rgb=sp.rgb, ph=sp.ph,
            timestamp=base_time + timedelta(seconds=i * 10),
        )
        r.contamination_score = result["score"]
        r.quality_label = result["quality_label"]
        readings.append(r)

        folium.CircleMarker(
            location=[sp.latitude, sp.longitude],
            radius=8, fill=True, fill_color=color, fill_opacity=0.8,
            color="#1e293b", weight=1,
            tooltip=f"{sp.sample_id}: WQI={result['score']:.0f} ({result['label']})",
        ).add_to(fg_samples)
    fg_samples.add_to(m)

    # Layer: Hotspot Clusters
    fg_hotspots = folium.FeatureGroup(name="Hotspot Clusters", show=True)
    clusters = detector.detect(readings)
    cluster_colors = ["#ef4444", "#f97316", "#eab308"]

    for idx, c in enumerate(clusters):
        cc = cluster_colors[idx % len(cluster_colors)]
        avg_tds = sum(r.tds for r in c.readings if r.tds) / len(c.readings)
        avg_turb = sum(r.turbidity for r in c.readings if r.turbidity) / len(c.readings)
        avg_ph = sum(r.ph for r in c.readings if r.ph) / len(c.readings)
        avg_temp = sum(r.temperature for r in c.readings if r.temperature) / len(c.readings)
        source = source_id_inst.identify(avg_tds, avg_turb, avg_ph, avg_temp)

        folium.Circle(
            location=[c.center[0], c.center[1]],
            radius=max(c.affected_radius_m * 1.5, 200),
            color=cc, fill=True, fill_color=cc, fill_opacity=0.12,
            weight=2, dash_array="5 5",
            tooltip=f"Cluster {c.cluster_id}: {source} ({c.severity})",
        ).add_to(fg_hotspots)
    fg_hotspots.add_to(m)

    folium.LayerControl(collapsed=False).add_to(m)

    # Title
    title_html = """
    <div style="position:fixed; top:10px; left:50%; transform:translateX(-50%); z-index:1000;
         background:white; padding:10px 20px; border-radius:8px;
         box-shadow:0 2px 8px rgba(0,0,0,0.2); font-family:Arial;">
        <b style="font-size:16px;">Vrushabavathi River Water Quality Assessment</b><br>
        <span style="font-size:12px;color:#64748b;">Near RVCE, Bangalore | 20 sampling points | 9 water bodies | 3 hotspots</span>
    </div>
    """
    m.get_root().html.add_child(folium.Element(title_html))

    path = os.path.join(OUTPUT_DIR, "5_combined_overview.html")
    m.save(path)
    print(f"    Saved: {path}")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("\n" + "=" * 60)
    print("  MAP GENERATION -- Vrushabavathi Case Study")
    print("=" * 60)
    print(f"  Output directory: {OUTPUT_DIR}\n")

    generate_sampling_map()
    generate_water_body_network_map()
    generate_hotspot_map()
    generate_spread_map()
    generate_combined_map()

    print("\n" + "=" * 60)
    print("  5 maps generated. Open HTML files in browser.")
    print("=" * 60)
    print(f"\n  Maps saved to: {OUTPUT_DIR}")
    print("  Files:")
    for f in sorted(os.listdir(OUTPUT_DIR)):
        if f.endswith(".html"):
            print(f"    - {f}")


if __name__ == "__main__":
    main()
