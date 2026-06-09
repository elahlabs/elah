import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ProductionEditor from './components/ProductionEditor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductionEditor />
  </StrictMode>,
)
