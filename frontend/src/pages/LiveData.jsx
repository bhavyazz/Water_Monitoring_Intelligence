import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet'
import { fetchLatest, streamLiveAnalysis, postSetWaterBody } from '../api'
import 'leaflet/dist/leaflet.css'

const RVCE_CENTER = [12.9240, 77.4990]
const SUSTAIN_MS = 60000 // pollution must persist 60s before source/spread unlock

const wqsColor = (cls) => {
  if (cls === 'SEVERELY_POLLUTED') return '#ff2233'
  if (cls === 'POLLUTED') return '#ff6644'
  if (cls === 'MODERATE') return '#ffaa00'
  return '#44cc66'
}

// Map the live pipeline's WQI label (Safe/Moderate/Unsafe) to a color
const qualityColor = (label) => {
  if (label === 'Unsafe') return '#ff2233'
  if (label === 'Moderate') return '#ffaa00'
  return '#44cc66'
}

const sourceColors = {
  'Industrial Discharge': '#e74c3c',
  'Sewage Contamination': '#8B4513',
  'Agricultural Runoff': '#27ae60',
  'Solid Waste Leachate': '#7f8c8d',
}

// ── Animated number hook (requestAnimationFrame, ease-out cubic) ──
function useAnimatedNumber(target, duration = 400) {
  const [display, setDisplay] = useState(target)
  const ref = useRef({ current: target, target, raf: null })
  useEffect(() => {
    if (target === ref.current.target && ref.current.current === target) return
    const startVal = ref.current.current
    const startTime = performance.now()
    ref.current.target = target
    function animate(now) {
      const progress = Math.min(1, (now - startTime) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const val = startVal + (target - startVal) * eased
      ref.current.current = val
      setDisplay(val)
      if (progress < 1) ref.current.raf = requestAnimationFrame(animate)
    }
    if (ref.current.raf) cancelAnimationFrame(ref.current.raf)
    ref.current.raf = requestAnimationFrame(animate)
    return () => { if (ref.current.raf) cancelAnimationFrame(ref.current.raf) }
  }, [target, duration])
  return display
}

function Typewriter({ text, speed = 25 }) {
  const [shown, setShown] = useState('')
  const idRef = useRef(null)
  useEffect(() => {
    setShown('')
    let i = 0
    idRef.current = setInterval(() => {
      i++
      setShown(text.slice(0, i))
      if (i >= text.length) clearInterval(idRef.current)
    }, speed)
    return () => clearInterval(idRef.current)
  }, [text, speed])
  return <span>{shown}<span style={{ opacity: shown.length < text.length ? 1 : 0 }}>▌</span></span>
}

function AutoPan({ lat, lon }) {
  const map = useMap()
  const moved = useRef(false)
  useEffect(() => {
    if (lat && lon && !moved.current) { map.setView([lat, lon], 15, { animate: true }); moved.current = true }
  }, [lat, lon, map])
  return null
}

function fmt(v, d = 1) {
  if (v == null || isNaN(v)) return '--'
  return Number(v).toFixed(d)
}

function StripValue({ value, decimals = 1, color = 'var(--text-primary)' }) {
  const animated = useAnimatedNumber(value || 0)
  return <span className="strip-value" style={{ color }}>{fmt(animated, decimals)}</span>
}

function RadarAnimation() {
  return (
    <div className="radar-container">
      <div className="radar-center" />
      <div className="radar-ring" /><div className="radar-ring" /><div className="radar-ring" />
    </div>
  )
}

function PipelineStep({ number, title, state, statusText, children }) {
  return (
    <div className={`pipeline-step step-${state}`}>
      <div className="step-header">
        <div className="step-number">{state === 'complete' ? '✓' : state === 'failed' ? '!' : number}</div>
        <div className="step-title">{title}</div>
        <div className="step-status">{statusText || state.toUpperCase()}</div>
      </div>
      {(state === 'running' || state === 'complete' || state === 'failed') && children && (
        <div className="step-body">{children}</div>
      )}
    </div>
  )
}

function SourceBars({ scores }) {
  if (!scores) return null
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1])
  return (
    <div style={{ marginTop: 8 }}>
      {entries.map(([label, score], i) => (
        <div key={label} className="source-bar-row" style={{ animationDelay: `${i * 60}ms` }}>
          <span className="source-bar-label">{label}</span>
          <div className="source-bar-track">
            <div className="source-bar-fill" style={{ width: `${score * 100}%`, background: sourceColors[label] || 'var(--accent)' }} />
          </div>
          <span className="source-bar-value">{(score * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  )
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// ═══════════════════════════════════════════════════════════════════
export default function LiveData() {
  const [reading, setReading] = useState(null)
  const [testMode, setTestMode] = useState(false)
  const [manual, setManual] = useState({ tds: 650, turbidity: 14, ph: 7.2, temperature: 28 })
  const [now, setNow] = useState(Date.now())
  const pollutedSinceRef = useRef(null)
  const [pollutedSince, setPollutedSince] = useState(null)

  // Analysis state (button-triggered)
  const [steps, setSteps] = useState({
    waterBody: { state: 'waiting', data: null },
    source: { state: 'waiting', data: null, features: [] },
    spread: { state: 'waiting', data: null },
    hotspot: { state: 'waiting', data: null },
  })
  const [reveal, setReveal] = useState({ source: false, spread: false })
  const [spreadPath, setSpreadPath] = useState([])
  const [visibleSpreadSegs, setVisibleSpreadSegs] = useState(0)
  const [spreadRows, setSpreadRows] = useState([])
  const [mapGeometry, setMapGeometry] = useState([])
  const [wbForm, setWbForm] = useState({ type: 'river', velocity: 0.4 })
  const analyzedKeyRef = useRef(null)
  const streamRef = useRef(null)
  const [lastBadge, setLastBadge] = useState('')
  const prevLabelRef = useRef(null)

  // Poll sensor every 3s
  useEffect(() => {
    const load = () => fetchLatest().then(d => setReading(d?.reading)).catch(() => {})
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  // 1s tick for the sustain timer
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const realR = reading || {}
  const gpsLat = realR.latitude ?? RVCE_CENTER[0]
  const gpsLon = realR.longitude ?? RVCE_CENTER[1]
  // In test mode the reading is the user-entered values at the live GPS point.
  const r = testMode
    ? { ...manual, latitude: gpsLat, longitude: gpsLon, timestamp: realR.timestamp }
    : realR
  const label = testMode ? 'Manual' : (r.quality_label || 'Safe')   // real pipeline WQI label
  const wqi = testMode ? null : (r.contamination_score ?? 0)        // real WQI 0-100
  const isPolluted = testMode ? true : (label === 'Moderate' || label === 'Unsafe')

  // Track sustained pollution
  useEffect(() => {
    if (isPolluted) {
      if (pollutedSinceRef.current == null) {
        pollutedSinceRef.current = Date.now()
        setPollutedSince(pollutedSinceRef.current)
      }
    } else {
      if (pollutedSinceRef.current != null) {
        pollutedSinceRef.current = null
        setPollutedSince(null)
      }
    }
  }, [isPolluted])

  const elapsed = pollutedSince ? now - pollutedSince : 0
  const sustained = testMode || (isPolluted && elapsed >= SUSTAIN_MS)
  const remaining = Math.max(0, Math.ceil((SUSTAIN_MS - elapsed) / 1000))

  // Badge pulse on label change
  useEffect(() => {
    if (label !== prevLabelRef.current) {
      prevLabelRef.current = label
      setLastBadge('pulse-once')
      const t = setTimeout(() => setLastBadge(''), 600)
      return () => clearTimeout(t)
    }
  }, [label])

  // ── SSE step handler ──
  const handleStep = useCallback((event) => {
    const { step, data, error } = event
    switch (step) {
      case 'searching':
        setSteps(p => ({ ...p, waterBody: { ...p.waterBody, state: 'running' } }))
        break
      case 'water_body':
        setSteps(p => ({
          ...p,
          waterBody: { state: data.type === 'not_found' ? 'failed' : 'complete', data },
          source: { ...p.source, state: 'running' },
          spread: { ...p.spread, state: 'running' },
        }))
        if (data.geometry) setMapGeometry(data.geometry)
        break
      case 'features':
        setSteps(p => ({ ...p, source: { ...p.source, features: data || [] } }))
        break
      case 'source':
        setSteps(p => ({ ...p, source: { state: 'complete', data, features: p.source.features } }))
        break
      case 'spread':
        if (error) { setSteps(p => ({ ...p, spread: { state: 'failed', data: null } })); break }
        setSteps(p => ({ ...p, spread: { state: 'complete', data } }))
        if (data?.predictions) {
          const preds = data.predictions.filter(x => x.downstream_lat)
          setSpreadPath(preds)
          preds.forEach((_, i) => setTimeout(() => setVisibleSpreadSegs(i + 1), i * 150))
          data.predictions.forEach((pp, i) => setTimeout(() => setSpreadRows(prev => [...prev, pp]), i * 200))
        }
        break
      case 'hotspot':
        setSteps(p => ({ ...p, hotspot: { state: 'complete', data } }))
        break
    }
  }, [])

  // ── Run analysis for current point ──
  const runAnalysis = useCallback((which) => {
    if (!r.tds || !r.latitude) return
    const key = `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}|${r.tds},${r.turbidity},${r.ph}`

    // Already analyzed this exact point — just reveal the section
    if (analyzedKeyRef.current === key) {
      setReveal(prev => ({ ...prev, [which]: true }))
      return
    }

    if (streamRef.current) streamRef.current.abort()
    analyzedKeyRef.current = key

    setSteps({
      waterBody: { state: 'waiting', data: null },
      source: { state: 'waiting', data: null, features: [] },
      spread: { state: 'waiting', data: null },
      hotspot: { state: 'waiting', data: null },
    })
    setSpreadPath([]); setVisibleSpreadSegs(0); setSpreadRows([]); setMapGeometry([])
    setReveal({ source: which === 'source', spread: which === 'spread' })

    streamRef.current = streamLiveAnalysis({
      tds: r.tds, turbidity: r.turbidity || 0, ph: r.ph || 7.0,
      temperature: r.temperature || 25.0, lat: r.latitude, lon: r.longitude,
    }, handleStep)
  }, [r.tds, r.latitude, r.longitude, r.turbidity, r.ph, r.temperature, handleStep])

  // Water body override (when not found)
  const handleWbOverride = async () => {
    setSteps(p => ({ ...p, source: { state: 'running', data: null, features: [] }, spread: { state: 'running', data: null } }))
    setSpreadRows([]); setSpreadPath([]); setVisibleSpreadSegs(0)
    try {
      const res = await postSetWaterBody({
        tds: r.tds, turbidity: r.turbidity || 0, ph: r.ph || 7.0, temperature: r.temperature || 25.0,
        lat: r.latitude, lon: r.longitude, water_body_type: wbForm.type, flow_velocity_ms: wbForm.velocity,
      })
      if (res.source) setSteps(p => ({ ...p, source: { state: 'complete', data: res.source, features: p.source.features } }))
      if (res.spread) {
        setSteps(p => ({ ...p, spread: { state: 'complete', data: res.spread } }))
        if (res.spread.predictions) {
          res.spread.predictions.forEach((pp, i) => setTimeout(() => setSpreadRows(prev => [...prev, pp]), i * 200))
          const preds = res.spread.predictions.filter(x => x.downstream_lat)
          preds.forEach((_, i) => setTimeout(() => setVisibleSpreadSegs(i + 1), i * 150))
          setSpreadPath(preds)
        }
      }
      if (res.hotspot_status) setSteps(p => ({ ...p, hotspot: { state: 'complete', data: res.hotspot_status } }))
    } catch {
      setSteps(p => ({ ...p, source: { ...p.source, state: 'failed' }, spread: { ...p.spread, state: 'failed' } }))
    }
  }

  const classColor = qualityColor(label)
  const src = steps.source

  return (
    <div className="page-fade" style={{ paddingBottom: 40 }}>
      {/* ═══ ZONE 1: Sticky strip ═══ */}
      <div className="sticky-strip">
        <div className="strip-grid">
          <StripValue value={r.tds} decimals={0} color="#2090b0" /><span className="strip-unit" style={{ marginRight: 8 }}>TDS</span>
          <StripValue value={r.turbidity} decimals={1} color="#888" /><span className="strip-unit" style={{ marginRight: 8 }}>NTU</span>
          <StripValue value={r.ph} decimals={1} color="#6c5ce7" /><span className="strip-unit" style={{ marginRight: 8 }}>pH</span>
          <StripValue value={r.temperature} decimals={1} color="#27ae60" /><span className="strip-unit" style={{ marginRight: 8 }}>°C</span>
          <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />
          <StripValue value={wqi} decimals={0} color={classColor} /><span className="strip-unit">WQI</span>
          <span className={`strip-badge ${lastBadge}`} style={{ background: `${classColor}18`, color: classColor }}>{label}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="live-dot" />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.latitude?.toFixed(4)}, {r.longitude?.toFixed(4)}</span>
          </div>
        </div>
      </div>

      <div className="page-header" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Live Sensor</h2>
            <p>Current point monitoring — source &amp; spread analysis on demand</p>
          </div>
          <button className="filter-btn" onClick={() => setTestMode(t => !t)}
            style={testMode ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}>
            {testMode ? 'Test mode ON' : 'Manual test point'}
          </button>
        </div>
      </div>

      {/* Manual test point — user-entered values, real engines run on them */}
      {testMode && (
        <div className="wb-override-form" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Manual test point — enter values, runs the real engines at the live GPS ({gpsLat.toFixed(4)}, {gpsLon.toFixed(4)}). Buttons unlock immediately (60s wait bypassed for testing).
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              ['tds', 'TDS ppm', 0, 1500, 10],
              ['turbidity', 'Turbidity NTU', 0, 50, 0.5],
              ['ph', 'pH', 0, 14, 0.1],
              ['temperature', 'Temp °C', 0, 45, 0.5],
            ].map(([k, lbl, min, max, step]) => (
              <div key={k}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>{lbl}</label>
                <input type="number" min={min} max={max} step={step} value={manual[k]}
                  onChange={e => setManual(m => ({ ...m, [k]: parseFloat(e.target.value) || 0 }))}
                  style={{ width: 100, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Verdict / sustain gate ═══ */}
      <div style={{
        background: 'var(--bg-card)', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${!isPolluted ? '#44cc66' : sustained ? classColor : '#ffaa00'}`,
      }}>
        {!isPolluted && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#44cc66' }}>SAFE — within BIS limits</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              WQI {fmt(wqi, 0)}/100 · {label}. No contamination at this point.
            </div>
          </>
        )}

        {isPolluted && !sustained && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#ffaa00' }}>
              MONITORING — confirming sustained pollution
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              {label} detected (WQI {fmt(wqi, 0)}). Waiting {remaining}s of continuous pollution before unlocking source &amp; spread. Resets if it clears.
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginTop: 8, maxWidth: 320 }}>
              <div style={{ height: '100%', width: `${(elapsed / SUSTAIN_MS) * 100}%`, background: '#ffaa00', borderRadius: 3, transition: 'width 1s linear' }} />
            </div>
          </>
        )}

        {isPolluted && sustained && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: classColor }}>
              CONFIRMED — {label} sustained &gt;60s
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              WQI {fmt(wqi, 0)}/100. Run source &amp; spread analysis for this point.
            </div>
          </>
        )}
      </div>

      {/* ═══ Action buttons ═══ */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <button className="action-btn" disabled={!sustained}
          onClick={() => runAnalysis('source')}
          title={sustained ? '' : 'Unlocks after 60s sustained pollution'}>
          Identify Source
        </button>
        <button className="action-btn" disabled={!sustained}
          onClick={() => runAnalysis('spread')}
          style={{ background: sustained ? 'var(--text-secondary)' : undefined }}
          title={sustained ? '' : 'Unlocks after 60s sustained pollution'}>
          Estimate Spread
        </button>
        {!sustained && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
            {isPolluted ? `unlocks in ${remaining}s` : 'point is clean — nothing to analyze'}
          </span>
        )}
      </div>

      {/* ═══ ZONE 2: Animated analysis (only after a button is pressed) ═══ */}
      {(reveal.source || reveal.spread) && (
        <div className="pipeline-steps">
          {/* Water Body — shared, shown for either */}
          <PipelineStep number={1} title="Water Body Detection" state={steps.waterBody.state}
            statusText={
              steps.waterBody.state === 'running' ? 'Searching Overpass...' :
              steps.waterBody.state === 'complete' ? steps.waterBody.data?.name :
              steps.waterBody.state === 'failed' ? 'Not found within 1.5km' : 'Waiting'
            }>
            {steps.waterBody.state === 'running' && (
              <div style={{ textAlign: 'center' }}>
                <RadarAnimation />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Searching at {r.latitude?.toFixed(4)}, {r.longitude?.toFixed(4)}
                </div>
              </div>
            )}
            {steps.waterBody.state === 'complete' && steps.waterBody.data && (
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{steps.waterBody.data.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {steps.waterBody.data.waterway_type} — {steps.waterBody.data.type === 'on_waterway' ? 'on waterway' : `${steps.waterBody.data.distance_m}m away`}
                  </div>
                </div>
                {steps.waterBody.data.geometry?.length > 0 && (
                  <div style={{ fontSize: 10, color: '#2090b0', fontFamily: 'var(--font-mono)' }}>{steps.waterBody.data.geometry.length} nodes</div>
                )}
              </div>
            )}
            {steps.waterBody.state === 'failed' && (
              <div className="wb-override-form">
                <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 6 }}>No waterway found. Identify it to continue:</div>
                <select className="wb-select" value={wbForm.type} onChange={e => setWbForm(f => ({ ...f, type: e.target.value }))}>
                  {['river', 'stream', 'lake', 'pond', 'canal', 'well', 'stagnant'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="wb-slider-row">
                  <label>Flow velocity</label>
                  <input type="range" min="0" max="1.5" step="0.05" value={wbForm.velocity} onChange={e => setWbForm(f => ({ ...f, velocity: parseFloat(e.target.value) }))} />
                  <span className="wb-slider-value">{wbForm.velocity.toFixed(2)} m/s</span>
                </div>
                <button className="action-btn" style={{ fontSize: 11, padding: '6px 14px', width: '100%' }} onClick={handleWbOverride}>Confirm &amp; Continue</button>
              </div>
            )}
          </PipelineStep>

          {/* Source — only if source button pressed */}
          {reveal.source && (
            <PipelineStep number={2} title="Source Identification" state={src.state}
              statusText={src.state === 'running' ? 'Querying upstream land use...' : src.state === 'complete' ? src.data?.source : 'Waiting for water body'}>
              {src.state === 'running' && (
                <div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', background: 'var(--accent)', width: '60%', animation: 'skeletonPulse 1.2s ease-in-out infinite' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Overpass land-use within 300m, chemical fingerprint...</div>
                </div>
              )}
              {src.features.length > 0 && (
                <div style={{ marginTop: 6, marginBottom: 6 }}>
                  {src.features.map((f, i) => (
                    <span key={i} className={`osm-tag ${f.upstream === true ? 'upstream' : f.upstream === false ? 'downstream' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
                      {f.tag}{f.distance_m != null && ` ${f.distance_m}m`}{f.upstream === true && ' ↑'}
                    </span>
                  ))}
                </div>
              )}
              {src.state === 'complete' && src.data && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{ padding: '6px 12px', borderRadius: 8, background: `${sourceColors[src.data.source] || 'var(--accent)'}15`, borderLeft: `3px solid ${sourceColors[src.data.source] || 'var(--accent)'}` }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: sourceColors[src.data.source] || 'var(--accent)' }}>{src.data.source}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{src.data.description}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: sourceColors[src.data.source] || 'var(--accent)' }}>{(src.data.confidence * 100).toFixed(0)}%</div>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Confidence</div>
                    </div>
                    {src.data.ambiguous && <div style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(212,160,23,0.12)', color: '#b8860b', fontSize: 10, fontWeight: 600 }}>AMBIGUOUS</div>}
                  </div>
                  <SourceBars scores={src.data.scores} />
                  {src.data.chemical_evidence?.map((e, i) => (
                    <div key={i} style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>• {e}</div>
                  ))}
                  <div style={{ fontSize: 9, color: src.data.upstream_filtered ? '#2090b0' : 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                    {src.data.upstream_filtered ? 'OSM filtered to upstream features (flow-aware)' :
                     src.data.proximity_available ? 'Chemical + OSM proximity' : 'Chemical evidence only (no OSM features upstream)'}
                  </div>
                </div>
              )}
            </PipelineStep>
          )}

          {/* Spread — only if spread button pressed */}
          {reveal.spread && (
            <PipelineStep number={3} title="Spread Estimation" state={steps.spread.state}
              statusText={
                steps.spread.state === 'running' ? 'Tracing downstream...' :
                steps.spread.state === 'complete' && steps.spread.data?.safe_distance_m ? `Safe at ${steps.spread.data.safe_distance_m}m` :
                steps.spread.state === 'complete' ? '>2km contaminated' : 'Waiting for water body'
              }>
              {steps.spread.state === 'running' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {[50, 100, 200, 300, 500].map(d => <div key={d} className="skeleton" style={{ width: 50, height: 16 }} />)}
                </div>
              )}
              {steps.spread.state === 'complete' && steps.spread.data && (
                <div>
                  {r.latitude && spreadPath.length > 0 && (
                    <div style={{ height: 180, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', marginTop: 8, marginBottom: 12 }}>
                      <MapContainer center={[r.latitude, r.longitude]} zoom={14} scrollWheelZoom={false} zoomControl={false} style={{ height: '100%', width: '100%' }}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <CircleMarker center={[r.latitude, r.longitude]} radius={6} pathOptions={{ fillColor: '#ff2233', fillOpacity: 0.9, color: '#fff', weight: 2 }} />
                        {spreadPath.slice(0, visibleSpreadSegs).map((p, i) => (
                          <CircleMarker key={i} center={[p.downstream_lat, p.downstream_lon]} radius={4} pathOptions={{ fillColor: wqsColor(p.classification), fillOpacity: 0.7, color: '#000', weight: 0.5 }}>
                            <Popup><div style={{ fontSize: 11 }}>{p.distance_m}m — {(p.predicted_wqs * 100).toFixed(0)}% — {p.classification}</div></Popup>
                          </CircleMarker>
                        ))}
                        {steps.spread.data.downstream_path?.length > 1 && (
                          <Polyline positions={steps.spread.data.downstream_path} pathOptions={{ color: '#2090b0', weight: 2, opacity: 0.5, dashArray: '6 4' }} />
                        )}
                      </MapContainer>
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Distance', 'Travel', 'WQS', 'Status'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {spreadRows.map((p, i) => (
                        <tr key={i} className="spread-row-animate" style={{ borderBottom: '1px solid var(--border)', animationDelay: `${i * 80}ms` }}>
                          <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{p.distance_m}m</td>
                          <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{p.travel_time_min}min</td>
                          <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: wqsColor(p.classification) }}>{(p.predicted_wqs * 100).toFixed(1)}%</td>
                          <td style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', color: wqsColor(p.classification) }}>{p.classification?.replace(/_/g, ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {steps.spread.data.safe_distance_m && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#44cc66', fontWeight: 600 }}>Safe distance: {steps.spread.data.safe_distance_m}m downstream</div>
                  )}
                  <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Parameters: </span>
                    v={steps.spread.data.flow_velocity_ms} m/s, D={steps.spread.data.dispersion_coefficient} m²/s, k={steps.spread.data.decay_rate} /s
                  </div>
                  {steps.spread.data.assumptions && (
                    <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.5 }}>{steps.spread.data.assumptions}</div>
                  )}
                </div>
              )}
            </PipelineStep>
          )}

          {/* Hotspot context — appears after either run */}
          {steps.hotspot.state === 'complete' && steps.hotspot.data && (
            <PipelineStep number={4} title="Hotspot Context" state="complete" statusText={steps.hotspot.data.status?.replace(/_/g, ' ')}>
              <div>
                <span style={{
                  display: 'inline-block', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                  background: steps.hotspot.data.status?.includes('HOTSPOT') ? 'rgba(255,34,51,0.12)' : steps.hotspot.data.status?.includes('ANOMALY') ? 'rgba(255,102,68,0.12)' : 'rgba(39,174,96,0.12)',
                  color: steps.hotspot.data.status?.includes('HOTSPOT') ? '#ff2233' : steps.hotspot.data.status?.includes('ANOMALY') ? '#ff6644' : '#44cc66',
                }}>{steps.hotspot.data.status?.replace(/_/g, ' ')}</span>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 6 }}>
                  <Typewriter text={steps.hotspot.data.reasoning || ''} />
                </div>
              </div>
            </PipelineStep>
          )}
        </div>
      )}

      {/* ═══ ZONE 3: Map ═══ */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Map</div>
      <div className="map-container" style={{ height: 'calc(100vh - 500px)', minHeight: 320, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <MapContainer center={r.latitude ? [r.latitude, r.longitude] : RVCE_CENTER} zoom={15} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {r.latitude && <AutoPan lat={r.latitude} lon={r.longitude} />}
          {r.latitude && (
            <>
              <CircleMarker center={[r.latitude, r.longitude]} radius={12} pathOptions={{ fillColor: classColor, fillOpacity: 0.15, color: classColor, weight: 1.5 }} />
              <CircleMarker center={[r.latitude, r.longitude]} radius={6} pathOptions={{ fillColor: classColor, fillOpacity: 0.9, color: '#fff', weight: 2 }}>
                <Popup><div><strong>Current Reading</strong><br />TDS {r.tds} · Turb {r.turbidity} · pH {r.ph?.toFixed(1)}<br />WQI {fmt(wqi, 0)} — {label}</div></Popup>
              </CircleMarker>
            </>
          )}
          {mapGeometry.length > 1 && <Polyline positions={mapGeometry} pathOptions={{ color: '#2090b0', weight: 3, opacity: 0.6 }} />}
          {r.latitude && visibleSpreadSegs > 0 && (() => {
            const pts = [[r.latitude, r.longitude], ...spreadPath.slice(0, visibleSpreadSegs).map(p => [p.downstream_lat, p.downstream_lon])]
            return <Polyline positions={pts} pathOptions={{ color: '#ff6644', weight: 2, opacity: 0.7, dashArray: '4 4' }} />
          })()}
          {spreadPath.slice(0, visibleSpreadSegs).map((p, i) => (
            <CircleMarker key={`sp-${i}`} center={[p.downstream_lat, p.downstream_lon]} radius={5} pathOptions={{ fillColor: wqsColor(p.classification), fillOpacity: 0.8, color: '#000', weight: 0.5 }}>
              <Popup><div style={{ fontSize: 11 }}>{p.distance_m}m — {(p.predicted_wqs * 100).toFixed(0)}% — {p.classification?.replace(/_/g, ' ')}</div></Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
        Last: {r.timestamp ? new Date(r.timestamp).toLocaleString() : '--'}
      </div>
    </div>
  )
}
