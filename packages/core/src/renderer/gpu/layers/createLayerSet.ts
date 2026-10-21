import { RenderGraph } from '../RenderGraph'
import { AdjustmentLayer } from './AdjustmentLayer'
import { CompoundLayer } from './CompoundLayer'
import { FreehandLayer } from './FreehandLayer'
import { FrameProbeLayer } from './FrameProbeLayer'
import { GeneratorLayer } from './GeneratorLayer'
import { ImageLayer } from './ImageLayer'
import { RotoMaskLayer } from './RotoMaskLayer'
import { SequenceLayer } from './SequenceLayer'
import { ShapeLayer } from './ShapeLayer'
import { TextLayer } from './TextLayer'
import { VideoLayer, type VideoClipLoadState, type VideoFrameProviderFactory } from './VideoLayer'
import type { Layer } from './types'
import { SCENE_LAYER_ORDER, type SceneLayerKey } from '../../../export/sceneLayerOrder'
import type { TexturePool } from '../TexturePool'
import type { VideoFrameProviderDeps } from '../../../media/video/VideoFrameProvider'
import type { RotoMaskLoader } from '../../../media/masks/RotoMaskFrameProvider'
import type { Scene } from '../../../resolver/scene'

/**
 * Every layer for one Scene level, on one RenderGraph (PV-P1).
 *
 * This is `GpuRenderer.mount`'s layer construction, moved here unchanged so a
 * compound can build a *second*, independent set for its nested scene. A child
 * set must not share the parent's VideoLayer: two copies of one compound hold
 * the same nested clip ids, so one decoder per id would be shared across both.
 */

export interface LayerSetOptions {
  texturePool: TexturePool
  /** VideoLayer's second argument: a provider factory (tests) or decode deps. */
  videoProvider?: VideoFrameProviderFactory | VideoFrameProviderDeps
  /** FrameProbeLayer instead of VideoLayer (debug bisection). */
  probeLayer?: boolean
  onClipLoad?: (clipId: string, state: VideoClipLoadState | null) => void
  rotoMaskLoader?: RotoMaskLoader
  onRotoMaskFrame?: () => void
  /** SequenceLayer's frame loader for `frames` sequences (PV-P8b). */
  sequenceFrameLoader?: (url: string, signal?: AbortSignal) => Promise<Blob>
  onSequenceFrame?: () => void
  /** Nesting level of the scenes this set draws. Default 0. */
  depth?: number
  /** Key prefix of this set's scenes (see LayerContext.keyPrefix). Default ''. */
  keyPrefix?: string
}

export interface LayerSet {
  readonly graph: RenderGraph
  /** Null in probe mode: there is no decoder, so no decode metrics. */
  readonly videoLayer: VideoLayer | null
  readonly imageLayer: ImageLayer
  readonly textLayer: TextLayer
  readonly shapeLayer: ShapeLayer
  readonly freehandLayer: FreehandLayer
  readonly generatorLayer: GeneratorLayer
  readonly adjustmentLayer: AdjustmentLayer
  readonly rotoMaskLayer: RotoMaskLayer
  readonly sequenceLayer: SequenceLayer
  readonly compoundLayer: CompoundLayer
  readonly depth: number
  /** Every layer's notifyContextLost, then the graph's. Does not touch GL. */
  notifyContextLost(): void
}

/** `RenderGraph.registerLayer` wants the concrete Scene; this keeps that cast in one place. */
function register<TItem>(
  graph: RenderGraph,
  layer: Layer<TItem>,
  pick: (scene: Scene) => TItem[] | undefined,
): void {
  graph.registerLayer(
    layer,
    (scene) => pick(scene) ?? [],
    (item) => (item as { id: string }).id,
    (item) => (item as { zIndex: number }).zIndex,
  )
}

export function createLayerSet(opts: LayerSetOptions): LayerSet {
  const depth = opts.depth ?? 0
  const keyPrefix = opts.keyPrefix ?? ''
  const graph = new RenderGraph()

  // Bisection mode paints synthetic colour instead of decoding.
  let videoLayer: VideoLayer | FrameProbeLayer
  let ownedVideoLayer: VideoLayer | null = null
  if (opts.probeLayer) {
    videoLayer = new FrameProbeLayer()
  } else {
    ownedVideoLayer = new VideoLayer(opts.texturePool, opts.videoProvider, {
      ...(opts.onClipLoad ? { onClipLoad: opts.onClipLoad } : {}),
    })
    videoLayer = ownedVideoLayer
  }

  const imageLayer = new ImageLayer()
  const sequenceLayer = new SequenceLayer({
    ...(opts.sequenceFrameLoader ? { frameLoader: opts.sequenceFrameLoader } : {}),
    onFrameReady: () => opts.onSequenceFrame?.(),
  })
  const textLayer = new TextLayer()
  const shapeLayer = new ShapeLayer()
  const freehandLayer = new FreehandLayer()
  const generatorLayer = new GeneratorLayer()
  const adjustmentLayer = new AdjustmentLayer()
  const rotoMaskLayer = new RotoMaskLayer({
    ...(opts.rotoMaskLoader ? { loader: opts.rotoMaskLoader } : {}),
    onFrameReady: () => opts.onRotoMaskFrame?.(),
  })

  const compoundLayer = new CompoundLayer((compoundId) =>
    createLayerSet({
      ...opts,
      depth: depth + 1,
      keyPrefix: `${keyPrefix}${compoundId}/`,
      // A nested clip reports its load state under a namespaced id. The paused
      // preview holds the last frame until it arrives, and no timeline clip
      // shares the nested id, so there is nothing to match it against.
      onClipLoad: opts.onClipLoad
        ? (id, state) => opts.onClipLoad!(`${keyPrefix}${compoundId}/${id}`, state)
        : undefined,
    }),
    depth,
  )

  // Registration order is the historical one, now written down once in
  // SCENE_LAYER_ORDER (the export sorts equal-zIndex ties from the same list).
  // The compound registers last: it is the only layer that renders a whole
  // Scene rather than one item, so it must not interleave with the item
  // layers' z-ordering.
  const layerFor: Record<SceneLayerKey, Layer<never>> = {
    videos: videoLayer,
    images: imageLayer,
    sequences: sequenceLayer,
    texts: textLayer,
    shapes: shapeLayer,
    freehand: freehandLayer,
    generators: generatorLayer,
    adjustments: adjustmentLayer,
    rotoMasks: rotoMaskLayer,
    compounds: compoundLayer,
  } as unknown as Record<SceneLayerKey, Layer<never>>
  for (const key of SCENE_LAYER_ORDER) {
    register(graph, layerFor[key] as Layer<unknown>, (s) => s[key] as unknown[] | undefined)
  }

  return {
    graph,
    videoLayer: ownedVideoLayer,
    imageLayer,
    textLayer,
    shapeLayer,
    freehandLayer,
    generatorLayer,
    adjustmentLayer,
    rotoMaskLayer,
    sequenceLayer,
    compoundLayer,
    depth,
    notifyContextLost() {
      videoLayer.notifyContextLost()
      imageLayer.notifyContextLost()
      sequenceLayer.notifyContextLost()
      textLayer.notifyContextLost()
      shapeLayer.notifyContextLost()
      freehandLayer.notifyContextLost()
      generatorLayer.notifyContextLost()
      adjustmentLayer.notifyContextLost()
      rotoMaskLayer.notifyContextLost()
      compoundLayer.notifyContextLost()
      graph.notifyContextLost()
    },
  }
}
