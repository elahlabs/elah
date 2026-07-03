/** Pexels API types — https://www.pexels.com/api/documentation/#photos-search */

export interface PexelsPhotoSrc {
  original: string
  large2x: string
  large: string
  medium: string
  small: string
  portrait: string
  landscape: string
  tiny: string
}

export interface PexelsPhoto {
  id: number
  width: number
  height: number
  url: string
  photographer: string
  photographer_url: string
  photographer_id: number
  avg_color: string | null
  src: PexelsPhotoSrc
  alt: string
}

export interface PexelsPhotoSearchResponse {
  total_results: number
  page: number
  per_page: number
  photos: PexelsPhoto[]
  next_page?: string
}

export interface PexelsErrorResponse {
  error: string
}
