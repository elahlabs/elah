import type {
  PixabayPhotoSearchResponse,
  PixabayVideoSearchResponse,
} from './types'

const BASE_URL = 'https://pixabay.com/api/'
const VIDEO_URL = 'https://pixabay.com/api/videos/'

export interface PixabaySearchParams {
  query: string
  page: number
  perPage: number
}

export interface PixabayListParams {
  page: number
  perPage: number
}

function getApiKey(): string {
  const key = process.env.PIXABAY_API_KEY
  if (!key) {
    throw new Error('PIXABAY_API_KEY is not configured on the server.')
  }
  return key
}

async function pixabayFetch<T>(base: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(base)
  url.searchParams.set('key', getApiKey())
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const res = await fetch(url, { signal })

  if (!res.ok) {
    throw new Error(`Pixabay request failed with status ${res.status}`)
  }

  return res.json() as Promise<T>
}

/**
 * Search params tuned for relevance over raw volume: `safesearch` keeps
 * results embeddable anywhere, `order=popular` surfaces well-tagged,
 * well-liked media first (Pixabay's `latest` order skews toward unreviewed
 * uploads with sparse tags), and `editors_choice` on the query-less default
 * feed keeps the empty-search state curated rather than random.
 */
export function searchPhotos(
  params: PixabaySearchParams,
  signal?: AbortSignal,
): Promise<PixabayPhotoSearchResponse> {
  return pixabayFetch<PixabayPhotoSearchResponse>(BASE_URL, {
    q: params.query,
    page: String(params.page),
    per_page: String(params.perPage),
    image_type: 'photo',
    safesearch: 'true',
    order: 'popular',
  }, signal)
}

export function searchVideos(
  params: PixabaySearchParams,
  signal?: AbortSignal,
): Promise<PixabayVideoSearchResponse> {
  return pixabayFetch<PixabayVideoSearchResponse>(VIDEO_URL, {
    q: params.query,
    page: String(params.page),
    per_page: String(params.perPage),
    video_type: 'film',
    safesearch: 'true',
    order: 'popular',
  }, signal)
}

/** Curated photo feed — shown by default before the user searches. */
export function curatedPhotos(
  params: PixabayListParams,
  signal?: AbortSignal,
): Promise<PixabayPhotoSearchResponse> {
  return pixabayFetch<PixabayPhotoSearchResponse>(BASE_URL, {
    page: String(params.page),
    per_page: String(params.perPage),
    image_type: 'photo',
    safesearch: 'true',
    order: 'popular',
    editors_choice: 'true',
  }, signal)
}

/** Popular video feed — shown by default before the user searches. */
export function popularVideos(
  params: PixabayListParams,
  signal?: AbortSignal,
): Promise<PixabayVideoSearchResponse> {
  return pixabayFetch<PixabayVideoSearchResponse>(VIDEO_URL, {
    page: String(params.page),
    per_page: String(params.perPage),
    video_type: 'film',
    safesearch: 'true',
    order: 'popular',
    editors_choice: 'true',
  }, signal)
}
