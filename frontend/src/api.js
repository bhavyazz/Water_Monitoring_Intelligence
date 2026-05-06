const API_BASE = 'http://localhost:8000';

export async function fetchLatest() {
  const res = await fetch(`${API_BASE}/data`);
  return res.json();
}

export async function fetchHistory(n = 50) {
  const res = await fetch(`${API_BASE}/history?n=${n}`);
  return res.json();
}

export async function fetchClusters() {
  const res = await fetch(`${API_BASE}/clusters`);
  return res.json();
}

export async function fetchAlerts() {
  const res = await fetch(`${API_BASE}/alerts`);
  return res.json();
}
