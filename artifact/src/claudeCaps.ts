/**
 * The one place that reaches `window.claude`. Capabilities live behind `await claude.use(name)`; outside claude.ai
 * (local server, elah.dev) there is no `claude`, so every call resolves `null` and callers fall back.
 */
type Claude = { use?: (name: string) => Promise<unknown> }

const cache = new Map<string, Promise<unknown>>()

export function getCap<T = unknown>(name: string): Promise<T | null> {
  let p = cache.get(name)
  if (!p) {
    p = (async () => {
      try {
        const claude = (window as unknown as { claude?: Claude }).claude
        if (!claude || typeof claude.use !== 'function') return null
        return (await claude.use(name)) ?? null
      } catch {
        return null
      }
    })()
    cache.set(name, p)
  }
  return p as Promise<T | null>
}

export type CanSend = 'available' | 'writers_only' | 'no_session' | 'off'
export interface CommentsCap {
  anchorFor(el: Element): Promise<unknown>
  sendToClaude(target: { anchor: unknown; text: string }): Promise<unknown>
  canSendToClaude(): Promise<CanSend>
}

/**
 * TICKET-PF-17: the slice of the `sample` capability the Ask Claude box uses (contract: sample.d.ts). Calls are
 * memoryless; `tools` run here in the page; failures reject with `{code, message, text?}`.
 */
export type SampleTier = 'quick' | 'default' | 'complex'
export interface SampleTool {
  name: string
  description: string
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  execute(input: { [name: string]: unknown }, context: { signal: AbortSignal }): unknown
}
export interface SampleOptions {
  onText?: (update: { text: string; delta: string }) => void
  signal?: AbortSignal
  tools?: SampleTool[]
  modelTier?: SampleTier
}
export interface SampleResult {
  text: string
  truncated: boolean
  modelTierApplied?: SampleTier
}
export interface SampleError {
  code: string
  message: string
  text?: string
}
export interface SampleCap {
  (input: string, options?: SampleOptions): Promise<SampleResult>
  limits?: () => Promise<{ maxPromptBytes: number; tools?: { maxCount: number } }>
}
