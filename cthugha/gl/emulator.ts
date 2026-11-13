/**
 * The part of OpenGL 1.x (and GLU) that glcthugha used, on WebGL 2, so that its display code
 * (gl/display.ts, ported from Cthugha-L 1.4's GL_*.cc) runs as it was written: immediate mode
 * (glBegin … glEnd with QUAD_STRIP, POLYGON and LINE_STRIP), the matrix stacks, gluPerspective,
 * glOrtho, gluLookAt, glRotatef, the fixed-function lighting of up to three spot lights (computed
 * per vertex, as GL did, and interpolated across the triangle), exponential fog, texture
 * environment REPLACE / MODULATE, blending and the depth buffer.
 *
 * Vertices are taken into eye space and lit on the CPU when they are given, then drawn in
 * batches; a quad of a strip is split into the triangles Mesa split it into.
 * Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald Deischinger.
 * Non-commercial use only, with credit (COPYING-cthugha-L.txt).
 */

/** A 4 × 4 matrix, column-major as OpenGL keeps it. */
export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a × b. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** gluPerspective(fovy, aspect, zNear, zFar). */
export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovy * Math.PI) / 360);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** glOrtho(left, right, bottom, top, near, far). */
export function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const m = identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -2 / (far - near);
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = -(far + near) / (far - near);
  return m;
}

/** glRotatef(angle in degrees, x, y, z). */
export function rotation(angle: number, x: number, y: number, z: number): Mat4 {
  const length = Math.hypot(x, y, z) || 1;
  x /= length;
  y /= length;
  z /= length;
  const radians = (angle * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  const m = identity();
  m[0] = x * x * t + c;
  m[1] = y * x * t + z * s;
  m[2] = x * z * t - y * s;
  m[4] = x * y * t - z * s;
  m[5] = y * y * t + c;
  m[6] = y * z * t + x * s;
  m[8] = x * z * t + y * s;
  m[9] = y * z * t - x * s;
  m[10] = z * z * t + c;
  return m;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** gluLookAt(eye, centre, up). */
export function lookAt(ex: number, ey: number, ez: number, cx: number, cy: number, cz: number, ux: number, uy: number, uz: number): Mat4 {
  let fx = cx - ex;
  let fy = cy - ey;
  let fz = cz - ez;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // s = f × up, normalised; u = s × f.
  let sx = fy * uz - fz * uy;
  let sy = fz * ux - fx * uz;
  let sz = fx * uy - fy * ux;
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl;
  sy /= sl;
  sz /= sl;
  const vx = sy * fz - sz * fy;
  const vy = sz * fx - sx * fz;
  const vz = sx * fy - sy * fx;
  const m = identity();
  m[0] = sx;
  m[4] = sy;
  m[8] = sz;
  m[1] = vx;
  m[5] = vy;
  m[9] = vz;
  m[2] = -fx;
  m[6] = -fy;
  m[10] = -fz;
  return multiply(m, translation(-ex, -ey, -ez));
}

/** A texture object: a buffer of glcthugha (RGBA, rewritten as it runs) or a picture. */
export class Texture {
  readonly handle: WebGLTexture;

  constructor(private readonly gl: WebGL2RenderingContext, readonly mipmaps: boolean) {
    const texture = gl.createTexture();
    if (!texture) throw new Error("No WebGL texture");
    this.handle = texture;
  }

  /** glTexImage2D / gluBuild2DMipmaps with RGBA bytes, rows from t = 0. */
  upload(width: number, height: number, rgba: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (this.mipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  dispose(): void {
    this.gl.deleteTexture(this.handle);
  }
}

export type Primitive = "quadStrip" | "polygon" | "lineStrip";
export type BlendFunc = "alpha" | "add";

/** One light as glLightfv left it: position and direction in eye space, the diffuse colour. */
interface Light {
  enabled: boolean;
  position: [number, number, number, number];
  direction: [number, number, number];
  diffuse: [number, number, number];
}

const VERTEX_SHADER = `#version 300 es
in vec3 a_eye;
in vec2 a_tex;
in vec4 a_color;
uniform mat4 u_projection;
out vec2 v_tex;
out vec4 v_color;
out float v_depth;
void main() {
  gl_Position = u_projection * vec4(a_eye, 1.0);
  v_tex = a_tex;
  v_color = a_color;
  v_depth = -a_eye.z;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_tex;
in vec4 v_color;
in float v_depth;
uniform sampler2D u_texture;
uniform bool u_textured;
uniform bool u_modulate;
uniform float u_fog;
out vec4 fragColor;
void main() {
  vec4 c = v_color;
  if (u_textured) {
    vec4 t = texture(u_texture, v_tex);
    c = u_modulate ? t * v_color : t;
  }
  // GL_FOG_MODE GL_EXP towards the default fog colour, black.
  if (u_fog > 0.0) c.rgb *= clamp(exp(-u_fog * v_depth), 0.0, 1.0);
  fragColor = c;
}`;

/** Floats per vertex: eye x, y, z; s, t; r, g, b, a. */
const STRIDE = 9;
const MAX_VERTICES = 65536;

/** The state a batch is drawn with; a change of any of it starts a new batch. */
interface DrawState {
  lines: boolean;
  texture: Texture | null;
  modulate: boolean;
  fog: number;
  blend: BlendFunc | null;
  depthTest: boolean;
  depthWrite: boolean;
}

export class GlEmulator {
  private readonly program: WebGLProgram;
  private readonly vbo: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms: Record<"projection" | "texture" | "textured" | "modulate" | "fog", WebGLUniformLocation | null>;
  private readonly data = new Float32Array(MAX_VERTICES * STRIDE);
  private count = 0;
  private batch: DrawState | null = null;
  private batchProjection: Mat4 = identity();

  // The matrix stacks.
  private mode: "projection" | "modelview" = "modelview";
  private projection: Mat4 = identity();
  private modelview: Mat4 = identity();
  /** The stacks of glPushMatrix, as deep as GL's least (2 and 32); a push beyond is an error, ignored. */
  private readonly stacks: Record<"projection" | "modelview", Mat4[]> = { projection: [], modelview: [] };

  // The state of the fixed-function pipeline.
  private lighting = false;
  private normalizeNormals = false;
  private fogOn = false;
  private fogDensity = 1;
  private blendOn = false;
  private blendFunc: BlendFunc = "alpha";
  private depthTest = true;
  private depthWrite = true;
  private texturing = true;
  private modulate = false;
  private bound: Texture | null = null;
  private colour: [number, number, number, number] = [1, 1, 1, 1];
  private readonly lights: Light[] = [0, 1, 2].map(() => ({
    enabled: false,
    position: [0, 0, 1, 0] as [number, number, number, number],
    direction: [0, 0, -1] as [number, number, number],
    diffuse: [1, 1, 1] as [number, number, number]
  }));

  // glBegin … glEnd.
  private primitive: Primitive | null = null;
  private readonly vertices: number[] = [];
  private s = 0;
  private t = 0;
  private nx = 0;
  private ny = 0;
  private nz = 1;

  constructor(readonly gl: WebGL2RenderingContext) {
    const program = gl.createProgram();
    const vbo = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!program || !vbo || !vao) throw new Error("WebGL objects unavailable");
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("WebGL shader unavailable");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
    this.program = program;
    this.vbo = vbo;
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const attribute = (name: string, size: number, offset: number): void => {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    };
    attribute("a_eye", 3, 0);
    attribute("a_tex", 2, 3);
    attribute("a_color", 4, 5);
    gl.bindVertexArray(null);
    this.uniforms = {
      projection: gl.getUniformLocation(program, "u_projection"),
      texture: gl.getUniformLocation(program, "u_texture"),
      textured: gl.getUniformLocation(program, "u_textured"),
      modulate: gl.getUniformLocation(program, "u_modulate"),
      fog: gl.getUniformLocation(program, "u_fog")
    };
  }

  // --- frame ------------------------------------------------------------------------------

  /** glViewport and glClear(COLOR | DEPTH), as drawCB began each frame. */
  beginFrame(width: number, height: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(this.uniforms.texture, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  endFrame(): void {
    this.flush();
    this.gl.bindVertexArray(null);
  }

  // --- matrices ---------------------------------------------------------------------------

  matrixMode(mode: "projection" | "modelview"): void {
    this.mode = mode;
  }

  private get current(): Mat4 {
    return this.mode === "projection" ? this.projection : this.modelview;
  }

  private set current(m: Mat4) {
    if (this.mode === "projection") this.projection = m;
    else this.modelview = m;
  }

  loadIdentity(): void {
    this.current = identity();
  }

  multMatrix(m: Mat4): void {
    this.current = multiply(this.current, m);
  }

  pushMatrix(): void {
    const stack = this.stacks[this.mode];
    if (stack.length < (this.mode === "projection" ? 2 : 32)) stack.push(new Float64Array(this.current));
  }

  popMatrix(): void {
    const m = this.stacks[this.mode].pop();
    if (m) this.current = m;
  }

  rotate(angle: number, x: number, y: number, z: number): void {
    this.multMatrix(rotation(angle, x, y, z));
  }

  translate(x: number, y: number, z: number): void {
    this.multMatrix(translation(x, y, z));
  }

  // --- state ------------------------------------------------------------------------------

  setLighting(on: boolean): void {
    this.lighting = on;
  }

  setNormalize(on: boolean): void {
    this.normalizeNormals = on;
  }

  setFog(on: boolean): void {
    this.fogOn = on;
  }

  /** glFogf(GL_FOG_DENSITY, …). */
  fogf(density: number): void {
    this.fogDensity = density;
  }

  setBlend(on: boolean): void {
    this.blendOn = on;
  }

  blendFunction(func: BlendFunc): void {
    this.blendFunc = func;
  }

  setDepthTest(on: boolean): void {
    this.depthTest = on;
  }

  depthMask(on: boolean): void {
    this.depthWrite = on;
  }

  setTexturing(on: boolean): void {
    this.texturing = on;
  }

  /** glTexEnv GL_TEXTURE_ENV_MODE: REPLACE (false) or MODULATE (true). */
  texEnvModulate(on: boolean): void {
    this.modulate = on;
  }

  bindTexture(texture: Texture | null): void {
    this.bound = texture;
  }

  color4f(r: number, g: number, b: number, a: number): void {
    this.colour = [r, g, b, a];
  }

  /**
   * A spot light (GL_Light.cc's spot()): its position and direction taken into eye space by
   * the modelview of the moment, as glLightfv did; cut-off 50°, exponent 128, ambient and
   * specular white, `diffuse` its colour.
   */
  spot(index: number, position: [number, number, number, number], direction: [number, number, number], diffuse: [number, number, number]): void {
    const light = this.lights[index];
    if (!light) return;
    const m = this.modelview;
    const [x, y, z, w] = position;
    light.position = [
      m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
      m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
      m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
      m[3]! * x + m[7]! * y + m[11]! * z + m[15]! * w
    ];
    const [dx, dy, dz] = direction;
    light.direction = [m[0]! * dx + m[4]! * dy + m[8]! * dz, m[1]! * dx + m[5]! * dy + m[9]! * dz, m[2]! * dx + m[6]! * dy + m[10]! * dz];
    light.diffuse = diffuse;
    light.enabled = true;
  }

  disableLight(index: number): void {
    const light = this.lights[index];
    if (light) light.enabled = false;
  }

  // --- immediate mode ---------------------------------------------------------------------

  begin(primitive: Primitive): void {
    this.primitive = primitive;
    this.vertices.length = 0;
  }

  texCoord(s: number, t: number): void {
    this.s = s;
    this.t = t;
  }

  normal(x: number, y: number, z: number): void {
    this.nx = x;
    this.ny = y;
    this.nz = z;
  }

  /** glVertex3f: into eye space, lit if lighting is on, kept until glEnd. */
  vertex(x: number, y: number, z: number): void {
    const m = this.modelview;
    const ex = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const ey = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const ez = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    let r = this.colour[0];
    let g = this.colour[1];
    let b = this.colour[2];
    let a = this.colour[3];
    if (this.lighting) [r, g, b, a] = this.light(ex, ey, ez);
    this.vertices.push(ex, ey, ez, this.s, this.t, r, g, b, a);
  }

  end(): void {
    const v = this.vertices;
    const n = v.length / STRIDE;
    const primitive = this.primitive;
    this.primitive = null;
    if (primitive === "lineStrip") {
      this.prepare(true);
      for (let i = 0; i + 1 < n; i += 1) {
        this.emit(v, i);
        this.emit(v, i + 1);
      }
      return;
    }
    this.prepare(false);
    if (primitive === "quadStrip") {
      // Each quad (v0, v1, v3, v2) as Mesa drew it: triangles (v0, v1, v2) and (v1, v3, v2).
      for (let i = 0; i + 3 < n; i += 2) {
        this.emit(v, i);
        this.emit(v, i + 1);
        this.emit(v, i + 2);
        this.emit(v, i + 1);
        this.emit(v, i + 3);
        this.emit(v, i + 2);
      }
    } else {
      // A polygon as a fan from its first vertex.
      for (let i = 1; i + 1 < n; i += 1) {
        this.emit(v, 0);
        this.emit(v, i);
        this.emit(v, i + 1);
      }
    }
  }

  /**
   * GL's lighting equation for a vertex at (x, y, z) in eye space with the current normal:
   * emission 0 + global ambient 0.2 × material ambient 0.2, and for each light its spot factor ×
   * (ambient + diffuse + specular), the viewer at infinity; material diffuse 1, specular 0.8,
   * shininess 100; clamped to 0…1.
   */
  private light(x: number, y: number, z: number): [number, number, number, number] {
    const m = this.modelview;
    let nx = m[0]! * this.nx + m[4]! * this.ny + m[8]! * this.nz;
    let ny = m[1]! * this.nx + m[5]! * this.ny + m[9]! * this.nz;
    let nz = m[2]! * this.nx + m[6]! * this.ny + m[10]! * this.nz;
    if (this.normalizeNormals) {
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
    }
    let r = 0.04;
    let g = 0.04;
    let b = 0.04;
    const cutoff = Math.cos((50 * Math.PI) / 180);
    for (const light of this.lights) {
      if (!light.enabled) continue;
      const [px, py, pz, pw] = light.position;
      let lx = pw !== 0 ? px / pw - x : px;
      let ly = pw !== 0 ? py / pw - y : py;
      let lz = pw !== 0 ? pz / pw - z : pz;
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx /= ll;
      ly /= ll;
      lz /= ll;
      const [dx, dy, dz] = light.direction;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const spotDot = -(lx * dx + ly * dy + lz * dz) / dl;
      if (spotDot < cutoff) continue;
      const spot = Math.pow(spotDot, 128);
      const nDotL = nx * lx + ny * ly + nz * lz;
      const diffuse = Math.max(nDotL, 0);
      let specular = 0;
      if (nDotL > 0) {
        let hx = lx;
        let hy = ly;
        let hz = lz + 1;
        const hl = Math.hypot(hx, hy, hz) || 1;
        hx /= hl;
        hy /= hl;
        hz /= hl;
        specular = Math.pow(Math.max(nx * hx + ny * hy + nz * hz, 0), 100) * 0.8;
      }
      r += spot * (0.2 + diffuse * light.diffuse[0] + specular);
      g += spot * (0.2 + diffuse * light.diffuse[1] + specular);
      b += spot * (0.2 + diffuse * light.diffuse[2] + specular);
    }
    return [Math.min(1, r), Math.min(1, g), Math.min(1, b), 1];
  }

  // --- batches ----------------------------------------------------------------------------

  private stateNow(lines: boolean): DrawState {
    return {
      lines,
      texture: this.texturing ? this.bound : null,
      modulate: this.modulate,
      fog: this.fogOn ? this.fogDensity : 0,
      blend: this.blendOn ? this.blendFunc : null,
      depthTest: this.depthTest,
      depthWrite: this.depthWrite
    };
  }

  /** Starts a new batch if anything the next vertices are drawn with has changed. */
  private prepare(lines: boolean): void {
    const next = this.stateNow(lines);
    const b = this.batch;
    const same = b && b.lines === next.lines && b.texture === next.texture && b.modulate === next.modulate &&
      b.fog === next.fog && b.blend === next.blend && b.depthTest === next.depthTest && b.depthWrite === next.depthWrite &&
      sameMatrix(this.batchProjection, this.projection);
    if (same) return;
    this.flush();
    this.batch = next;
    this.batchProjection = new Float64Array(this.projection);
  }

  private emit(v: number[], index: number): void {
    if (this.count >= MAX_VERTICES) {
      const state = this.batch;
      this.flush();
      this.batch = state;
    }
    const from = index * STRIDE;
    const to = this.count * STRIDE;
    for (let k = 0; k < STRIDE; k += 1) this.data[to + k] = v[from + k]!;
    this.count += 1;
  }

  private flush(): void {
    const state = this.batch;
    if (!state || this.count === 0) {
      this.count = 0;
      return;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE);
    gl.uniformMatrix4fv(this.uniforms.projection, false, new Float32Array(this.batchProjection));
    gl.uniform1i(this.uniforms.textured, state.texture ? 1 : 0);
    gl.uniform1i(this.uniforms.modulate, state.modulate ? 1 : 0);
    gl.uniform1f(this.uniforms.fog, state.fog);
    if (state.texture) gl.bindTexture(gl.TEXTURE_2D, state.texture.handle);
    if (state.blend) {
      gl.enable(gl.BLEND);
      if (state.blend === "add") gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    if (state.depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(state.depthWrite);
    gl.drawArrays(state.lines ? gl.LINES : gl.TRIANGLES, 0, this.count);
    this.count = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

function sameMatrix(a: Mat4, b: Mat4): boolean {
  for (let i = 0; i < 16; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
