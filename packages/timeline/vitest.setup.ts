class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly width: number
  readonly height: number
  readonly pressure: number
  readonly tangentialPressure: number
  readonly tiltX: number
  readonly tiltY: number
  readonly twist: number
  readonly pointerType: string
  readonly isPrimary: boolean

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.width = init.width ?? 1
    this.height = init.height ?? 1
    this.pressure = init.pressure ?? 0
    this.tangentialPressure = init.tangentialPressure ?? 0
    this.tiltX = init.tiltX ?? 0
    this.tiltY = init.tiltY ?? 0
    this.twist = init.twist ?? 0
    this.pointerType = init.pointerType ?? 'mouse'
    this.isPrimary = init.isPrimary ?? true
  }

  getCoalescedEvents(): PointerEvent[] {
    return [this as unknown as PointerEvent]
  }

  getPredictedEvents(): PointerEvent[] {
    return []
  }
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

Object.defineProperty(globalThis, 'PointerEvent', {
  configurable: true,
  writable: true,
  value: TestPointerEvent,
})

Object.defineProperty(window, 'PointerEvent', {
  configurable: true,
  writable: true,
  value: TestPointerEvent,
})

Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
  configurable: true,
  value: () => {},
})

Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
  configurable: true,
  value: () => {},
})

Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
  configurable: true,
  value: () => false,
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export {}
