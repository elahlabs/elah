/**
 * Drag payloads for synthetic timeline elements that don't come from the media
 * library (e.g. a text block). Mirrors the MEDIA_DRAG_MIME contract used by the
 * AssetPanel, but for elements the editor generates on drop rather than imported
 * source media.
 */

/** MIME used on `dataTransfer` for element drags (text, shape, freehand, …). */
export const ELEMENT_DRAG_MIME = 'application/x-elah-element'

/** Kinds of synthetic element that can be dragged onto the timeline. */
export type ElementKind = 'text' | 'shape' | 'freehand'

/** Shape variants available under the 'shape' element kind. */
export type ShapeVariant = 'rect' | 'circle' | 'triangle'

/** Payload encoded into `dataTransfer.getData(ELEMENT_DRAG_MIME)`. */
export interface DragElementPayload {
  kind: 'element'
  element: ElementKind
  /** Present when element === 'shape' to specify the shape geometry. */
  shapeVariant?: ShapeVariant
}
