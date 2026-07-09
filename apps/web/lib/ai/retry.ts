/**
 * fetch wrapper that retries on 429 (and 503) with backoff, honoring a
 * Retry-After header when present. Gemini's free tier is 10 RPM, so a couple of
 * short retries smooth over bursts without hanging the request.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 800

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(url, init)
    if (res.status !== 429 && res.status !== 503) return res
    if (attempt >= retries) return res

    const retryAfter = Number(res.headers.get('retry-after'))
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * 2 ** attempt
    // Abort promptly if the caller cancelled.
    if (init.signal?.aborted) return res
    await sleep(delay, init.signal)
    attempt += 1
  }
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
