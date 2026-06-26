import { useState, useEffect, useCallback } from 'react'
import { fetchLatest, fetchAlerts, fetchClusters, fetchHistory } from '../api'

// BIS 10500:2012 acceptable limits — the parameters the sensor actually measures.
const STANDARDS = {
  tds: { limit: 500, unit: 'ppm' },
  turbidity: { limit: 5, unit: 'NTU' },
  ph: { min: 6.5, max: 8.5, unit: '' },
  temperature: { limit: 35, unit: '°C' },
}

function trend(curr, prev) {
  if (!prev || !curr) return { arrow: '→', color: '#555', delta: 0 }
  const d = curr - prev
  if (Math.abs(d) < 0.5) return { arrow: '→', color: '#555', delta: d }
  return d > 0 ? { arrow: '↑', color: '#ff4455', delta: d } : { arrow: '↓', color: '#44cc66', delta: d }
}

export default function IntelligenceReport() {
  const [data, setData] = useState({ reading: null, alerts: null, clusters: null, history: [] })
  const [prevSnaps, setPrevSnaps] = useState([])
  const [lastUpdate, setLastUpdate] = useState(Date.now())
  const [ago, setAgo] = useState(0)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const [lat, alt, cls, hist] = await Promise.all([fetchLatest(), fetchAlerts(), fetchClusters(), fetchHistory(50)])
      const newData = { reading: lat?.reading, alerts: alt, clusters: cls?.clusters || [], history: hist?.readings || [] }
      setData(prev => {
        if (prev.reading) setPrevSnaps(ps => [{ ...prev, time: Date.now() }, ...ps].slice(0, 3))
        return newData
      })
      setLastUpdate(Date.now())
    } catch {}
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id) }, [load])
  useEffect(() => { const id = setInterval(() => setAgo(Math.floor((Date.now() - lastUpdate) / 1000)), 1000); return () => clearInterval(id) }, [lastUpdate])

  const r = data.reading || {}
  const cls = data.clusters || []
  const now = new Date().toLocaleString()
  const quality = r.quality_label || 'Unknown'
  const bloom = r.bloom_risk || 'Unknown'
  const dominantSrc = cls[0]?.probable_source || 'Unknown'

  // Real health = inverse of the pipeline's BIS WQI (contamination_score 0-100)
  const healthScore = Math.round(Math.max(0, Math.min(100, 100 - (r.contamination_score || 0))))
  const healthColor = healthScore > 70 ? '#44cc66' : healthScore > 40 ? '#ffaa00' : '#ff4455'

  const summary = `As of ${now}, the monitored river stretch shows ${quality} water quality with a health score of ${healthScore}/100. The dominant contamination source is ${dominantSrc}, contributing elevated parameter levels at ${cls.length} detected cluster(s). Algal bloom risk is currently ${bloom}. ${quality === 'Unsafe' ? 'Immediate action is recommended.' : 'Continued monitoring is advised.'}`

  const prevReading = prevSnaps[0]?.reading || {}

  const copySummary = () => { navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  /* Recommendations */
  const recs = []
  const phVal = r.ph
  if (phVal != null && (phVal < 6.5 || phVal > 8.5)) recs.push(`pH ${phVal.toFixed(1)} outside BIS range (6.5–8.5) — abnormal pH indicates industrial effluent; investigate upstream discharge.`)
  if ((r.tds || 0) > 500) recs.push('TDS above BIS limit — check for industrial/sewage discharge upstream and increase monitoring frequency.')
  if ((r.turbidity || 0) > 5) recs.push('Turbidity elevated — possible sediment runoff or sewage. Inspect land clearing / drain outfalls near the river.')
  if (bloom === 'HIGH') recs.push('High bloom risk — deploy aeration equipment and notify downstream water treatment facilities.')
  if (cls.length > 2) recs.push('Multiple pollution clusters detected — coordinate with local environmental authority for a joint inspection.')
  if (recs.length === 0) recs.push('All parameters within safe limits. Continue routine monitoring schedule.')

  return (
    <div className="page-fade">
      {/* Print-friendly styles */}
      <style>{`@media print { .sidebar, .no-print, header { display: none !important; } .main-content { padding: 20px !important; } .report-page { background: white !important; color: #222 !important; } .report-card { border-color: #ddd !important; background: #fafafa !important; } }`}</style>

      <div className="page-header no-print">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h2>Intelligence Report</h2><p>Auto-generated river health assessment — refreshes every 30s</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="filter-btn" onClick={copySummary}>{copied ? 'Copied' : 'Copy Summary'}</button>
            <button className="filter-btn" onClick={() => window.print()}>Download PDF</button>
            <button className="filter-btn" onClick={load}>Refresh Now</button>
            <span style={{ fontSize: 10, color: '#333', alignSelf: 'center' }}>Updated {ago}s ago</span>
          </div>
        </div>
      </div>

      {/* Report document */}
      <div className="report-page" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, maxWidth: 900 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>River Water Quality Assessment</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Monitoring Station: Bangalore Urban — {now}</div>
          </div>
          <span className={`badge badge-${quality.toLowerCase()}`} style={{ fontSize: 13, padding: '6px 14px' }}>{quality}</span>
        </div>

        {/* 1. Executive Summary */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bg-card)', marginBottom: 10 }}>1. Executive Summary</div>
          <p style={{ fontSize: 12, color: '#999', lineHeight: 1.8 }}>{summary}</p>
        </div>

        {/* 2. Parameter Status */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bg-card)', marginBottom: 10 }}>2. Parameter Status</div>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead><tr><th>Parameter</th><th>Current</th><th>BIS Limit</th><th>Status</th><th>Trend</th></tr></thead>
            <tbody>
              {[
                { key: 'tds', label: 'TDS' }, { key: 'turbidity', label: 'Turbidity' },
                { key: 'ph', label: 'pH' }, { key: 'temperature', label: 'Temperature' },
              ].map(p => {
                const val = r[p.key]
                const w = STANDARDS[p.key]
                const isRange = w.min != null
                const ok = val != null && (isRange ? (val >= w.min && val <= w.max) : val <= w.limit)
                const limitText = isRange ? `${w.min}–${w.max}` : `${w.limit} ${w.unit}`
                const t = trend(val, prevReading[p.key])
                return (
                  <tr key={p.key}>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.label}</td>
                    <td>{val?.toFixed(2) ?? '--'} {w.unit}</td>
                    <td>{limitText}</td>
                    <td><span className={`badge ${ok ? 'badge-safe' : 'badge-unsafe'}`}>{ok ? 'OK' : 'EXCEEDED'}</span></td>
                    <td style={{ color: t.color }}>{t.arrow} {t.delta !== 0 ? (t.delta > 0 ? '+' : '') + t.delta.toFixed(1) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* 3. Hotspot Summary */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bg-card)', marginBottom: 10 }}>3. Hotspot Summary</div>
          {cls.length > 0 ? (
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead><tr><th>Cluster</th><th>Center</th><th>Severity</th><th>Points</th><th>Spread</th><th>Source</th></tr></thead>
              <tbody>
                {cls.map(c => (
                  <tr key={c.cluster_id}>
                    <td>#{c.cluster_id}</td>
                    <td>{c.center?.[0]?.toFixed(4)}, {c.center?.[1]?.toFixed(4)}</td>
                    <td><span className={`badge badge-${c.severity?.toLowerCase()}`}>{c.severity}</span></td>
                    <td>{c.reading_count}</td>
                    <td>{c.spread_direction}</td>
                    <td>{c.probable_source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ fontSize: 12, color: '#555' }}>No clusters detected in current data window.</p>}
        </div>

        {/* 4. Source Attribution */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bg-card)', marginBottom: 10 }}>4. Source Attribution</div>
          {cls.length > 0 ? cls.map(c => (
            <div key={c.cluster_id} style={{ padding: '8px 0', borderBottom: '1px solid #151a28', fontSize: 12, color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>{c.probable_source}</strong> — Cluster #{c.cluster_id}, {c.reading_count} linked readings, {c.severity} severity, spreading {c.spread_direction}
            </div>
          )) : <p style={{ fontSize: 12, color: '#555' }}>Insufficient data for source attribution.</p>}
        </div>

        {/* 5. Bloom Assessment */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bg-card)', marginBottom: 10 }}>5. Bloom Assessment</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            Current algal bloom risk: <span className={`badge badge-${bloom.toLowerCase()}`}>{bloom}</span>.
            {' '}Drivers (BloomPredictor): pH {r.ph?.toFixed(1) ?? '--'}, Temperature {r.temperature?.toFixed(1) ?? '--'} °C, Turbidity {r.turbidity?.toFixed(1) ?? '--'} NTU.
            {bloom === 'HIGH' ? ' Warm, alkaline, clear water — bloom-favorable conditions present.' : bloom === 'MODERATE' ? ' Borderline conditions — monitor pH and temperature trends.' : ' Conditions not favorable for algal bloom.'}
          </p>
        </div>

        {/* 6. Recommendations */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bg-card)', marginBottom: 10 }}>6. Recommendations</div>
          <ul style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 2, paddingLeft: 20 }}>
            {recs.map((rec, i) => <li key={i}>{rec}</li>)}
          </ul>
        </div>

        {/* Health score footer */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: '#333' }}>Generated by Water Monitor Intelligence Engine</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#555' }}>Health Score:</span>
            <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: healthColor }}>{healthScore}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>/100</span>
          </div>
        </div>
      </div>
    </div>
  )
}
