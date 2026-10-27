/// <reference lib="webworker" />
/**
 * Runs `probeScope` inside a module worker (PV-P8a).
 *
 * A worker scope can answer `ImageDecoder`/`VideoEncoder` questions
 * differently from the window that spawned it — this is exactly what
 * `runCapabilityProbe` compares. Any message in triggers one run; the result
 * (or `{ error }` on a throw) is posted back once.
 */

import { probeScope } from './capabilities'

self.onmessage = async () => {
  try {
    const result = await probeScope()
    self.postMessage(result)
  } catch (err) {
    self.postMessage({ error: String(err) })
  }
}
