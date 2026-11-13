/*
 * BeatPipe.uvs — "BeatPipe >> v.0.2", a Sonique (UltraVis) visualization plug-in, as AVS's
 * "Render / SVP Loader" runs it.
 *
 * Library: beatpipe.uvs
 * Binary:  sha256 647a30630c41f43d248a89acb04be60bce6b314eecd000e327616afc0cee9d5d
 *          (PE32 DLL, linker 5.00, 05.05.2000, unoptimised debug-CRT build with an incremental-link
 *          jump table; static CRT, only KERNEL32 imported)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x10026A30, the layout of svp_vis.h): Reserved 0, name "BeatPipe >> v.0.2",
 * lRequired = 3 (waveform | spectrum), Initialize 0x1000372A, Render 0x10003B9B,
 * SaveSettings 0x10003FBB / OpenSettings 0x10003FC5 (both `return 1`). AVS calls OpenSettings,
 * Initialize, then Render per frame; nothing else is reachable.
 *
 * Settings: none (no profile imports). No random numbers (no rand in the binary). No time input
 * (MillSec and the waveform are not read).
 *
 * Behaviour (Render 0x10003B9B), every call:
 *  - REPLACES the frame with a checkerboard of 10 x 10 squares, 0x000000 / 0x303030.
 *  - Keeps a half pipe of 15 rings x 25 points (Initialize: x = (b - 12) * 2, angle
 *    a * 6.28 / 15 / 2, radius 2, colour 0x8888FF) whose ring profile scrolls along the axis one
 *    point per call: every vertex takes y, z, normal-x and colour of the vertex before it, then
 *    the first point of each ring gets the new radius
 *        r = (sum(spectrum[0..1][0..255]) * 0.0001 + 2.5 + r_prev) / 2
 *    and the second point's normal-x the slope (y0 - y2) / 2 of ring 0.
 *  - Lights every vertex (ambient 0.1 white; point light white 20 moving on
 *    (50 cos t1, 50 cos t2, 50 cos t3), t += 0.053273 / 0.055827 / 0.0682945 per call;
 *    directional 0x00AAFF 0.4 towards (30, -40, -40); point light red 20 at (-30, 20, -40)):
 *    diffuse c * (amb + sum light * f / 256), f = cos(N, L) * I [/ |L| for point lights];
 *    plus specular light * cos(R, L)^e with e = 30 (* I) for the directional light and
 *    e = |L| * 10 / I for point lights, R the eye ray (eye at z = -50) mirrored about N;
 *    each channel clamped to 255 and truncated.
 *  - Projects x, y with 50 / (z + 50) / 27 and draws the 672 triangles in index order, without
 *    depth sort, culling clockwise ones, Gouraud-filled with 8-bit integer colour steps (and the
 *    binary's integer DDA, line and degenerate-case quirks). Filled pixels carry alpha 0xFF.
 *  - All doubles at 53-bit precision (the code stores every intermediate to memory), _ftol
 *    truncation, int32 elsewhere.
 *
 * Not recovered / approximate:
 *  - sin/cos/pow are the CRT's x87 fsin/fcos and fyl2x/f2xm1 (80-bit) routines; Math.sin/cos/pow
 *    can differ in the last bit of a double, which can change a truncated colour channel or a
 *    vertex position only when a value lands exactly on an integer.
 *  - The DLL's statics are shared between every SVP effect loading this file in one process; the
 *    port keeps one state per create().
 */

export interface ApeContext {
  readonly w: number;
  readonly h: number;
  readonly isBeat: boolean;
  readonly visdata: Int8Array;
  readonly visdataUnsigned: Uint8Array;
  rand(): number;
  makeRand(seed?: number): () => number;
  readonly registers: Float64Array;
  lineBlendMode: number;
  globalBuffer(index: number, create: boolean): Int32Array | null;
  now(): number;
}
export interface SvpVisData {
  millSec: number;
  waveform: [Uint8Array, Uint8Array];
  spectrum: [Uint8Array, Uint8Array];
}
export interface SvpEffect {
  render(video: Int32Array, width: number, height: number, pitch: number, vd: SvpVisData, ctx: ApeContext): void;
}

/** The surface struct Render builds on its stack: { Video, width, height, pitch }. */
export interface BpSurface {
  video: Int32Array;
  width: number;
  height: number;
  pitch: number;
}

export const BP_RINGS = 15;
export const BP_POINTS = 25;
export const BP_VERTS = BP_RINGS * BP_POINTS; // 375 (0x1002B7EC)
export const BP_FACES = (BP_RINGS - 1) * (BP_POINTS - 1) * 2; // 672 (0x101D7678)

/** Doubles of .rdata the code uses (checked bit-exactly in the test). */
export const BP_CONST = {
  angle: 6.28, // 0x100230D8
  spectrumScale: 0.0001, // 0x100230E0
  radiusBase: 2.5, // 0x100230E8
  dt1: 0.053273, // 0x100230F0
  dt2: 0.055827, // 0x100230F8
  dt3: 0.0682945 // 0x10023100
};

const OPAQUE = 0xff000000 | 0;

/** _ftol: truncation, low 32 bits. */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

/** 0x100011D6: per-channel (c1 * a + c2 * (256 - a)) >> 8, alpha forced to 0xFF. */
export function bpBlend(c1: number, c2: number, a: number): number {
  const ia = (256 - a) | 0;
  const r = ((Math.imul((c1 >>> 16) & 255, a) + Math.imul((c2 >>> 16) & 255, ia)) >>> 8) & 255;
  const g = ((Math.imul((c1 >>> 8) & 255, a) + Math.imul((c2 >>> 8) & 255, ia)) >>> 8) & 255;
  const b = ((Math.imul(c1 & 255, a) + Math.imul(c2 & 255, ia)) >>> 8) & 255;
  return ((r << 16) + (g << 8) + b) | OPAQUE;
}

function inside(s: BpSurface, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.width && y < s.height;
}

/** 0x10001623: line from (x1, y1) coloured cB to (x2, y2) coloured cA. */
export function bpLine(s: BpSurface, x1: number, y1: number, x2: number, y2: number, cA: number, cB: number): void {
  cA |= 0;
  cB |= 0;
  let dx = (x2 - x1) | 0;
  let dy = (y2 - y1) | 0;
  if (dx === 0 && dy === 0) {
    if (inside(s, x1, y1)) s.video[y1 * s.pitch + x1] = cA | OPAQUE;
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) {
      [x1, x2] = [x2, x1];
      [y1, y2] = [y2, y1];
      [cA, cB] = [cB, cA];
      dx = (x2 - x1) | 0;
      dy = (y2 - y1) | 0;
    }
    let err = (dx / 2) | 0;
    let y = y1;
    for (let x = x1; x <= x2; x++) {
      if (inside(s, x, y)) {
        s.video[y * s.pitch + x] = cA === cB ? cA : bpBlend(cA, cB, (((x - x1) << 8) / (x2 - x1)) | 0);
      }
      err += dy;
      if (err < 0) { err += dx; y--; }
      if (err >= dx) { err -= dx; y++; }
    }
  } else {
    if (dy < 0) {
      [x1, x2] = [x2, x1];
      [y1, y2] = [y2, y1];
      [cA, cB] = [cB, cA];
      dx = (x2 - x1) | 0;
      dy = (y2 - y1) | 0;
    }
    let err = (dy / 2) | 0;
    let x = x1;
    for (let y = y1; y <= y2; y++) {
      if (inside(s, x, y)) {
        s.video[y * s.pitch + x] = cA === cB ? cA : bpBlend(cA, cB, (((y - y1) << 8) / (y2 - y1)) | 0);
      }
      err += dx;
      if (err < 0) { err += dy; x--; }
      if (err >= dy) { err -= dy; x++; }
    }
  }
}

/** 0x10001BC2: Gouraud trapezoid, edges a and b from row y1 to row y2 (both drawn). */
export function bpTrapezoid(
  s: BpSurface, xa1: number, xb1: number, y1: number, xa2: number, xb2: number, y2: number,
  ca1: number, cb1: number, ca2: number, cb2: number
): void {
  if (y1 === y2) {
    bpLine(s, xa1, y1, xa2, y2, ca2, ca1);
    bpLine(s, xb1, y1, xb2, y2, cb2, cb1);
    return;
  }
  if (y1 > y2) {
    [y1, y2] = [y2, y1];
    [xa1, xa2] = [xa2, xa1];
    [xb1, xb2] = [xb2, xb1];
    [ca1, ca2] = [ca2, ca1];
    [cb1, cb2] = [cb2, cb1];
  }
  const dy = (y2 - y1) | 0;
  const dxa = (xa2 - xa1) | 0;
  const dxb = (xb2 - xb1) | 0;
  let xa = xa1;
  let xb = xb1;
  let ea = (dy / 2) | 0;
  let eb = (dy / 2) | 0;
  for (let y = y1; y <= y2; y++) {
    const t = (((y - y1) << 8) / dy) | 0;
    const cA = bpBlend(ca2, ca1, t);
    const cB = bpBlend(cb2, cb1, t);
    if (xa < xb) {
      for (let x = xa; x <= xb; x++) {
        if (inside(s, x, y)) s.video[y * s.pitch + x] = bpBlend(cB, cA, (((x - xa) << 8) / (xb - xa + 1)) | 0);
      }
    } else {
      for (let x = xb; x <= xa; x++) {
        if (inside(s, x, y)) s.video[y * s.pitch + x] = bpBlend(cA, cB, (((x - xb) << 8) / (xa - xb + 1)) | 0);
      }
    }
    ea += dxa;
    while (ea < 0) { ea += dy; xa--; }
    while (ea >= dy) { ea -= dy; xa++; }
    eb += dxb;
    while (eb < 0) { eb += dy; xb--; }
    while (eb >= dy) { eb -= dy; xb++; }
  }
}

/** 0x10001EBE: one triangle; returns false when culled (clockwise on screen). */
export function bpTriangle(
  s: BpSurface, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
  c0: number, c1: number, c2: number
): boolean {
  const cross = ((x1 - x0) | 0) * ((y2 - y0) | 0) - ((y1 - y0) | 0) * ((x2 - x0) | 0);
  if (cross < 0) return false;
  if (y1 < y0) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; [c0, c1] = [c1, c0]; }
  if (y2 < y0) { [x0, x2] = [x2, x0]; [y0, y2] = [y2, y0]; [c0, c2] = [c2, c0]; }
  if (y2 < y1) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; [c1, c2] = [c2, c1]; }
  if (y2 === y0) {
    bpLine(s, x0, y0, x2, y2, c0, c2);
    return true;
  }
  const a = (((y1 - y0) << 8) / (y2 - y0)) | 0;
  const cm = bpBlend(c2, c0, a);
  const xm = (x0 + ((Math.imul(x2 - x0, y1 - y0) / (y2 - y0)) | 0)) | 0;
  bpTrapezoid(s, x0, x0, y0, xm, x1, y1, c0, c0, cm, c1);
  bpTrapezoid(s, xm, x1, y1, x2, x2, y2, cm, c1, c2, c2);
  return true;
}

/** 0x10003349: cosine between two vectors (0 when one of them is null). */
export function bpCos(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const t = Math.sqrt(((ax * ax + ay * ay) + az * az) * ((bx * bx + by * by) + bz * bz));
  if (t === 0) return t;
  return ((ax * bx + ay * by) + az * bz) / t;
}

/** 0x10003406: vector length. */
export function bpLength(x: number, y: number, z: number): number {
  return Math.sqrt((x * x + y * y) + z * z);
}

export interface BpLight {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  type: number; // 0 point, 1 directional
}

export interface BpScene {
  ambientColor: number; // 0x10072D20
  ambient: number; // 0x10072D28
  lights: BpLight[]; // 0x10072D38 + 0x30 i, count 0x10072F18
  eye: number; // 0x101D7660: 50
  focal: number; // 0x101D7668: 27
}

export interface BpState {
  /** 375 vertices x {x, y, z, nx, ny, nz} (0x1009EE40, stride 0x38). */
  vert: Float64Array;
  /** vertex colours (+0x30). */
  color: Int32Array;
  /** 672 faces x 3 indices (0x100903E0). */
  face: Int32Array;
  scene: BpScene;
  /** smoothed radius (0x1002B338, .data, 0 at load). */
  radius: number;
  /** light 0 phases (0x100E3400/08/10). */
  t1: number;
  t2: number;
  t3: number;
}

/** Initialize (0x1000372A). */
export function bpInitialize(radius = 0): BpState {
  const vert = new Float64Array(BP_VERTS * 6);
  const color = new Int32Array(BP_VERTS);
  let i = 0;
  for (let a = 0; a < 15; a += 1) {
    for (let b = 0; b < 25; b += 1) {
      const th = ((a * BP_CONST.angle) / 15) / 2;
      const o = i * 6;
      vert[o] = (b - 12) * 2;
      vert[o + 1] = Math.cos(th) * 2;
      vert[o + 2] = -Math.sin(th) * 2;
      vert[o + 3] = 0;
      vert[o + 4] = Math.cos(th);
      vert[o + 5] = -Math.sin(th);
      color[i] = 0x8888ff;
      i++;
    }
  }
  const face = new Int32Array(BP_FACES * 3);
  let f = 0;
  for (let r = 0; r < 14; r++) {
    for (let p = 0; p < 24; p++) {
      const k = r * 25 + p;
      face.set([k, k + 25, k + 1], f * 3);
      f++;
      face.set([k + 25, k + 26, k + 1], f * 3);
      f++;
    }
  }
  const scene: BpScene = {
    ambientColor: 0xffffff,
    ambient: 0.1,
    lights: [
      { x: 0, y: 0, z: 0, color: 0xffffff, intensity: 20, type: 0 },
      { x: 30, y: -40, z: -40, color: 0x00aaff, intensity: 0.4, type: 1 },
      { x: -30, y: 20, z: -40, color: 0xff0000, intensity: 20, type: 0 }
    ],
    eye: 50,
    focal: 27
  };
  return { vert, color, face, scene, radius, t1: 0, t2: 0, t3: 0 };
}

/** 0x10002880: perspective (x, y) and lit colour of every vertex. */
export function bpLightVertices(state: BpState, px: Float64Array, py: Float64Array, pc: Int32Array): void {
  const { vert, color, scene } = state;
  const c0 = scene.eye;
  const ac = scene.ambientColor;
  const ambR = (((ac >>> 16) & 255) * scene.ambient) / 256;
  const ambG = (((ac >>> 8) & 255) * scene.ambient) / 256;
  const ambB = ((ac & 255) * scene.ambient) / 256;
  let f = 0; // one local for the whole function, as in the binary ([ebp-50h])
  for (let i = 0; i < BP_VERTS; i++) {
    const o = i * 6;
    const x = vert[o]!, y = vert[o + 1]!, z = vert[o + 2]!;
    const nx = vert[o + 3]!, ny = vert[o + 4]!, nz = vert[o + 5]!;
    const s = (c0 / (z + c0)) / scene.focal;
    px[i] = x * s;
    py[i] = y * s;
    const vc = color[i]!;
    let cR = (vc >>> 16) & 255;
    let cG = (vc >>> 8) & 255;
    let cB = vc & 255;
    let accR = ambR, accG = ambG, accB = ambB;
    for (const light of scene.lights) {
      if (light.type === 1) {
        f = bpCos(nx, ny, nz, light.x, light.y, light.z) * light.intensity;
      } else if (light.type === 0) {
        const lx = light.x - x, ly = light.y - y, lz = light.z - z;
        const t = bpCos(nx, ny, nz, lx, ly, lz) * light.intensity;
        f = t / bpLength(lx, ly, lz);
      }
      if (!(f >= 0)) f = 0;
      accR = (((light.color >>> 16) & 255) * f) / 256 + accR;
      accG = (((light.color >>> 8) & 255) * f) / 256 + accG;
      accB = ((light.color & 255) * f) / 256 + accB;
    }
    cR *= accR;
    cG *= accG;
    cB *= accB;
    accR = accG = accB = 0;
    const ex = 0 - x, ey = 0 - y, ez = -c0 - z;
    const k1 = ((ex * nx + ey * ny) + ez * nz) * 2;
    const k2 = -((nx * nx + ny * ny) + nz * nz);
    const rx = k1 * nx + k2 * ex;
    const ry = k1 * ny + k2 * ey;
    const rz = k1 * nz + k2 * ez;
    for (const light of scene.lights) {
      if (light.type === 1) {
        f = bpCos(rx, ry, rz, light.x, light.y, light.z);
        if (!(f >= 0)) f = 0;
        f = Math.pow(f, 30) * light.intensity;
      } else if (light.type === 0) {
        const lx = light.x - x, ly = light.y - y, lz = light.z - z;
        f = bpCos(rx, ry, rz, lx, ly, lz);
        if (!(f >= 0)) f = 0;
        f = Math.pow(f, (bpLength(lx, ly, lz) * 10) / light.intensity);
      }
      accR = ((light.color >>> 16) & 255) * f + accR;
      accG = ((light.color >>> 8) & 255) * f + accG;
      accB = (light.color & 255) * f + accB;
    }
    cR = cR + accR;
    cG = cG + accG;
    cB = cB + accB;
    if (cR > 255) cR = 255;
    if (cG > 255) cG = 255;
    if (cB > 255) cB = 255;
    pc[i] = ((ftol(cR) << 16) + (ftol(cG) << 8) + ftol(cB)) | 0;
  }
}

/** 0x100020BC: screen coordinates and the triangles in index order. */
export function bpDrawFaces(state: BpState, s: BpSurface, px: Float64Array, py: Float64Array, pc: Int32Array): void {
  const hw = s.width / 2;
  const hh = s.height / 2;
  const face = state.face;
  for (let f = 0; f < BP_FACES; f++) {
    const i0 = face[f * 3]!, i1 = face[f * 3 + 1]!, i2 = face[f * 3 + 2]!;
    bpTriangle(
      s,
      ftol(px[i0]! * hw + hw), ftol(py[i0]! * hw + hh),
      ftol(px[i1]! * hw + hw), ftol(py[i1]! * hw + hh),
      ftol(px[i2]! * hw + hw), ftol(py[i2]! * hw + hh),
      pc[i0]!, pc[i1]!, pc[i2]!
    );
  }
}

/** Render's checkerboard: 0 where the 10-pixel cell parities of x and y agree, else 0x303030. */
export function bpBackground(s: BpSurface): void {
  for (let y = 0; y < s.height; y++) {
    const sy = 2 * (((y / 10) | 0) % 2) - 1;
    for (let x = 0; x < s.width; x++) {
      const sx = 2 * (((x / 10) | 0) % 2) - 1;
      s.video[y * s.pitch + x] = sx * sy === 1 ? 0 : 0x303030;
    }
  }
}

/** Render's mesh update: scroll the profile one vertex on and feed the ring heads. */
export function bpUpdateMesh(state: BpState, vd: SvpVisData): void {
  const { vert, color } = state;
  for (let i = BP_VERTS - 1; i > 0; i--) {
    const o = i * 6;
    vert[o + 1] = vert[o - 5]!;
    vert[o + 2] = vert[o - 4]!;
    vert[o + 3] = vert[o - 3]!;
    color[i] = color[i - 1]!;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum = (vd.spectrum[0][i] ?? 0) + sum;
    sum = (vd.spectrum[1][i] ?? 0) + sum;
  }
  sum = sum * BP_CONST.spectrumScale;
  sum = sum + BP_CONST.radiusBase;
  sum = (sum + state.radius) / 2;
  state.radius = sum;
  const slope = (vert[1]! - vert[2 * 6 + 1]!) / 2;
  for (let a = 0; a < 15; a += 1) {
    const th = ((a * BP_CONST.angle) / 15) / 2;
    const o = a * 25 * 6;
    vert[o + 1] = Math.cos(th) * sum;
    vert[o + 2] = -Math.sin(th) * sum;
    vert[o + 3] = 0;
    vert[o + 6 + 3] = slope;
  }
}

/** Render (0x10003B9B). */
export function bpRender(state: BpState, video: Int32Array, width: number, height: number, pitch: number, vd: SvpVisData): void {
  const s: BpSurface = { video, width, height, pitch };
  bpBackground(s);
  bpUpdateMesh(state, vd);
  const l0 = state.scene.lights[0]!;
  l0.x = Math.cos(state.t1) * 25 * 2;
  l0.y = Math.cos(state.t2) * 25 * 2;
  l0.z = Math.cos(state.t3) * 25 * 2;
  state.t1 = state.t1 + BP_CONST.dt1;
  state.t2 = state.t2 + BP_CONST.dt2;
  state.t3 = state.t3 + BP_CONST.dt3;
  const px = new Float64Array(BP_VERTS);
  const py = new Float64Array(BP_VERTS);
  const pc = new Int32Array(BP_VERTS);
  bpLightVertices(state, px, py, pc);
  bpDrawFaces(state, s, px, py, pc);
}

export function createBeatPipe(): SvpEffect {
  const state = bpInitialize();
  return {
    render(video, width, height, pitch, vd) {
      bpRender(state, video, width, height, pitch, vd);
    }
  };
}

export const svp = {
  file: "beatpipe.uvs",
  sha256: ["647a30630c41f43d248a89acb04be60bce6b314eecd000e327616afc0cee9d5d"],
  create(): SvpEffect {
    return createBeatPipe();
  }
};
