import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The SDK ships the CSS its components (Timeline, Preview, Asset/Elements
// panels) need. Import it first so our local index.css can still override.
import '@elah/editor/styles.css'
import './index.css'
import ProductionEditor from './components/ProductionEditor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductionEditor />
  </StrictMode>,
)
