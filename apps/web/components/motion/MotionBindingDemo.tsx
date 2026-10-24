'use client'

import dynamic from 'next/dynamic'
import { LoadOnView } from './LoadOnView'

const BindingExplainer = dynamic(() => import('./BindingExplainer'), { ssr: false })

/** Loads the engine only when the explainer scrolls into view. */
export function MotionBindingDemo() {
  return (
    <LoadOnView
      placeholder={
        <div className="flex h-[22rem] items-center justify-center bg-[var(--lp-card)] text-[15px] text-[var(--lp-muted)] [outline:1px_solid_var(--lp-line)] [outline-offset:-0.5px]">
          Source, keys and timeline load as you scroll here.
        </div>
      }
    >
      <BindingExplainer />
    </LoadOnView>
  )
}
