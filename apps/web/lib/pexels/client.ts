import type {
  PexelsPhotoSearchResponse,
  PexelsVideoSearchResponse,
} from './types'

const BASE_URL = 'https://api.pexels.com'

export interface PexelsSearchParams {
  query: string
  page: number
  perPage: number
}

export interface PexelsListParams {
  page: number
  perPage: number
}

function getApiKey(): string {
  const key = process.env.PEXELS_API_KEY
  if (!key) {
    throw new Error('PEXELS_API_KEY is not configured on the server.')
  }
  return key
}

async function pexelsFetch<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, BASE_URL)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const res = await fetch(url, {
    headers: { Authorization: getApiKey() },
    signal,
  })

  if (!res.ok) {
    throw new Error(`Pexels request failed with status ${res.status}`)
  }

  return res.json() as Promise<T>
}

export function searchPhotos(
  params: PexelsSearchParams,
  signal?: AbortSignal,
): Promise<PexelsPhotoSearchResponse> {
  return pexelsFetch<PexelsPhotoSearchResponse>('/v1/search', {
    query: params.query,
    page: String(params.page),
    per_page: String(params.perPage),
  }, signal)
}

export function searchVideos(
  params: PexelsSearchParams,
  signal?: AbortSignal,
): Promise<PexelsVideoSearchResponse> {
  return pexelsFetch<PexelsVideoSearchResponse>('/videos/search', {
    query: params.query,
    page: String(params.page),
    per_page: String(params.perPage),
  }, signal)
}

/** Curated photo feed — shown by default before the user searches. */
export function curatedPhotos(
  params: PexelsListParams,
  signal?: AbortSignal,
): Promise<PexelsPhotoSearchResponse> {
  return pexelsFetch<PexelsPhotoSearchResponse>('/v1/curated', {
    page: String(params.page),
    per_page: String(params.perPage),
  }, signal)
}

/** Popular video feed — shown by default before the user searches. */
export function popularVideos(
  params: PexelsListParams,
  signal?: AbortSignal,
): Promise<PexelsVideoSearchResponse> {
  return pexelsFetch<PexelsVideoSearchResponse>('/videos/popular', {
    page: String(params.page),
    per_page: String(params.perPage),
  }, signal)
}
