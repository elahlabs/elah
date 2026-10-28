/**
 * The Scene arrays in the order their layers are registered on a RenderGraph.
 *
 * The preview breaks a zIndex tie by this order (a stable sort over the layers
 * in registration order), so the export has to paint a tie in the same order or
 * two clips on one zIndex swap places between the editor and the file. It lives
 * here, not in `createLayerSet`, because the export worker must not import the
 * GL layers (and the decoders they pull in) just to read a list: `createLayerSet`
 * registers its layers FROM this list and the worker sorts FROM it, so there is
 * one list to keep.
 */
export const SCENE_LAYER_ORDER = [
  'videos',
  'images',
  'sequences',
  'texts',
  'shapes',
  'freehand',
  'generators',
  'adjustments',
  'rotoMasks',
  'compounds',
] as const

export type SceneLayerKey = (typeof SCENE_LAYER_ORDER)[number]
