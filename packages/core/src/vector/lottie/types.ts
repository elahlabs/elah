/**
 * The bodymovin (Lottie) JSON subset this importer reads (PV-P6c-1). Input is
 * untrusted JSON — every reader in `props.ts`/`transform.ts`/`shapes.ts`
 * checks types before indexing rather than trusting this shape.
 */

export type Vec = number[]

export interface LottieBezierHandle {
  x: number | number[]
  y: number | number[]
}

export interface LottieKey<T = Vec> {
  t: number
  s?: T
  e?: T // end value in the pre-5.5 format
  o?: LottieBezierHandle
  i?: LottieBezierHandle
  h?: 0 | 1 // hold until the next key
  to?: number[] // spatial out-tangent (position only)
  ti?: number[] // spatial in-tangent (position only)
}

export interface LottieProp<T = Vec> {
  a?: 0 | 1
  k: T | number | LottieKey<T>[]
  x?: string // expression
}

export interface LottieSplitPosition {
  s: true
  x: LottieProp
  y: LottieProp
}

/** Layer `ks` and shape-group `tr` share this shape. */
export interface LottieTransform {
  a?: LottieProp
  p?: LottieProp | LottieSplitPosition
  s?: LottieProp
  r?: LottieProp
  rz?: LottieProp
  o?: LottieProp
  sk?: LottieProp
  sa?: LottieProp
  ty?: 'tr'
}

export interface LottiePathValue {
  i: number[][]
  o: number[][]
  v: number[][]
  c: boolean
}

export type LottieShapeItem = { ty: string; nm?: string; hd?: boolean; [key: string]: unknown }

export interface LottieLayer {
  ty: number
  ind?: number
  parent?: number
  nm?: string
  ip: number
  op: number
  st?: number
  sr?: number
  ks?: LottieTransform
  ao?: 0 | 1
  ddd?: 0 | 1
  tt?: number
  td?: number
  /** Newer exporters: the `ind` of this layer's matte source. */
  tp?: number
  hasMask?: boolean
  masksProperties?: unknown[]
  ef?: unknown[]
  bm?: number
  refId?: string
  w?: number
  h?: number
  tm?: LottieProp
  sc?: string
  sw?: number
  sh?: number
  shapes?: LottieShapeItem[]
  hd?: boolean
}

export interface LottieAsset {
  id: string
  layers?: LottieLayer[]
  w?: number
  h?: number
}

export interface LottieJson {
  v?: string
  nm?: string
  fr: number
  ip: number
  op: number
  w: number
  h: number
  layers: LottieLayer[]
  assets?: LottieAsset[]
}

export interface LottieSkip {
  feature: string
  count: number
}
