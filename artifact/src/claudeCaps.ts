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
