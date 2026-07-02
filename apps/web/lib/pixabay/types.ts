/** Pixabay API types — https://pixabay.com/api/docs/ */

export interface PixabayPhoto {
  id: number
  pageURL: string
  type: string
  tags: string
  previewURL: string
  previewWidth: number
  previewHeight: number
  webformatURL: string
  webformatWidth: number
  webformatHeight: number
  largeImageURL: string
  imageWidth: number
  imageHeight: number
  imageSize: number
  views: number
  downloads: number
  likes: number
  comments: number
  user_id: number
  user: string
  userImageURL: string
}

export interface PixabayPhotoSearchResponse {
  total: number
  totalHits: number
  hits: PixabayPhoto[]
}

export interface PixabayVideoFile {
  url: string
  width: number
  height: number
  size: number
  thumbnail: string
}

export interface PixabayVideo {
  id: number
  pageURL: string
  type: string
  tags: string
  duration: number
  picture_id: string
  videos: {
    large: PixabayVideoFile
    medium: PixabayVideoFile
    small: PixabayVideoFile
    tiny: PixabayVideoFile
  }
  views: number
  downloads: number
  likes: number
  comments: number
  user_id: number
  user: string
  userImageURL: string
}

export interface PixabayVideoSearchResponse {
  total: number
  totalHits: number
  hits: PixabayVideo[]
}

export interface PixabayErrorResponse {
  error: string
}
