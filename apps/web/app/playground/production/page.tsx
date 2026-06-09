'use client'

import dynamic from 'next/dynamic'

const ProductionEditor = dynamic(
  () => import('@/components/playground/ProductionEditor'),
  { ssr: false },
)

export default function ProductionPage() {
  return <ProductionEditor />
}
