/*
 * Ball.svp — "Visual Ball", a Sonique visualization plug-in, as AVS's "Render / SVP Loader" runs it.
 *
 * Library: ball.svp
 * Binary:  sha256 660ca602655598ec31e9ac627a57aac12d92ccbb5541877cb28f24350c0c401b
 *          (PE32 DLL, MSVC 6, 10.10.1999, static CRT)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x1000E030): name "Visual Ball", lRequired = 7 (waveform | spectrum | SONIQUEVISPROC),
 * Initialize 0x10002B50, Render 0x10002C00, SaveSettings = OpenSettings = 0x10002F50 (`return 1`).
 *
 * Settings: none (no profile imports). Initialize sets the state below.
 *
 * Behaviour (Render 0x10002C00), per frame:
 *  - Both spectrum channels are cut into 6 bands at ln(i) thresholds k, 2k, ... (k = ln(255) / 6):
 *    bins 1-2, 3-6, 7-15, 16-40, 41-101, 102-254 (bin 0 unused), each the plain sum.
 *  - For band i (0..5) two shaded spheres are drawn: channel 0's at angle phase + 30 i, channel 1's
 *    at angle phase - 30 (i + 1), both on circles of radius R = (sum * h >> 10) + h / 10 around the
 *    frame centre, all shifted by -cos(phase) * w / 3; sphere radius trunc(R * sin 15 deg).
 *  - Sines come from a switch over integer degrees returning constants (91 doubles, some of them one
 *    ulp off Math.sin; copied bit-exactly).
 *  - Each sphere pixel (x, y), z = trunc(sqrt(r^2 - d^2) + r), REPLACES the frame pixel with:
 *      diffuse: c * (0.8 * cos(N, L) + 80/255) per channel (cos <= 0 -> ambient only), clamp 255,
 *      light at (w/2, h/2, w/3);
 *      specular: if the reflected light ray makes cos >= 0.1 with the viewer at (w/2, h/2, w/4),
 *      add (255, 255, 187) * cos^5, clamp 255.
 *    Pixels in column 0 / row 0 are never drawn (the loops test x <= 0, y <= 0).
 *  - Colours: lerp(c1, c2, 360, pos) of packed ARGB with integer division per byte, re-packed with
 *    carries between bytes (pos goes past 360 -> extrapolation): channel 0's spheres between
 *    0xFF0000 and 0xFFFF00, channel 1's between 0x0000FF and 0x00FF00 at first; phase += 2 per
 *    Render call (not per time); when it reaches 360 it restarts and the colour pairs move on
 *    (c2 = c1, c1 = the last band's colour, computed with pos = 538).
 *  - Arithmetic: x87 at 53-bit precision (doubles), truncating _ftol, int32 elsewhere.
 *
 * Not recovered / approximate:
 *  - cos^5 is the CRT's _CIpow (fyl2x / f2xm1 in 80-bit); Math.pow may differ in the last bit,
 *    which matters only when 255 * cos^5 + c lands exactly on an integer.
 *  - An unused alternative shading path (0x100015B0, selected by a global Initialize sets to 0)
 *    with an arcsine-in-degrees decision tree is not ported: it can never run.
 *  - State is shared like the DLL's statics: one module-level state for every instance, reset by
 *    each create() as AVS's Initialize resets it on every load (presets with two Ball effects
 *    advance one phase twice per frame, as in AVS).
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

/** sin of 0..90 degrees as the switch at 0x10001B20 returns it (constants at 0x1000D028..). */
export const BALL_SIN_TABLE: readonly number[] = [
  0.0, 0.01745240643728351, 0.03489949670250097, 0.052335956242943835, 0.0697564737441253, 0.08715574274765818,
  0.10452846326765347, 0.12186934340514748, 0.13917310096006544, 0.15643446504023087, 0.17364817766693036, 0.1908089953765448,
  0.20791169081775934, 0.224951054343865, 0.24192189559966773, 0.25881904510252074, 0.27563735581699916, 0.2923717047227367,
  0.30901699437494745, 0.32556815445715664, 0.3420201433256687, 0.35836794954530027, 0.374606593415912, 0.39073112848927377,
  0.4067366430758002, 0.42261826174069944, 0.4383711467890774, 0.4539904997395468, 0.46947156278589075, 0.484809620246337,
  0.5, 0.5150380749100542, 0.5299192642332049, 0.5446390350150271, 0.5591929034707468, 0.573576436351046,
  0.5877852522924731, 0.6018150231520483, 0.6156614753256583, 0.6293203910498375, 0.6427876096865394, 0.6560590289905073,
  0.6691306063588582, 0.6819983600624985, 0.6946583704589973, 0.7071067811865476, 0.7193398003386512, 0.7313537016191705,
  0.7431448254773942, 0.754709580222772, 0.766044443118978, 0.7771459614569709, 0.7880107536067219, 0.7986355100472928,
  0.8090169943749475, 0.8191520442889918, 0.8290375725550417, 0.838670567945424, 0.848048096156426, 0.8571673007021123,
  0.8660254037844386, 0.8746197071393959, 0.882947592858927, 0.8910065241883679, 0.898794046299167, 0.9063077870366499,
  0.9135454576426009, 0.9205048534524404, 0.9271838545667874, 0.9335804264972017, 0.9396926207859084, 0.9455185755993168,
  0.9510565162951535, 0.9563047559630354, 0.9612616959383189, 0.9659258262890683, 0.9702957262759965, 0.9743700647852352,
  0.9781476007338057, 0.981627183447664, 0.984807753012208, 0.9876883405951378, 0.9902680687415704, 0.992546151641322,
  0.9945218953682733, 0.9961946980917455, 0.9975640502598242, 0.9986295347545738, 0.9993908270190958, 0.9998476951563913,
  1.0
];

/** First bin of each of the 6 spectrum bands (0x10003250 with n = 6; bin 0 is never read). */
export const BALL_BAND_STARTS: readonly number[] = [1, 3, 7, 16, 41, 102, 255];

const AMBIENT_K = -0.00392156862745098; // 0x1000D010, -1/255
const SHIFT_K = -0.3333333333333333; // 0x1000D330

/** _ftol: truncation; low 32 bits. */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

/** 0x10001B20: sine of an integer number of degrees. */
export function sinDeg(degrees: number): number {
  let a = degrees | 0;
  let sign = 1;
  if (a >= 360) a %= 360;
  if (a < 0) a += 360 * Math.floor((359 - a) / 360);
  if (a > 180) { sign = -1; a -= 180; }
  if (a > 90) a = 180 - a;
  if (a === 0) return 0;
  return sign * (BALL_SIN_TABLE[a] ?? 0);
}

/** 0x10003250 / 0x100032E0: band sums of one spectrum channel. */
export function ballBands(spectrum: Uint8Array): Int32Array {
  const out = new Int32Array(6);
  for (let band = 0; band < 6; band++) {
    let sum = 0;
    for (let i = BALL_BAND_STARTS[band]!; i < BALL_BAND_STARTS[band + 1]!; i++) sum += spectrum[i] ?? 0;
    out[band] = sum;
  }
  return out;
}

/** 0x10001000: per-byte linear blend of packed colours, re-packed with carries (int32). */
export function ballLerp(c1: number, c2: number, total: number, pos: number): number {
  if (pos === 0) return c1 | 0;
  const t = total - pos;
  const mix = (a: number, b: number) => ((a * t + b * pos) / total) | 0;
  const a = mix(c1 >>> 24, c2 >>> 24);
  const r = mix((c1 >>> 16) & 255, (c2 >>> 16) & 255);
  const g = mix((c1 >>> 8) & 255, (c2 >>> 8) & 255);
  const b = mix(c1 & 255, c2 & 255);
  let v = ((a << 8) + r) | 0;
  v = ((v << 8) + g) | 0;
  return ((v << 8) + b) | 0;
}

/** 0x10003190: point at `angle` degrees on a circle of `radius` around the frame centre. */
export function ballCircle(angle: number, radius: number, w: number, h: number): [number, number] {
  const x = ftol(sinDeg(angle - 90) * radius + ((w / 2) | 0));
  const y = ftol(sinDeg(angle) * radius + ((h / 2) | 0));
  return [x, y];
}

export interface BallLight {
  lx: number; ly: number; lz: number; // light (w/2, h/2, w/3)
  vx: number; vy: number; vz: number; // viewer (w/2, h/2, w/4)
}

function channelsOf(color: number): [number, number, number] {
  return [(color >>> 16) & 255, (color >>> 8) & 255, color & 255];
}

/** 0x100010A0: diffuse + ambient. */
export function ballDiffuse(color: number, x: number, y: number, z: number, cx: number, cy: number, r: number, light: BallLight): number {
  const nx = x - cx, ny = y - cy, nz = z - r;
  const lx = light.lx - x, ly = light.ly - y, lz = light.lz - z;
  const dot = (nx * lx + ny * ly) + nz * lz;
  let f = 0;
  if (dot > 0) {
    const n = (nx * nx + ny * ny) + nz * nz;
    const l = (lx * lx + ly * ly) + lz * lz;
    f = (dot / Math.sqrt(n * l)) * 0.8;
  }
  const k = f - 80 * AMBIENT_K;
  const [cr, cg, cb] = channelsOf(color);
  const r2 = Math.min(255, ftol(cr * k));
  const g2 = Math.min(255, ftol(cg * k));
  const b2 = Math.min(255, ftol(cb * k));
  return (r2 << 16) + (g2 << 8) + b2;
}

/** 0x100012A0: Phong highlight, colour (255, 255, 187), exponent 5. */
export function ballSpecular(color: number, x: number, y: number, z: number, cx: number, cy: number, r: number, light: BallLight): number {
  const ny = y - cy, nz = z - r, nx = x - cx;
  const ly = light.ly - y, lz = light.lz - z, lx = light.lx - x;
  const d = (nz * lz + ny * ly) + nx * lx;
  if (!(d >= 0)) return color;
  const n = (nx * nx + ny * ny) + nz * nz;
  const s = (d + d) / n;
  const vy = light.vy - y, vz = light.vz - z, vx = light.vx - x;
  const mx = lx - s * nx, my = ly - s * ny, mz = lz - s * nz;
  const e = -((vz * mz + vy * my) + vx * mx);
  if (!(e >= 0)) return color;
  const mm = (mx * mx + my * my) + mz * mz;
  const vv = (vx * vx + vy * vy) + vz * vz;
  const c = e / Math.sqrt(mm * vv);
  if (!(c >= 0.1)) return color;
  const p = Math.pow(c, 5) * 1.0;
  const [cr, cg, cb] = channelsOf(color);
  const r2 = Math.min(255, ftol(255 * p + cr));
  const g2 = Math.min(255, ftol(255 * p + cg));
  const b2 = Math.min(255, ftol(187 * p + cb));
  return (r2 << 16) + (g2 << 8) + b2;
}

/** 0x10002F60: one sphere, replacing the pixels inside the circle (column/row 0 never drawn). */
export function ballDraw(video: Int32Array, cx: number, cy: number, r: number, color: number, w: number, h: number, pitch: number, light: BallLight): void {
  const x1 = (cx + r) | 0;
  const y1 = (cy + r) | 0;
  const rr = Math.imul(r, r);
  for (let x = (cx - r) | 0, dx = r; x < x1; x++, dx--) {
    if (x <= 0 || x >= w) continue;
    for (let y = (cy - r) | 0, dy = r; y < y1; y++, dy--) {
      if (y <= 0 || y >= h) continue;
      const d2 = (Math.imul(dx, dx) + Math.imul(dy, dy)) | 0;
      if (d2 >= rr) continue;
      const z = ftol(Math.sqrt(rr - d2) + r);
      const lit = ballDiffuse(color, x, y, z, cx, cy, r, light);
      video[y * pitch + x] = ballSpecular(lit, x, y, z, cx, cy, r, light);
    }
  }
}

export interface BallState {
  phase: number;
  c58: number; // channel 0 colour, start
  c1c: number; // channel 0 colour, end
  c54: number; // channel 1 colour, start
  c18: number; // channel 1 colour, end
}

/** Initialize (0x10002B50). */
export function ballInitialState(): BallState {
  return { phase: 0, c58: 0xff0000, c1c: 0xffff00, c54: 0x0000ff, c18: 0x00ff00 };
}

/** Render (0x10002C00). */
export function ballRender(state: BallState, video: Int32Array, w: number, h: number, pitch: number, vd: SvpVisData): void {
  const light: BallLight = {
    lx: (w / 2) | 0, ly: (h / 2) | 0, lz: (w / 3) | 0,
    vx: (w / 2) | 0, vy: (h / 2) | 0, vz: (w / 4) | 0
  };
  const h10 = (h / 10) | 0;
  const bins0 = ballBands(vd.spectrum[0]);
  const bins1 = ballBands(vd.spectrum[1]);
  const phase = state.phase;
  let angle = phase;
  let colorA = 0;
  let colorB = 0;
  const sway = sinDeg(phase - 90) * w * SHIFT_K;
  for (let i = 0; i < 6; i++) {
    const radiusA = ((Math.imul(bins0[i]!, h) >>> 10) + h10) | 0;
    const sizeA = ftol(sinDeg(15) * radiusA);
    const radiusB = ((Math.imul(bins1[i]!, h) >>> 10) + h10) | 0;
    const sizeB = ftol(sinDeg(15) * radiusB);
    const [xa, ya] = ballCircle(angle, radiusA, w, h);
    angle += 30;
    const [xb, yb] = ballCircle(2 * phase - angle, radiusB, w, h);
    const xA = ftol(xa - sway);
    const xB = ftol(xb - sway);
    colorA = ballLerp(state.c58, state.c1c, 360, angle);
    colorB = ballLerp(state.c54, state.c18, 360, angle);
    ballDraw(video, xA, ya, sizeA, colorA, w, h, pitch, light);
    ballDraw(video, xB, yb, sizeB, colorB, w, h, pitch, light);
  }
  state.phase = phase + 2;
  if (state.phase >= 360) {
    state.phase = 0;
    state.c1c = state.c58;
    state.c18 = state.c54;
    state.c58 = colorA;
    state.c54 = colorB;
  }
}

/**
 * The DLL's statics. AVS's LoadLibrary returns the same module to every SVP effect that names
 * ball.svp, so all of them share one phase and one colour set (three presets load it twice: each
 * Render call advances the shared phase by 2). Initialize resets every value Render reads, so a
 * create() (= load: OpenSettings + Initialize) resets the shared state in place.
 */
const shared: BallState = ballInitialState();

export function createBall(): SvpEffect {
  Object.assign(shared, ballInitialState());
  return {
    render(video, width, height, pitch, vd) {
      ballRender(shared, video, width, height, pitch, vd);
    }
  };
}

export const svp = {
  file: "ball.svp",
  sha256: ["660ca602655598ec31e9ac627a57aac12d92ccbb5541877cb28f24350c0c401b"],
  create(): SvpEffect {
    return createBall();
  }
};
