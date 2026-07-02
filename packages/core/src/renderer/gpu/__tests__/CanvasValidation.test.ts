import { describe, expect, it } from 'vitest'
import {
  captureFrame,
  expectPixelApprox,
  hashFrame,
  isBlankFrame,
  samplePixel,
} from './helpers/canvasValidation'

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData
}

describe('canvasValidation helpers', () => {
  it('samplePixel reads RGBA values from ImageData', () => {
    const data = makeImageData(2, 2)
    data.data[0] = 255
    data.data[1] = 128
    data.data[2] = 64
    data.data[3] = 255

    expect(samplePixel(data, 0, 0)).toEqual([255, 128, 64, 255])
  })

  it('hashFrame is stable for identical pixel data', () => {
    const a = makeImageData(2, 2)
    const b = makeImageData(2, 2)
    a.data.fill(42)
    b.data.fill(42)

    expect(hashFrame(a)).toBe(hashFrame(b))
  })

  it('isBlankFrame detects empty frames', () => {
    const blank = makeImageData(4, 4)
    expect(isBlankFrame(blank)).toBe(true)

    const colored = makeImageData(4, 4)
    colored.data[0] = 255
    expect(isBlankFrame(colored)).toBe(false)
  })

  it('expectPixelApprox passes within tolerance', () => {
    const data = makeImageData(1, 1)
    data.data[0] = 100
    data.data[1] = 100
    data.data[2] = 100
    data.data[3] = 255

    expectPixelApprox(data, 0, 0, [102, 98, 101, 255], 4)
  })

  it('captureFrame reads from a canvas 2D context', () => {
    const canvas = {
      width: 2,
      height: 2,
      getContext: () => ({
        getImageData: (_x: number, _y: number, w: number, h: number) => makeImageData(w, h),
      }),
    } as unknown as HTMLCanvasElement

    const data = captureFrame(canvas)
    expect(data.width).toBe(2)
    expect(data.height).toBe(2)
  })
})
