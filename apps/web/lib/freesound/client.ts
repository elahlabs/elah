import type { FreesoundSearchResponse } from './types'

const BASE_URL = 'https://freesound.org/apiv2/'
const FIELDS = 'id,name,username,duration,previews,images,license'

function getApiKey(): string {
  const key = process.env.FREESOUND_API_KEY
  if (!key) {
    throw new Error('FREESOUND_API_KEY is not configured on the server.')
  }
  return key
}

async function freesoundFetch(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<FreesoundSearchResponse> {
  const url = new URL(path, BASE_URL)
  url.searchParams.set('fields', FIELDS)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const res = await fetch(url, {
    headers: { Authorization: `Token ${getApiKey()}` },
    signal,
  })

  if (!res.ok) {
    throw new Error(`Freesound request failed with status ${res.status}`)
  }

  return res.json() as Promise<FreesoundSearchResponse>
}

export interface FreesoundSearchParams {
  query: string
  page: number
  perPage: number
}

export function searchSounds(
  params: FreesoundSearchParams,
  signal?: AbortSignal,
): Promise<FreesoundSearchResponse> {
  return freesoundFetch('search/text/', {
    query: params.query,
    page: String(params.page),
    page_size: String(params.perPage),
  }, signal)
}

/** Popular feed — shown by default before the user searches (no query term, sorted by downloads). */
export function popularSounds(
  params: { page: number; perPage: number },
  signal?: AbortSignal,
): Promise<FreesoundSearchResponse> {
  return freesoundFetch('search/text/', {
    query: '',
    filter: 'duration:[1 TO 120]',
    sort: 'downloads_desc',
    page: String(params.page),
    page_size: String(params.perPage),
  }, signal)
}
