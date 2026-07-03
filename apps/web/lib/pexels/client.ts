import type { PexelsPhotoSearchResponse } from './types'

const SEARCH_URL = 'https://api.pexels.com/v1/search'
const CURATED_URL = 'https://api.pexels.com/v1/curated'

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
  const key = process.env.PEXEL_API_KEY
  if (!key) {
    throw new Error('PEXEL_API_KEY is not configured on the server.')
  }
  return key
}

async function pexelsFetch<T>(base: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const res = await fetch(url, { headers: { Authorization: getApiKey() }, signal })

  if (!res.ok) {
    throw new Error(`Pexels request failed with status ${res.status}`)
  }

  return res.json() as Promise<T>
}

export function searchPhotos(
  params: PexelsSearchParams,
  signal?: AbortSignal,
): Promise<PexelsPhotoSearchResponse> {
  return pexelsFetch<PexelsPhotoSearchResponse>(SEARCH_URL, {
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
  return pexelsFetch<PexelsPhotoSearchResponse>(CURATED_URL, {
    page: String(params.page),
    per_page: String(params.perPage),
  }, signal)
}
