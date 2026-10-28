/**
 * The one fill type (PV-P4c).
 *
 * A `Paint` is either a solid colour or a gradient laid over the painted box. It
 * is declared here, in its own module, because the names are SHARED: text uses it
 * as `Clip.textFill`, and PV-P6a reuses the same type, the same `toCanvasPaint`
 * and the same `PaintEditor` for shape fill and stroke. One type is the point —
 * a second, parallel gradient type for shapes would be the drift this file exists
 * to prevent.
 *
 * Pure data, no DOM: a document holds one of these, and the canvas helper
 * (`renderer/gpu/layers/paint.ts`) is the only thing that reads it.
 */

export interface PaintStop {
  /** 0..1 along the gradient. */
  offset: number
  /** Any CSS colour the canvas accepts. */
  color: string
}

export type Paint =
  | { type: 'solid'; color: string }
  | {
      type: 'linear'
      /** Degrees; 0 = left→right, 90 = top→bottom. */
      angle: number
      stops: PaintStop[]
    }
  | {
      type: 'radial'
      /** Centre, 0..1 of the box. */
      cx: number
      cy: number
      /** Radius, 0..1 of half the box diagonal. */
      r: number
      stops: PaintStop[]
    }
  | {
      type: 'conic'
      /**
       * Start angle in degrees, CSS conic-gradient(from <angle>): 0 = up (12
       * o'clock), increasing clockwise. NOT the engine's linear convention.
       */
      angle: number
      /** Centre, 0..1 of the box. */
      cx: number
      cy: number
      stops: PaintStop[]
    }
