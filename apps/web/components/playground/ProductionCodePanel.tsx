'use client'

import { useEffect } from 'react'
import { CodeBlock } from './CodeBlock'

/**
 * "Render Code" drawer for the production editor — a docked right sidebar
 * showing an idiomatic snippet for composing the editor with @elah/editor.
 * Playground-only; mirrors the timeline playground's Export Style drawer.
 */

const RENDER_CODE = `import {
  EditorProvider,
  AssetPanel,
  ElementsPanel,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
} from '@elah/editor'

// Token defaults + compiled component styles
import '@elah/editor/styles/tokens.css'
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'

export function ProductionEditor() {
  const demuxer = createDefaultDemuxerFactory()

  return (
    <EditorProvider fps={30} stage={{ width: 1920, height: 1080 }}>
      <div className="elah-root" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Source media + draggable elements */}
          <AssetPanel style={{ width: 280, flexShrink: 0 }} />
          <ElementsPanel style={{ width: 280, flexShrink: 0 }} />

          {/* GPU preview canvas */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Preview
              demuxerFactory={demuxer}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>

        {/* Frame-accurate timeline */}
        <Timeline fps={30} style={{ height: 220 }} />
      </div>
    </EditorProvider>
  )
}`

export function ProductionCodePanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col bg-ed-panel border-l border-ed-border font-sans">
      <div className="flex items-center justify-between border-b border-ed-border px-4 py-2.5 shrink-0">
        <span className="text-[13px] font-bold tracking-[-0.01em] text-ed-text">
          Render Code
        </span>
        <button
          onClick={onClose}
          title="Close"
          className="cursor-pointer border-none bg-transparent p-0.5 text-lg leading-none text-ed-text-muted hover:text-ed-text"
        >
          ×
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto px-4 py-3">
        <p className="text-[10px] leading-snug text-ed-text-muted/70">
          Compose the editor with the <code>@elah/editor</code> SDK — provider,
          panels, preview, and the timeline.
        </p>
        <CodeBlock label="ProductionEditor.tsx" code={RENDER_CODE} />
      </div>
    </aside>
  )
}
