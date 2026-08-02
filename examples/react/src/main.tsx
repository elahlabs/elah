import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The SDK ships THREE stylesheets and you need all of them. Each package
// compiles its own — @elah/timeline's Tailwind build only scans its own source,
// so @elah/editor/styles.css does not contain the timeline's classes:
//
//   1. timeline/styles.css       — ruler, tracks, clips, playhead, trim handles
//   2. editor/styles.css         — Preview, AssetPanel, ElementsPanel, SourcePanel
//   3. editor/styles/tokens.css  — the 130+ --elah-* design tokens both consume
//
// Skip tokens.css only if your app already defines --elah-* inside .elah-root.
// Import your own CSS last so it can override.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@elah/editor/styles/tokens.css'
import './index.css'
import ProductionEditor from './components/ProductionEditor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductionEditor />
  </StrictMode>,
)
