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

function getApiKey(): string {
  const key = process.env.PEXELS_API_KEY
  if (!key) {
    throw new Error('PEXELS_API_KEY is not configured on the server.')
  }
  return key
}

async function pexelsFetch<T>(path: string, params: PexelsSearchParams, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, BASE_URL)
  url.searchParams.set('query', params.query)
  url.searchParams.set('page', String(params.page))
  url.searchParams.set('per_page', String(params.perPage))

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
  return pexelsFetch<PexelsPhotoSearchResponse>('/v1/search', params, signal)
}

export function searchVideos(
  params: PexelsSearchParams,
  signal?: AbortSignal,
): Promise<PexelsVideoSearchResponse> {
  return pexelsFetch<PexelsVideoSearchResponse>('/videos/search', params, signal)
}
