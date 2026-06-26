const API_BASE = 'http://localhost:8000';

async function api(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
  return res.json();
}

// Live pipeline endpoints
export const fetchLatest  = ()     => api('/data');
export const fetchHistory = (n=50) => api(`/history?n=${n}`);
export const fetchClusters = ()    => api('/clusters');
export const fetchAlerts  = ()     => api('/alerts');

// Field assessment endpoints
export const fetchSamples     = ()     => api('/samples');
export const fetchWaterBodies = ()     => api('/water-bodies');
export const fetchAnalysis    = ()     => api('/analysis');

export function submitSample(data) {
  return api('/samples', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function addWaterBody(data) {
  return api('/water-bodies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function connectWaterBodies(bodyA, bodyB, distanceKm) {
  return api('/water-bodies/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body_a: bodyA, body_b: bodyB, distance_km: distanceKm }),
  });
}

export function regenerateMaps() {
  return api('/analysis/maps', { method: 'POST' });
}

// Causality intelligence endpoints
export const fetchCausality        = () => api('/causality');
export const fetchCausalityHistory = () => api('/causality/history');

// Field analysis endpoints (AquaVision)
export const fetchBatchAnalysis     = () => api('/analysis/batch');
export const fetchCollectedSamples  = () => api('/analysis/collected-samples');
export function postLiveAnalysis(data) {
  return api('/analysis/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export function postSpreadAnalysis(data) {
  return api('/analysis/spread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function postSourceAnalysis(data) {
  return api('/analysis/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function postHistoricalSample(data) {
  return api('/analysis/historical_sample', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function postSetWaterBody(data) {
  return api('/analysis/set_water_body', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function streamLiveAnalysis(data, onStep) {
  const controller = new AbortController();
  fetch(`${API_BASE}/analysis/live/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: controller.signal,
  }).then(response => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    function process({ done, value }) {
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('data: ')) {
          try { onStep(JSON.parse(trimmed.slice(6))); } catch {}
        }
      }
      return reader.read().then(process);
    }
    return reader.read().then(process);
  }).catch(() => {});
  return controller;
}
