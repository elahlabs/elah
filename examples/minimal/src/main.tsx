import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// ─── The three SDK stylesheets. You need ALL THREE. ──────────────────────────
//
// Each package compiles its own stylesheet from its own source, so they do not
// contain each other's classes:
//
//   1. @elah/timeline/styles.css      — ruler, tracks, clips, playhead, trim handles
//   2. @elah/editor/styles.css        — Preview, AssetPanel, ElementsPanel, SourcePanel
//   3. @elah/editor/styles/tokens.css — the 130+ --elah-* design tokens both read
//
// Import tokens.css unless your app already defines --elah-* inside `.elah-root`.
// Import your own CSS last so it wins.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@elah/editor/styles/tokens.css'
import './index.css'

import Editor from './Editor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
)
