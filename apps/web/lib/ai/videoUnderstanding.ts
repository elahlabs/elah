/**
 * Video understanding provider — watches a video and returns timestamped events.
 *
 * Stage 1 of the AI edit agent: given a video and a natural-language target
 * ("where the person says Hi", "where they jump"), return the moments that match
 * as { label, startSec, endSec?, confidence }. Stage 2 (editPlanner) turns those
 * into EditCommands.
 *
 * The interface is provider-agnostic; the default implementation is Gemini 3
 * Flash (free tier, native video + timestamps). Small clips (<~15MB) go inline
 * as base64 (generateContent inlineData); larger clips are uploaded via the
 * Files API and reused across requests through a per-asset cache — which also
 * eases the 10 RPM free-tier limit by avoiding re-uploads.
 */

import { fetchWithRetry } from './retry'

export interface VideoEvent {
  /** What was detected, echoing the user's target, e.g. 'person says "Hi"'. */
  label: string
  /** Event start, seconds from the beginning of the video. */
  startSec: number
  /** Event end in seconds, when the event spans a range. */
  endSec?: number
  /** Model confidence 0..1. */
  confidence: number
}

export interface AnalyzeVideoInput {
  /** Base64-encoded video bytes (no data: prefix). */
  dataBase64: string
  /** MIME type, e.g. 'video/mp4'. */
  mimeType: string
  /** Natural-language description of the moments to find. */
  query: string
  /**
   * Stable identity of the source (e.g. assetId + lastModified). When set, an
   * uploaded Files-API handle is cached under this key and reused, so repeated
   * requests on the same clip skip the upload.
   */
  cacheKey?: string
}

/** Above this decoded size, use the Files API instead of inline base64. */
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024

export interface VideoUnderstandingProvider {
  analyzeVideo(input: AnalyzeVideoInput, signal?: AbortSignal): Promise<VideoEvent[]>
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const SYSTEM_INSTRUCTION = `You analyze a video and locate the moments a user asks about.
Return ONLY the moments that clearly match. Use timestamps in SECONDS from the
start of the video. Be precise: startSec is when the moment begins, endSec when it
ends. Set confidence between 0 and 1. If nothing matches, return an empty list.`

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          confidence: { type: 'number' },
        },
        required: ['label', 'startSec', 'confidence'],
      },
    },
  },
  required: ['events'],
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not configured on the server.')
  return key
}

function sanitizeEvents(raw: unknown): VideoEvent[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { events?: unknown }).events
  if (!Array.isArray(list)) return []
  const out: VideoEvent[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 120) : ''
    const startSec = typeof o.startSec === 'number' && Number.isFinite(o.startSec) ? Math.max(0, o.startSec) : NaN
    if (!label || Number.isNaN(startSec)) continue
    const endSec =
      typeof o.endSec === 'number' && Number.isFinite(o.endSec) && o.endSec > startSec ? o.endSec : undefined
    const confidence =
      typeof o.confidence === 'number' && Number.isFinite(o.confidence)
        ? Math.min(1, Math.max(0, o.confidence))
        : 0.5
    out.push({ label, startSec, endSec, confidence })
  }
  return out
}

// --- Files API upload + per-asset cache -------------------------------------

interface CachedFile {
  fileUri: string
  mimeType: string
  /** Epoch ms after which the cache entry is considered stale. */
  expiresAt: number
}

// Module-level cache (per server instance). Gemini stores files 48h; keep our
// entries a little shorter so we never hand back an expired URI.
const fileCache = new Map<string, CachedFile>()
const FILE_TTL_MS = 46 * 60 * 60 * 1000

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64')
  // Copy into a fresh, exactly-sized ArrayBuffer (a Node Buffer may be a view
  // into a larger shared pool).
  const out = new ArrayBuffer(buf.byteLength)
  new Uint8Array(out).set(buf)
  return out
}

/** Resumable upload → poll ACTIVE → return the file URI. */
async function uploadToFilesApi(
  dataBase64: string,
  mimeType: string,
  signal: AbortSignal | undefined,
): Promise<{ fileUri: string; mimeType: string }> {
  const key = getApiKey()
  const bytes = base64ToArrayBuffer(dataBase64)

  // 1. Start a resumable session.
  const startRes = await fetchWithRetry(`${GEMINI_BASE.replace('/v1beta', '')}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    signal,
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'elah-edit-source' } }),
  })
  if (!startRes.ok) throw new Error(`Gemini upload start failed (${startRes.status}).`)
  const uploadUrl = startRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini upload URL missing.')

  // 2. Upload the bytes and finalize.
  const upRes = await fetchWithRetry(uploadUrl, {
    method: 'POST',
    signal,
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': mimeType,
    },
    body: bytes,
  })
  if (!upRes.ok) throw new Error(`Gemini upload failed (${upRes.status}).`)
  const upData = await upRes.json()
  let name: string | undefined = upData?.file?.name
  let state: string | undefined = upData?.file?.state
  const fileUri: string | undefined = upData?.file?.uri
  if (!fileUri || !name) throw new Error('Gemini upload returned no file handle.')

  // 3. Poll until the file is ACTIVE (video processing).
  const deadline = Date.now() + 60_000
  while (state !== 'ACTIVE') {
    if (state === 'FAILED') throw new Error('Gemini failed to process the video.')
    if (Date.now() > deadline) throw new Error('Gemini video processing timed out.')
    await new Promise((r) => setTimeout(r, 1500))
    const poll: Response = await fetch(`${GEMINI_BASE}/${name}?key=${key}`, { signal })
    if (!poll.ok) throw new Error(`Gemini file poll failed (${poll.status}).`)
    const pd: { state?: string; name?: string } = await poll.json()
    state = pd?.state
    name = pd?.name ?? name
  }

  return { fileUri, mimeType }
}

async function resolveFilePart(
  input: AnalyzeVideoInput,
  signal: AbortSignal | undefined,
): Promise<{ fileData: { fileUri: string; mimeType: string } }> {
  const cacheKey = input.cacheKey
  if (cacheKey) {
    const hit = fileCache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) {
      return { fileData: { fileUri: hit.fileUri, mimeType: hit.mimeType } }
    }
  }
  const uploaded = await uploadToFilesApi(input.dataBase64, input.mimeType, signal)
  if (cacheKey) {
    fileCache.set(cacheKey, { ...uploaded, expiresAt: Date.now() + FILE_TTL_MS })
  }
  return { fileData: uploaded }
}

// ---------------------------------------------------------------------------

/** Gemini 3 Flash implementation. */
export const geminiVideoUnderstanding: VideoUnderstandingProvider = {
  async analyzeVideo(input, signal) {
    const { dataBase64, mimeType, query } = input

    // Choose transport: inline for small clips, Files API (cached) for large.
    const approxBytes = Math.floor((dataBase64.length * 3) / 4)
    const videoPart =
      approxBytes <= INLINE_LIMIT_BYTES
        ? { inlineData: { mimeType, data: dataBase64 } }
        : await resolveFilePart(input, signal)

    const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${getApiKey()}`
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [
          {
            role: 'user',
            parts: [videoPart, { text: `Find the moments where: ${query}` }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    })

    if (!res.ok) {
      throw new Error(`Gemini request failed with status ${res.status}`)
    }

    const data = await res.json()
    const text: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== 'string') throw new Error('Gemini returned no content.')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('Gemini returned invalid JSON.')
    }
    return sanitizeEvents(parsed)
  },
}
