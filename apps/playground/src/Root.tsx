import { Routes, Route, Link, useLocation } from 'react-router-dom'
import App from './App'
import TimelineOnlyPage from './pages/TimelineOnlyPage'
import FullEditorPage from './pages/FullEditorPage'

export default function Root() {
  const location = useLocation()

  const isMainPage = location.pathname === '/'
  const isTimelineOnly = location.pathname === '/timeline-only'
  const isFullEditor = location.pathname === '/full-editor'

  return (
    <>
      {/* Navigation bar */}
      <nav
        style={{
          padding: '12px 16px',
          background: '#0a0a0a',
          borderBottom: '1px solid #333',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        <Link
          to="/"
          style={{
            padding: '6px 12px',
            background: isMainPage ? '#e81c48' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          Full Editor (Main)
        </Link>

        <Link
          to="/timeline-only"
          style={{
            padding: '6px 12px',
            background: isTimelineOnly ? '#e81c48' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          Timeline Only Demo
        </Link>

        <Link
          to="/full-editor"
          style={{
            padding: '6px 12px',
            background: isFullEditor ? '#e81c48' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          Full Editor Demo
        </Link>

        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#999' }}>
          {location.pathname === '/' && '📋 Main editor with full playground features'}
          {location.pathname === '/timeline-only' && '⏱️ Standalone timeline validation'}
          {location.pathname === '/full-editor' && '🎬 Complete editor composition demo'}
        </div>
      </nav>

      {/* Routes */}
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/timeline-only" element={<TimelineOnlyPage />} />
        <Route path="/full-editor" element={<FullEditorPage />} />
      </Routes>
    </>
  )
}
