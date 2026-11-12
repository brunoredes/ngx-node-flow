import { Camera } from './geometry';

export type RGBA = [number, number, number, number];

/** Floats per rect instance: x, y, w, h, r, g, b, a, radius. */
export const RECT_STRIDE = 9;

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uCam;
uniform float uDpr;
`;
const TO_CLIP = `vec4 toClip(vec2 w) {
  vec2 c = (w * uCam.z + uCam.xy) / uRes * 2.0 - 1.0;
  return vec4(c.x, -c.y, 0.0, 1.0);
}
`;

const GRID_VS = COMMON + `in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
const GRID_FS = COMMON + `
uniform float uSize; uniform vec4 uColor;
out vec4 o;
void main() {
  vec2 s = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 w = (s - uCam.xy) / uCam.z;
  vec2 d = abs(fract(w / uSize + 0.5) - 0.5) * uSize * uCam.z;
  float a = (1.0 - clamp(min(d.x, d.y) - 0.5, 0.0, 1.0)) * smoothstep(4.0, 8.0, uSize * uCam.z) * uColor.a;
  o = vec4(uColor.rgb * a, a);
}`;

const RECT_VS = COMMON + TO_CLIP + `
in vec2 aCorner; in vec4 aRect; in vec4 aColor; in float aRadius;
out vec2 vLocal; out vec2 vHalf; out vec4 vColor; out float vR;
void main() {
  vLocal = (aCorner - 0.5) * aRect.zw;
  vHalf = aRect.zw * 0.5;
  vColor = aColor;
  vR = aRadius;
  gl_Position = toClip(aRect.xy + aCorner * aRect.zw);
}`;
const RECT_FS = COMMON + `
in vec2 vLocal; in vec2 vHalf; in vec4 vColor; in float vR;
out vec4 o;
void main() {
  vec2 q = abs(vLocal) - vHalf + vR;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vR;
  float a = clamp(0.5 - d * uCam.z * uDpr, 0.0, 1.0) * vColor.a; // ~1 device px of AA
  o = vec4(vColor.rgb * a, a);
}`;

const LINE_VS = COMMON + TO_CLIP + `in vec2 aPos; void main() { gl_Position = toClip(aPos); }`;
const LINE_FS = COMMON + `uniform vec4 uColor; out vec4 o; void main() { o = vec4(uColor.rgb * uColor.a, uColor.a); }`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

export interface Frame {
  width: number;
  height: number;
  dpr: number;
  cam: Camera;
  background: RGBA;
  grid: { size: number; color: RGBA } | null;
  rects: Float32Array;
  rectCount: number;
  lines: Float32Array;
  lineCount: number;
  lineColor: RGBA;
  /** Line vertices from this index on are drawn in accentColor (selected edges). */
  accentFrom: number;
  accentColor: RGBA;
}

export class GlRenderer {
  private grid: WebGLProgram;
  private rect: WebGLProgram;
  private line: WebGLProgram;
  private gridVao: WebGLVertexArrayObject;
  private rectVao: WebGLVertexArrayObject;
  private lineVao: WebGLVertexArrayObject;
  private rectBuf: WebGLBuffer;
  private lineBuf: WebGLBuffer;

  constructor(private gl: WebGL2RenderingContext) {
    this.grid = program(gl, GRID_VS, GRID_FS);
    this.rect = program(gl, RECT_VS, RECT_FS);
    this.line = program(gl, LINE_VS, LINE_FS);

    this.gridVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.gridVao);
    this.attrib(this.grid, 'aPos', new Float32Array([-1, -1, 3, -1, -1, 3]), 2);

    this.rectVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.rectVao);
    this.attrib(this.rect, 'aCorner', new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
    this.rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    const stride = RECT_STRIDE * 4;
    for (const [name, size, offset] of [['aRect', 4, 0], ['aColor', 4, 16], ['aRadius', 1, 32]] as const) {
      const loc = gl.getAttribLocation(this.rect, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    this.lineBuf = this.attrib(this.line, 'aPos', new Float32Array(0), 2);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private attrib(p: WebGLProgram, name: string, data: Float32Array, size: number): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return buf;
  }

  private readonly locs = new Map<string, WebGLUniformLocation | null>();
  /** Cached uniform location; programs are fixed for the renderer's lifetime. */
  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = (p === this.grid ? 'g' : p === this.rect ? 'r' : 'l') + name;
    if (!this.locs.has(key)) this.locs.set(key, this.gl.getUniformLocation(p, name));
    return this.locs.get(key)!;
  }

  private use(p: WebGLProgram, f: Frame) {
    const gl = this.gl;
    gl.useProgram(p);
    gl.uniform2f(this.u(p, 'uRes'), f.width, f.height);
    gl.uniform3f(this.u(p, 'uCam'), f.cam.x, f.cam.y, f.cam.zoom);
    gl.uniform1f(this.u(p, 'uDpr'), f.dpr);
  }

  draw(f: Frame) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const [r, g, b, a] = f.background;
    gl.clearColor(r * a, g * a, b * a, a);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (f.grid) {
      this.use(this.grid, f);
      gl.uniform1f(this.u(this.grid, 'uSize'), f.grid.size);
      gl.uniform4fv(this.u(this.grid, 'uColor'), f.grid.color);
      gl.bindVertexArray(this.gridVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (f.lineCount) {
      this.use(this.line, f);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, f.lines.subarray(0, f.lineCount * 2), gl.DYNAMIC_DRAW);
      gl.uniform4fv(this.u(this.line, 'uColor'), f.lineColor);
      if (f.accentFrom) gl.drawArrays(gl.TRIANGLES, 0, f.accentFrom);
      gl.uniform4fv(this.u(this.line, 'uColor'), f.accentColor);
      if (f.lineCount > f.accentFrom) gl.drawArrays(gl.TRIANGLES, f.accentFrom, f.lineCount - f.accentFrom);
    }

    if (f.rectCount) {
      this.use(this.rect, f);
      gl.bindVertexArray(this.rectVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
      gl.bufferData(gl.ARRAY_BUFFER, f.rects.subarray(0, f.rectCount * RECT_STRIDE), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, f.rectCount);
    }
    gl.bindVertexArray(null);
  }
}
