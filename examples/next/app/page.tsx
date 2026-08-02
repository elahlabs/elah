'use client'

import dynamic from 'next/dynamic'

// The editor touches browser-only APIs (Canvas, Web Audio, Workers), so it must
// render client-side only. `ssr: false` keeps it out of the server bundle.
const ProductionEditor = dynamic(
  () => import('@/components/ProductionEditor'),
  { ssr: false },
)

export default function Page() {
  return <ProductionEditor />
}
