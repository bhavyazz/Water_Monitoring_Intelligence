# Intelligent Water Quality & Pollution Analysis System

A comprehensive IoT and ML-driven platform for real-time monitoring of river water quality, predictive algal bloom analysis, and pollution source identification. 

## Overview
This system integrates a high-fidelity React dashboard with a fast Python/FastAPI backend. It simulates and analyzes water sensor data to detect anomalies, track pollution plumes, predict algal blooms using Verhulst logistic growth models, and identify likely pollution sources using DBSCAN clustering and OSM reverse geocoding.

### Key Features
* **Real-time Monitoring:** Live tracking of TDS, Turbidity, Nitrate, and Temperature with severity gauges.
* **Deep Intelligence Modules:**
  * **Pollution DNA:** Chemical fingerprinting of pollution sources.
  * **River Timeline:** Historical replay of diurnal patterns and rain events.
  * **What-If Simulator:** Causal modeling of source intensity impacts.
  * **Contamination Web:** Force-directed network of causal relationships.
  * **Bloom Lab:** Living Petri dish simulation of algal growth.
  * **Cluster Intelligence:** Deep analysis of DBSCAN pollution clusters as evolving entities.
  * **Intelligence Report:** Auto-generated executive summaries.

## Tech Stack
* **Backend:** FastAPI, Scikit-learn, DBSCAN, Geopy
* **Frontend:** React 19, Vite, Recharts, Leaflet, D3
* **Data Flow:** In-memory circular buffers simulating high-frequency MQTT/serial data.

## Getting Started

### Prerequisites
* Python 3.9+
* Node.js 18+

### Running the Backend
```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the FastAPI server and data simulator
python main.py
```
The backend API will run on `http://127.0.0.1:8000`.

### Running the Frontend
```bash
# 1. Navigate to frontend directory
cd frontend

# 2. Install dependencies
npm install

# 3. Start the Vite dev server
npm run dev
```
The dashboard will be available at `http://localhost:5173`.

## Architecture & System Details
For a deep dive into the system's architecture, ML models, API endpoints, and clustering logic, please refer to the detailed **[SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)**.
