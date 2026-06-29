'use client'

import { useEffect, useState } from 'react'
import type { TimelineProps } from '@elah/editor'
import { cn } from '@/lib/utils'
import { CodeBlock } from './CodeBlock'
import { buildThemeVars, buildThemeCss, THEME_RENDER_CODE } from './TimelineThemeMode'

/**
 * "Export Style" modal for the timeline playground — the read-only code output
 * for the two styling paths (classNames component + theme CSS). The editing UI
 * lives in the left config panel; this is purely the copy-paste payoff.
 */

type ClassNamesState = NonNullable<TimelineProps['classNames']>

/** Generate copy-paste JSX from the classNames selections. */
function buildGranularCode(classNames: ClassNamesState): string {
  const keys = Object.keys(classNames)
  const cnBlock = keys.length
    ? `\n      classNames={{\n${keys
        .map((k) => `        ${k}: '${classNames[k as keyof ClassNamesState]}',`)
        .join('\n')}\n      }}`
    : ''
  return `import { EditorProvider, Timeline } from '@elah/editor'

export function MyTimeline() {
  return (
    <EditorProvider fps={30}>
      <Timeline fps={30}${cnBlock} />
    </EditorProvider>
  )
}`
}

interface TimelineStyleExportProps {
  classNames: ClassNamesState
  themeValues: Record<string, string>
  onClose: () => void
}

export function TimelineStyleExport({
  classNames,
  themeValues,
  onClose,
}: TimelineStyleExportProps) {
  const [view, setView] = useState<'classNames' | 'theme'>('classNames')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const classNamesDirty = Object.keys(classNames).length > 0
  const themeVars = buildThemeVars(themeValues)
  const themeDirty = Object.keys(themeVars).length > 0

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col bg-ed-panel border-l border-ed-border font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ed-border px-4 py-2.5 shrink-0">
        <span className="text-[13px] font-bold tracking-[-0.01em] text-ed-text">
          Export Style
        </span>
        <button
          onClick={onClose}
          title="Close"
          className="cursor-pointer border-none bg-transparent p-0.5 text-lg leading-none text-ed-text-muted hover:text-ed-text"
        >
          ×
        </button>
      </div>

      {/* Path toggle — one at a time */}
      <div className="flex items-center gap-1 border-b border-ed-border px-4 py-2 shrink-0">
        {(['classNames', 'theme'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              view === v
                ? 'bg-ed-accent-soft text-ed-accent-hover'
                : 'text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated',
            )}
          >
            {v === 'classNames' ? 'classNames' : 'Theme CSS'}
          </button>
        ))}
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto px-4 py-3">
        <p className="text-[10px] leading-snug text-ed-text-muted/70">
          The two styling paths are alternatives — pick one. classNames is
          per-instance; Theme CSS is global `--elah-*` vars.
        </p>

        {view === 'classNames' ? (
          classNamesDirty ? (
            <CodeBlock label="Component" code={buildGranularCode(classNames)} />
          ) : (
            <p className="rounded-md border border-dashed border-ed-border bg-ed-bg px-3 py-4 text-center text-[11px] leading-snug text-ed-text-muted">
              Change something in the <span className="text-ed-text">Granular</span>{' '}
              tab to generate the classNames code.
            </p>
          )
        ) : themeDirty ? (
          <>
            <CodeBlock label="timeline-theme.css · full" code={buildThemeCss(themeVars)} />
            <CodeBlock label="Render" code={THEME_RENDER_CODE} />
          </>
        ) : (
          <p className="rounded-md border border-dashed border-ed-border bg-ed-bg px-3 py-4 text-center text-[11px] leading-snug text-ed-text-muted">
            Change a colour in the <span className="text-ed-text">Theme</span> tab to
            generate the CSS.
          </p>
        )}
      </div>
    </aside>
  )
}
