/**
 * RecordingGl — test-only WebGL2RenderingContext stub that records draw calls
 * into a deterministic append-only byte log.
 *
 * Purpose:
 *  Enables golden-frame hash tests without a real GPU context. The hash of the
 *  recorded call log is stable across runs for the same (Scene, frame) input,
 *  validating I3 (scene immutability / no-op on equal ref) and I7 (deterministic
 *  render output) without requiring a headless GPU or Playwright.
 *
 * Recorded calls:
 *  - texImage2D (upload: dimensions + format tag)
 *  - drawArrays (mode + count)
 *  - uniformMatrix3fv (name + matrix bytes)
 *  - uniform1f (name + value bytes)
 *  - uniform1i (name + value bytes)
 *  - clear (tag)
 *  - useProgram (tag)
 *  - bindVertexArray (tag)
 *  - bindFramebuffer / viewport / enable / disable (effect chain, EDX-P2)
 *  - uniform3f / uniform4f
 *
 * All other WebGL2 methods are stubs that return sensible defaults so the
 * renderer initialises without errors.
 *
 * Usage:
 *   const gl = new RecordingGl()
 *   // ... drive renderer ...
 *   const hash = await gl.digest()
 *
 * @see GoldenFrameHash.test.ts
 *
 * NOT for production use. Import only in test files.
 */

/** Encoded record type tags written into the log. */
const enum Tag {
  TexImage2D = 0x01,
  DrawArrays = 0x02,
  UniformMatrix3fv = 0x03,
  Uniform1f = 0x04,
  Uniform1i = 0x05,
  Clear = 0x06,
  UseProgram = 0x07,
  BindVertexArray = 0x08,
  BindTexture = 0x09,
  TexParameteri = 0x0a,
  BindFramebuffer = 0x0b,
  Viewport = 0x0c,
  Capability = 0x0d,
  Uniform3f = 0x0e,
  Uniform4f = 0x0f,
}

export class RecordingGl {
  /** Raw byte log. Append-only; never truncated until reset(). */
  private readonly _log: number[] = []

  /** Fake program and shader counters for handle generation. */
  private _handleCounter = 1
  private _boundProgram = 0
  private _boundVao = 0
  private _activeTexture = 0
  private _boundTextures = new Map<number, number>()
  private _boundFramebuffer: WebGLFramebuffer | null = null
  private _viewport: [number, number, number, number] = [0, 0, 0, 0]
  private _clearColor: [number, number, number, number] = [0, 0, 0, 0]

  // ---------------------------------------------------------------------------
  // Log accessors
  // ---------------------------------------------------------------------------

  /** Return a copy of the raw byte log. */
  get log(): Uint8Array {
    return new Uint8Array(this._log)
  }

  /**
   * Clear the log and reset all handle/name counters.
   * After reset(), replaying the exact same call sequence produces an identical log.
   */
  reset(): void {
    this._log.length = 0
    this._handleCounter = 1
    this._boundProgram = 0
    this._boundVao = 0
    this._activeTexture = 0
    this._boundTextures.clear()
    this._boundFramebuffer = null
    this._viewport = [0, 0, 0, 0]
    this._clearColor = [0, 0, 0, 0]
    this._nameMap.clear()
    this._nameCounter = 1
  }

  /**
   * SHA-256 digest of the log using the Web Crypto API.
   * Returns a hex string.
   */
  async digest(): Promise<string> {
    const bytes = new Uint8Array(this._log)
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  // ---------------------------------------------------------------------------
  // WebGL2 recorded methods
  // ---------------------------------------------------------------------------

  /**
   * Handles both WebGL2 texImage2D overloads:
   *   9-arg: texImage2D(target, level, internalformat, width, height, border, format, type, pixels)
   *   6-arg: texImage2D(target, level, internalformat, format, type, source)
   */
  texImage2D(
    _target: number,
    _level: number,
    _internalformat: number,
    widthOrFormat: number,
    heightOrType: number,
    borderOrSource: unknown,
    format?: number,
    _type?: number,
    _source?: unknown,
  ): void {
    this._write([Tag.TexImage2D])
    if (format !== undefined) {
      // 9-arg form: widthOrFormat = width, heightOrType = height
      this._writeUint32(widthOrFormat)
      this._writeUint32(heightOrType)
      this._writeUint32(format)
    } else {
      // 6-arg form: widthOrFormat = format, heightOrType = type
      this._writeUint32(widthOrFormat)
      this._writeUint32(heightOrType)
      void borderOrSource
    }
  }

  drawArrays(mode: number, _first: number, count: number): void {
    this._write([Tag.DrawArrays])
    this._writeUint32(mode)
    this._writeUint32(count)
  }

  uniformMatrix3fv(
    location: WebGLUniformLocation | null,
    _transpose: boolean,
    value: Float32Array | number[],
  ): void {
    this._write([Tag.UniformMatrix3fv])
    this._writeUint32(this._locationId(location))
    for (const v of value) {
      this._writeFloat32(v)
    }
  }

  uniform1f(location: WebGLUniformLocation | null, x: number): void {
    this._write([Tag.Uniform1f])
    this._writeUint32(this._locationId(location))
    this._writeFloat32(x)
  }

  uniform1i(location: WebGLUniformLocation | null, x: number): void {
    this._write([Tag.Uniform1i])
    this._writeUint32(this._locationId(location))
    this._writeUint32(x)
  }

  uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void {
    this._write([Tag.Uniform1f, 0x02]) // reuse tag with 2f marker
    this._writeUint32(this._locationId(location))
    this._writeFloat32(x)
    this._writeFloat32(y)
  }

  uniform3f(location: WebGLUniformLocation | null, x: number, y: number, z: number): void {
    this._write([Tag.Uniform3f])
    this._writeUint32(this._locationId(location))
    this._writeFloat32(x)
    this._writeFloat32(y)
    this._writeFloat32(z)
  }

  uniform4f(location: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void {
    this._write([Tag.Uniform4f])
    this._writeUint32(this._locationId(location))
    this._writeFloat32(x)
    this._writeFloat32(y)
    this._writeFloat32(z)
    this._writeFloat32(w)
  }

  bindFramebuffer(_target: number, framebuffer: WebGLFramebuffer | null): void {
    this._write([Tag.BindFramebuffer])
    const id = framebuffer ? (framebuffer as unknown as { _id: number })._id ?? 0 : 0
    this._writeUint32(id)
    this._boundFramebuffer = framebuffer
  }

  viewport(x: number, y: number, width: number, height: number): void {
    this._write([Tag.Viewport])
    this._writeUint32(x)
    this._writeUint32(y)
    this._writeUint32(width)
    this._writeUint32(height)
    this._viewport = [x, y, width, height]
  }

  enable(cap: number): void {
    this._write([Tag.Capability, 0x01])
    this._writeUint32(cap)
  }

  disable(cap: number): void {
    this._write([Tag.Capability, 0x00])
    this._writeUint32(cap)
  }

  clear(_mask: number): void {
    this._write([Tag.Clear])
  }

  useProgram(program: WebGLProgram | null): void {
    this._write([Tag.UseProgram])
    this._writeUint32(program ? (program as unknown as { _id: number })._id ?? 0 : 0)
    this._boundProgram = program ? (program as unknown as { _id: number })._id ?? 0 : 0
  }

  bindVertexArray(vao: WebGLVertexArrayObject | null): void {
    this._write([Tag.BindVertexArray])
    this._writeUint32(vao ? (vao as unknown as { _id: number })._id ?? 0 : 0)
    this._boundVao = vao ? (vao as unknown as { _id: number })._id ?? 0 : 0
  }

  bindTexture(_target: number, texture: WebGLTexture | null): void {
    this._write([Tag.BindTexture])
    const id = texture ? (texture as unknown as { _id: number })._id ?? 0 : 0
    this._writeUint32(id)
    this._boundTextures.set(this._activeTexture, id)
  }

  texParameteri(_target: number, pname: number, param: number): void {
    this._write([Tag.TexParameteri])
    this._writeUint32(pname)
    this._writeUint32(param)
  }

  // ---------------------------------------------------------------------------
  // WebGL2 stub methods (return sensible defaults; not recorded)
  // ---------------------------------------------------------------------------

  activeTexture(texture: number): void {
    this._activeTexture = texture
  }

  // Handle creation stubs
  createProgram(): WebGLProgram {
    return this._makeHandle()
  }

  createShader(_type: number): WebGLShader {
    return this._makeHandle()
  }

  createTexture(): WebGLTexture {
    return this._makeHandle()
  }

  createVertexArray(): WebGLVertexArrayObject {
    return this._makeHandle()
  }

  createBuffer(): WebGLBuffer {
    return this._makeHandle()
  }

  shaderSource(_shader: WebGLShader, _source: string): void {}
  compileShader(_shader: WebGLShader): void {}
  getShaderParameter(_shader: WebGLShader, _pname: number): unknown { return true }
  getShaderInfoLog(_shader: WebGLShader): string { return '' }
  attachShader(_program: WebGLProgram, _shader: WebGLShader): void {}
  detachShader(_program: WebGLProgram, _shader: WebGLShader): void {}
  linkProgram(_program: WebGLProgram): void {}
  getProgramParameter(_program: WebGLProgram, _pname: number): unknown { return true }
  getProgramInfoLog(_program: WebGLProgram): string { return '' }
  deleteShader(_shader: WebGLShader | null): void {}
  deleteProgram(_program: WebGLProgram | null): void {}
  deleteTexture(_texture: WebGLTexture | null): void {}
  deleteVertexArray(_vao: WebGLVertexArrayObject | null): void {}
  deleteBuffer(_buffer: WebGLBuffer | null): void {}

  getUniformLocation(
    _program: WebGLProgram,
    name: string,
  ): WebGLUniformLocation {
    return { _id: this._stableNameId(name) } as unknown as WebGLUniformLocation
  }

  getAttribLocation(_program: WebGLProgram, _name: string): number { return 0 }

  enableVertexAttribArray(_index: number): void {}
  vertexAttribPointer(
    _index: number,
    _size: number,
    _type: number,
    _normalized: boolean,
    _stride: number,
    _offset: number,
  ): void {}

  bindBuffer(_target: number, _buffer: WebGLBuffer | null): void {}
  bufferData(_target: number, _data: unknown, _usage: number): void {}

  clearColor(r: number, g: number, b: number, a: number): void {
    this._clearColor = [r, g, b, a]
  }

  createFramebuffer(): WebGLFramebuffer {
    return this._makeHandle()
  }

  deleteFramebuffer(_fb: WebGLFramebuffer | null): void {}
  framebufferTexture2D(
    _target: number, _attachment: number, _textarget: number,
    _texture: WebGLTexture | null, _level: number,
  ): void {}
  checkFramebufferStatus(_target: number): number { return this.FRAMEBUFFER_COMPLETE }

  /** The few parameters the effect chain saves and restores. */
  getParameter(pname: number): unknown {
    switch (pname) {
      case this.VIEWPORT: return new Int32Array(this._viewport)
      case this.COLOR_CLEAR_VALUE: return new Float32Array(this._clearColor)
      case this.FRAMEBUFFER_BINDING: return this._boundFramebuffer
      case this.TEXTURE_BINDING_2D: return null
      default: return null
    }
  }
  blendFunc(_src: number, _dst: number): void {}
  copyTexSubImage2D(
    _target: number, _level: number, _xoff: number, _yoff: number,
    _x: number, _y: number, _w: number, _h: number,
  ): void {}
  blendFuncSeparate(
    _srcRGB: number, _dstRGB: number,
    _srcAlpha: number, _dstAlpha: number,
  ): void {}

  getContextAttributes(): WebGLContextAttributes { return {} }
  isContextLost(): boolean { return false }

  generateMipmap(_target: number): void {}

  pixelStorei(_pname: number, _param: number): void {}

  // WebGL2 constants (subset used by GpuRenderer internals)
  readonly TEXTURE_2D = 0x0de1
  readonly TRIANGLE_STRIP = 0x0005
  readonly ARRAY_BUFFER = 0x8892
  readonly STATIC_DRAW = 0x88b4
  readonly FLOAT = 0x1406
  readonly UNSIGNED_BYTE = 0x1401
  readonly RGBA = 0x1908
  readonly RGB = 0x1907
  readonly COLOR_BUFFER_BIT = 0x4000
  readonly VERTEX_SHADER = 0x8b31
  readonly FRAGMENT_SHADER = 0x8b30
  readonly LINK_STATUS = 0x8b82
  readonly COMPILE_STATUS = 0x8b81
  readonly TEXTURE0 = 0x84c0
  readonly TEXTURE_MIN_FILTER = 0x2801
  readonly TEXTURE_MAG_FILTER = 0x2800
  readonly LINEAR = 0x2601
  readonly NEAREST = 0x2600
  readonly TEXTURE1 = 0x84c1
  readonly TEXTURE_WRAP_S = 0x2802
  readonly TEXTURE_WRAP_T = 0x2803
  readonly CLAMP_TO_EDGE = 0x812f
  readonly BLEND = 0x0be2
  readonly ONE = 1
  readonly ONE_MINUS_SRC_ALPHA = 0x0303
  readonly SRC_ALPHA = 0x0302
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240
  readonly FRAMEBUFFER = 0x8d40
  readonly COLOR_ATTACHMENT0 = 0x8ce0
  readonly FRAMEBUFFER_COMPLETE = 0x8cd5
  readonly FRAMEBUFFER_BINDING = 0x8ca6
  readonly TEXTURE_BINDING_2D = 0x8069
  readonly VIEWPORT = 0x0ba2
  readonly COLOR_CLEAR_VALUE = 0x0c22

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _write(bytes: number[]): void {
    for (const b of bytes) {
      this._log.push(b)
    }
  }

  private _writeUint32(value: number): void {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setUint32(0, value, false)
    this._write(Array.from(new Uint8Array(buf)))
  }

  private _writeFloat32(value: number): void {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setFloat32(0, value, false)
    this._write(Array.from(new Uint8Array(buf)))
  }

  private _makeHandle(): { _id: number } {
    const id = this._handleCounter++
    return { _id: id }
  }

  private _locationId(location: WebGLUniformLocation | null): number {
    if (!location) return 0
    return (location as unknown as { _id: number })._id ?? 0
  }

  /** Map a string name to a stable 32-bit id. */
  private readonly _nameMap = new Map<string, number>()
  private _nameCounter = 1

  private _stableNameId(name: string): number {
    let id = this._nameMap.get(name)
    if (id === undefined) {
      id = this._nameCounter++
      this._nameMap.set(name, id)
    }
    return id
  }
}
