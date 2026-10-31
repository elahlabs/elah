import { readFileSync } from 'node:fs'
import path from 'node:path'
import { label } from '@/components/eb'

/**
 * The editor's default --elah-* palette, read from the package's own
 * tokens.css at build time, so the swatches cannot drift from what ships.
 * `var(--elah-*)` references are resolved here, because the docs page does
 * not load tokens.css itself.
 */
function readTokens(): Map<string, string> {
  const file = path.join(process.cwd(), '../../packages/editor/src/styles/tokens.css')
  const css = readFileSync(file, 'utf8')
  const start = css.indexOf('.elah-root {')
  const block = css.slice(start, css.indexOf('\n}', start))
  const tokens = new Map<string, string>()
  for (const m of block.matchAll(/--elah-([\w-]+):\s*([^;]+);/g)) tokens.set(m[1], m[2].trim())
  const resolve = (v: string, depth = 0): string =>
    depth > 5 ? v : v.replace(/var\(--elah-([\w-]+)\)/g, (_, name: string) => resolve(tokens.get(name) ?? 'transparent', depth + 1))
  for (const [k, v] of tokens) tokens.set(k, resolve(v))
  return tokens
}

const GROUPS: [string, string[]][] = [
  ['Surfaces', ['bg', 'bg-secondary', 'bg-panel', 'bg-card', 'bg-elevated', 'bg-highest']],
  ['Lines & text', ['border', 'border-subtle', 'outline', 'text', 'text-muted', 'playhead']],
  ['Accent', ['accent', 'accent-hover', 'accent-dim', 'accent-glow', 'accent-soft', 'accent-text']],
]
const CLIPS = ['video', 'audio', 'text', 'image', 'shape', 'freehand']

export function TokenPalette() {
  const t = readTokens()
  return (
    <div className="my-6 border border-outline-variant">
      <div className={`border-b border-outline-variant bg-surface-low px-4 py-2 text-on-surface-variant ${label}`}>
        Default values, from tokens.css
      </div>
      <div className="flex flex-col gap-5 px-4 py-4">
        {GROUPS.map(([group, names]) => (
          <div key={group} className="flex flex-col gap-2">
            <span className={`text-on-surface ${label}`}>{group}</span>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {names.map((n) => (
                <div key={n} className="flex min-w-0 flex-col gap-1">
                  <span className="h-10 border border-outline-variant" style={{ background: t.get(n) }} />
                  <span className="truncate font-[family-name:var(--font-geist-mono),monospace] text-[11px] text-on-surface">{n}</span>
                  <span className="truncate font-[family-name:var(--font-geist-mono),monospace] text-[10px] text-on-surface-variant">{t.get(n)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-2">
          <span className={`text-on-surface ${label}`}>Clips · top → bottom gradient, accent</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CLIPS.map((c) => (
              <div key={c} className="flex items-center gap-2">
                <span
                  className="h-7 flex-1 border-l-[3px]"
                  style={{
                    background: `linear-gradient(${t.get(`clip-${c}-top`)}, ${t.get(`clip-${c}-mid`)}, ${t.get(`clip-${c}-bottom`)})`,
                    borderLeftColor: t.get(`clip-${c}-accent`),
                  }}
                />
                <span className="w-16 font-[family-name:var(--font-geist-mono),monospace] text-[11px] text-on-surface">{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
