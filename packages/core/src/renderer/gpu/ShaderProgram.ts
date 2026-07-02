/**
 * ShaderProgram — compile/link helper with uniform & attribute caching.
 *
 * Responsibilities:
 *  - Compile vertex + fragment shaders and link them into a GL program.
 *  - Cache WebGLUniformLocation lookups so hot-path draw calls skip repeated
 *    gl.getUniformLocation calls.
 *  - Provide a typed setUniforms() surface so callers never deal with raw GL.
 *
 * Usage:
 *   const prog = ShaderProgram.create(gl, vertSrc, fragSrc)
 *   prog.use(gl)
 *   prog.setUniform1i(gl, 'uTexture', 0)
 *   prog.setUniform1f(gl, 'uOpacity', 0.8)
 *   prog.setUniformMatrix3fv(gl, 'uTransform', false, mat3)
 */
export class ShaderProgram {
  private readonly program: WebGLProgram
  private readonly uniformCache = new Map<string, WebGLUniformLocation | null>()

  private constructor(program: WebGLProgram) {
    this.program = program
  }

  /**
   * Compile both shaders, link them, and return a new ShaderProgram.
   * Throws a descriptive error on any GL failure so bugs surface early.
   */
  static create(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): ShaderProgram {
    const vert = ShaderProgram.compileShader(gl, gl.VERTEX_SHADER, vertSrc)
    const frag = ShaderProgram.compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)

    const program = gl.createProgram()
    if (!program) throw new Error('ShaderProgram: gl.createProgram() returned null')

    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)

    // Shaders are no longer needed once linked.
    gl.detachShader(program, vert)
    gl.detachShader(program, frag)
    gl.deleteShader(vert)
    gl.deleteShader(frag)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '(no log)'
      gl.deleteProgram(program)
      throw new Error(`ShaderProgram: link failed — ${log}`)
    }

    return new ShaderProgram(program)
  }

  /** Bind this program for subsequent draw calls. */
  use(gl: WebGL2RenderingContext): void {
    gl.useProgram(this.program)
  }

  setUniform1i(gl: WebGL2RenderingContext, name: string, value: number): void {
    const loc = this.getUniformLocation(gl, name)
    if (loc !== null) gl.uniform1i(loc, value)
  }

  setUniform1f(gl: WebGL2RenderingContext, name: string, value: number): void {
    const loc = this.getUniformLocation(gl, name)
    if (loc !== null) gl.uniform1f(loc, value)
  }

  setUniform2f(gl: WebGL2RenderingContext, name: string, x: number, y: number): void {
    const loc = this.getUniformLocation(gl, name)
    if (loc !== null) gl.uniform2f(loc, x, y)
  }

  /**
   * Upload a column-major 3×3 matrix uniform.
   * @param transpose Must be false for WebGL (GLSL column-major convention).
   */
  setUniformMatrix3fv(
    gl: WebGL2RenderingContext,
    name: string,
    transpose: boolean,
    value: Float32Array | number[],
  ): void {
    const loc = this.getUniformLocation(gl, name)
    if (loc !== null) gl.uniformMatrix3fv(loc, transpose, value)
  }

  /** Release the underlying GL program. Must not be used after disposal. */
  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program)
    this.uniformCache.clear()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getUniformLocation(
    gl: WebGL2RenderingContext,
    name: string,
  ): WebGLUniformLocation | null {
    if (this.uniformCache.has(name)) {
      return this.uniformCache.get(name) ?? null
    }
    const loc = gl.getUniformLocation(this.program, name)
    this.uniformCache.set(name, loc)
    return loc
  }

  private static compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) {
      throw new Error(`ShaderProgram: gl.createShader(${type}) returned null`)
    }
    gl.shaderSource(shader, src)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? '(no log)'
      gl.deleteShader(shader)
      const typeName = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'
      throw new Error(`ShaderProgram: ${typeName} shader compile failed — ${log}`)
    }

    return shader
  }
}
