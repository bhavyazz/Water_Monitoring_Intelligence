import { useState, useEffect } from 'react'
import { fetchClusters } from '../api'
import { FALLBACK_CLUSTERS, SEV_C } from '../data/clusterData'
import { ClusterAtlas, ClusterAnatomy } from './clusters/Tabs12'
import { ClusterEvolution, ClusterComparison } from './clusters/Tabs34'

const TABS = ['Atlas', 'Anatomy', 'Evolution', 'Comparison']

export default function ClusterIntelligence() {
  const [tab, setTab] = useState(0)
  const [clusters, setClusters] = useState(FALLBACK_CLUSTERS)
  const [selected, setSelected] = useState(0)
  const [tick, setTick] = useState(0)
  const [lastUpdate, setLastUpdate] = useState(Date.now())

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 50); return () => clearInterval(id) }, [])

  useEffect(() => {
    const load = () => fetchClusters().then(d => {
      if (d?.clusters?.length) {
        // Enrich with synthetic readings if none
        const enriched = d.clusters.map(c => {
          if (!c.readings || !c.readings.length) {
            const rs = []
            const n = c.reading_count || 5
            const sevMult = c.severity === 'HIGH' ? 1.5 : c.severity === 'MODERATE' ? 1 : 0.6
            for (let i = 0; i < n; i++) {
              rs.push({
                latitude: c.center[0] + (Math.random() - 0.5) * 0.002,
                longitude: c.center[1] + (Math.random() - 0.5) * 0.002,
                tds: 300 + Math.random() * 400 * sevMult,
                turbidity: 1.5 + Math.random() * 2.5 * sevMult,
                nitrate: 8 + Math.random() * 20 * sevMult,
                temperature: 24 + Math.random() * 8,
                timestamp: new Date(Date.now() - (n - i) * 120000).toISOString(),
              })
            }
            return { ...c, readings: rs }
          }
          return c
        })
        setClusters(enriched)
        setLastUpdate(Date.now())
      }
    }).catch(() => {})
    load()
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [])

  const critCount = clusters.filter(c => c.severity === 'HIGH').length
  const fastest = clusters.reduce((f, c) => (parseFloat(c.spread_speed) || 0) > (parseFloat(f?.spread_speed) || 0) ? c : f, clusters[0])
  const largest = clusters.reduce((l, c) => (parseFloat(c.affected_radius) || 0) > (parseFloat(l?.affected_radius) || 0) ? c : l, clusters[0])

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Cluster Intelligence — {clusters.length} active clusters</h2>
        <p>Deep analysis of DBSCAN pollution clusters as evolving entities</p>
      </div>

      {/* Status strip */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { l: 'Total', v: clusters.length, c: '#00d4ff' },
          { l: 'Critical', v: critCount, c: critCount > 0 ? '#ff4455' : '#333' },
          { l: 'Fastest', v: fastest ? `C${fastest.cluster_id} ${fastest.spread_speed}` : '--', c: '#ffaa00' },
          { l: 'Largest', v: largest ? `C${largest.cluster_id} ${largest.affected_radius}m` : '--', c: '#bb66ff' },
          { l: 'Updated', v: `${Math.floor((Date.now() - lastUpdate) / 1000)}s ago`, c: '#333' },
        ].map(s => (
          <div key={s.l} style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 6, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: '#333', textTransform: 'uppercase' }}>{s.l}</span>
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: s.c }}>{s.v}</span>
          </div>
        ))}
      </div>

      {/* Tab buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {TABS.map((t, i) => (
          <button key={t} className={`filter-btn${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 0 && <ClusterAtlas clusters={clusters} tick={tick} selected={selected} setSelected={setSelected} />}
      {tab === 1 && <ClusterAnatomy clusters={clusters} selected={selected} setSelected={setSelected} />}
      {tab === 2 && <ClusterEvolution />}
      {tab === 3 && <ClusterComparison clusters={clusters} />}
    </div>
  )
}
