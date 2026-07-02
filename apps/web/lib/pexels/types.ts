/** Pexels API types — https://www.pexels.com/api/documentation/ */

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
  avg_color: string
  src: PexelsPhotoSrc
  liked: boolean
  alt: string
}

export interface PexelsPhotoSearchResponse {
  page: number
  per_page: number
  total_results: number
  next_page?: string
  photos: PexelsPhoto[]
}

export interface PexelsVideoFile {
  id: number
  quality: 'sd' | 'hd' | 'uhd' | string
  file_type: string
  width: number | null
  height: number | null
  fps: number | null
  link: string
}

export interface PexelsVideoPicture {
  id: number
  nr: number
  picture: string
}

export interface PexelsVideo {
  id: number
  width: number
  height: number
  url: string
  image: string
  duration: number
  user: {
    id: number
    name: string
    url: string
  }
  video_files: PexelsVideoFile[]
  video_pictures: PexelsVideoPicture[]
}

export interface PexelsVideoSearchResponse {
  page: number
  per_page: number
  total_results: number
  next_page?: string
  videos: PexelsVideo[]
}

export interface PexelsErrorResponse {
  error: string
}
