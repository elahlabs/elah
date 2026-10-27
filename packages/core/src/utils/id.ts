/** mulberry32: a small seeded generator. Exported for tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SeedScope { next: () => number; issued: Set<string> }
let scope: SeedScope | null = null

/** Generate a short random alphanumeric ID (8 characters). Seeded inside `withSeededIds`. */
export function generateId(): string {
  if (scope === null) return Math.random().toString(36).slice(2, 10) // unchanged legacy line
  for (;;) {
    let id = ''
    while (id.length < 8) id += Math.floor(scope.next() * 36).toString(36)
    if (!scope.issued.has(id)) {
      scope.issued.add(id)
      return id
    }
  }
}

/**
 * Run `fn` with `generateId()` drawing from mulberry32(seed): the same seed and
 * the same synchronous work give the same ids. Scopes nest (the outer stream
 * resumes after the inner one ends). `fn` must be synchronous: a returned
 * Promise (any thenable) throws, because ids generated after its first await
 * would silently not be seeded.
 */
export function withSeededIds<T>(seed: number, fn: () => T): T {
  const previous = scope
  scope = { next: mulberry32(seed), issued: new Set() }
  let out: T
  try {
    out = fn()
  } finally {
    scope = previous
  }
  if (out !== null && (typeof out === 'object' || typeof out === 'function') && typeof (out as { then?: unknown }).then === 'function') {
    throw new Error('withSeededIds: fn returned a Promise. Seeded ids are synchronous only.')
  }
  return out
}

/** True inside withSeededIds. For tests and assertions. */
export function seededIdsActive(): boolean {
  return scope !== null
}
