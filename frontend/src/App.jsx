import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import { fetchLatest, fetchAlerts, fetchAnalysis } from './api'
import Dashboard from './pages/Dashboard'
import LiveData from './pages/LiveData'
import History from './pages/History'
import MapView from './pages/MapView'
import Alerts from './pages/Alerts'
import HotspotDetection from './pages/HotspotDetection'
import BloomIntelligence from './pages/BloomIntelligence'

const PollutionDNA = lazy(() => import('./pages/PollutionDNA'))
const IntelligenceReport = lazy(() => import('./pages/IntelligenceReport'))
const ClusterIntelligence = lazy(() => import('./pages/ClusterIntelligence'))
const CausalityIntelligence = lazy(() => import('./pages/CausalityIntelligence'))
const FieldAnalysis = lazy(() => import('./pages/FieldAnalysis'))

const I = {
  grid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  activity: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  factory: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><path d="M2 20h20"/><path d="M5 20V8l5 4V8l5 4V4h3v16"/></svg>,
  wind: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>,
  droplet: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>,
  map: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  dna: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/><path d="M2 9c6.667 6 13.333 0 20 6"/></svg>,
  timeline: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="8 8 12 12 8 16"/><circle cx="17" cy="12" r="2"/></svg>,
  sliders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
  network: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="6" y1="9" x2="12" y2="15"/><line x1="18" y1="9" x2="12" y2="15"/></svg>,
  petri: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><circle cx="12" cy="12" r="10"/><circle cx="8" cy="10" r="1.5" fill="currentColor" opacity="0.4"/><circle cx="14" cy="8" r="1" fill="currentColor" opacity="0.4"/><circle cx="16" cy="14" r="1.5" fill="currentColor" opacity="0.4"/><circle cx="10" cy="15" r="1" fill="currentColor" opacity="0.4"/></svg>,
  doc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>,
  hexagon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><circle cx="12" cy="12" r="3"/></svg>,
  target: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  causal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.5 11L16.5 7M7.5 13L16.5 17"/><path d="M14 7l3-1m0 0l-1 3M14 17l3 1m0 0l-1-3"/></svg>,
  field: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="icon"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>,
}

function SL({ to, icon, label, end }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>{I[icon]}{label}</NavLink>
}

function HeaderBar() {
  const [d, setD] = useState({ score: 0, alerts: 0, source: '--', time: '--', hotspots: 0 })
  useEffect(() => {
    const load = async () => {
      try {
        const [lat, alt, analysis] = await Promise.all([fetchLatest(), fetchAlerts(), fetchAnalysis()])
        const r = lat?.reading
        const sc = r?.contamination_score != null ? Math.round(100 - r.contamination_score) : (analysis?.summary ? Math.round(100 - (analysis.summary.unsafe * 100 + analysis.summary.moderate * 50) / Math.max(1, analysis.summary.total_samples)) : 0)
        const topSource = analysis?.clusters?.[0]?.pollution_source || '--'
        setD({ score: Math.max(0, Math.min(100, sc)), alerts: alt?.alert_count || 0, source: topSource, time: new Date().toLocaleTimeString(), hotspots: analysis?.summary?.hotspots || 0 })
      } catch {}
    }
    load(); const id = setInterval(load, 4000); return () => clearInterval(id)
  }, [])
  const sc = d.score > 70 ? '#44cc66' : d.score > 40 ? '#ffaa00' : '#ff4455'
  return (
    <div style={{ height: 44, background: 'var(--header-bg)', borderBottom: `1px solid var(--border)`, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 28, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="28" height="28" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" strokeWidth="3" /><circle cx="18" cy="18" r="14" fill="none" stroke={sc} strokeWidth="3" strokeDasharray={`${d.score * 0.88} 88`} strokeLinecap="round" transform="rotate(-90 18 18)" style={{ transition: 'stroke-dasharray 0.8s ease' }} /><text x="18" y="21" textAnchor="middle" fill={sc} fontSize="9" fontWeight="700" fontFamily="JetBrains Mono">{d.score}</text></svg>
        <span style={{ color: 'var(--text-secondary)' }}>Health</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--text-secondary)' }}>Hotspots:</span><span style={{ color: d.hotspots > 0 ? '#ff6644' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{d.hotspots}</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{d.alerts > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4455', animation: 'highPulse 1.2s infinite' }} />}<span style={{ color: d.alerts > 0 ? '#ff4455' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{d.alerts}</span><span style={{ color: 'var(--text-secondary)' }}>alerts</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--text-secondary)' }}>Source:</span><span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{d.source}</span></div>
      <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{d.time}</div>
    </div>
  )
}

const Loader = () => <div className="loading">Loading module...</div>

export default function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <HeaderBar />
      <div className="app-layout" style={{ flex: 1, height: 'calc(100vh - 44px)' }}>
        <aside className="sidebar">
          <div className="sidebar-brand"><h1>Water Monitor</h1><span>Vrushabavathi River, RVCE</span></div>
          <nav className="sidebar-nav">
            <SL to="/" icon="map" label="Overview Map" end />
            <SL to="/live" icon="activity" label="Live Sensor" />
            <div className="sidebar-section">Analysis</div>
            <SL to="/hotspots" icon="target" label="Hotspots" />
            <SL to="/bloom" icon="droplet" label="Bloom Risk" />
            <div className="sidebar-section">Live Pipeline</div>
            <SL to="/dashboard" icon="grid" label="Dashboard" />
            <SL to="/history" icon="clock" label="History" />
            <SL to="/alerts" icon="bell" label="Alerts" />
            <div className="sidebar-section">Deep Intelligence</div>
            <SL to="/dna" icon="dna" label="Pollution DNA" />
            <SL to="/report" icon="doc" label="Intel Report" />
            <SL to="/clusters" icon="hexagon" label="Cluster Intel" />
            <SL to="/causality" icon="causal" label="Causal Intel" />
            <div className="sidebar-section">Field Assessment</div>
            <SL to="/field" icon="field" label="Field Analysis" />
          </nav>
          <div className="sidebar-status"><span className="status-dot" /><span>System Online</span></div>
        </aside>
        <main className="main-content">
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/" element={<MapView />} />
              <Route path="/live" element={<LiveData />} />
              <Route path="/hotspots" element={<HotspotDetection />} />
              <Route path="/bloom" element={<BloomIntelligence />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/history" element={<History />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/dna" element={<PollutionDNA />} />
              <Route path="/report" element={<IntelligenceReport />} />
              <Route path="/clusters" element={<ClusterIntelligence />} />
              <Route path="/causality" element={<CausalityIntelligence />} />
              <Route path="/field" element={<FieldAnalysis />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
