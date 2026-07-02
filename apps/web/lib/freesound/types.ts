/** Freesound API types — https://freesound.org/docs/api/resources_apiv2.html */

export interface FreesoundPreviews {
  'preview-hq-mp3': string
  'preview-lq-mp3': string
  'preview-hq-ogg': string
  'preview-lq-ogg': string
}

export interface FreesoundImages {
  waveform_m: string
  waveform_l: string
  spectral_m: string
  spectral_l: string
}

export interface FreesoundSound {
  id: number
  name: string
  username: string
  duration: number
  previews: FreesoundPreviews
  images: FreesoundImages
  license: string
}

export interface FreesoundSearchResponse {
  count: number
  next: string | null
  previous: string | null
  results: FreesoundSound[]
}

export interface FreesoundErrorResponse {
  error: string
}
