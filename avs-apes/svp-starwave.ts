/*
 * Starwave.svp — "starwave 1.0 :.: xplo", a Sonique visualization plug-in, as AVS's
 * "Render / SVP Loader" runs it.
 *
 * Library: starwave.svp
 * Binary:  sha256 0f1dcb0d0bffbc96e9ebf7f10af2499421701fac0cff2363d03a762622300869
 *          (PE32 DLL, MSVC 6 without optimisation, 09.11.1999, static multithreaded CRT)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x10009048): name "starwave 1.0 :.: xplo", lRequired = 1 (VI_WAVEFORM),
 * Initialize 0x10001D75, Render 0x10001E30, SaveSettings 0x1000206E, OpenSettings 0x10002182.
 *
 * Settings (OpenSettings reads section "starwave" of avs.ini with GetPrivateProfileString; there is
 * no avs.ini, so the defaults apply): DrawSweep "1" -> on, CycleColors "1" -> on,
 * FixedColorR/G/B "255" (clamped 0..255; used only when CycleColors is off).
 *
 * Behaviour, per Render call:
 *  - An 8-bit image the size of the frame is shown through a 256-entry palette (black -> colour over
 *    entries 0..127, colour -> white over 128..255, integer division); every output pixel is
 *    REPLACED with 0xFF000000 | R << 16 | G << 8 | B. The colour glides (256 calls per step) between
 *    random colours (CycleColors).
 *  - Each channel of the waveform is drawn as a ring of white dots: sample i (signed, skipped when 0)
 *    at angle i of a 512-entry float table of sin/cos(2i * 3.14 / 512) and radius
 *    (s * 90/256 + 40) * 6 * f / 128, f = min(127, sum |w[i] - w[i-1]| / 256) (dots rounded with
 *    fistp, round-half-even). While the image's top-left byte is 0, 3..5 more rings are drawn around
 *    the centre at radius (127 - f) * 0.42 h / 127, rotating 0.003 rad per ring call.
 *  - DrawSweep: on a 1-in-~500 random hit a horizontal waveform line sweeps down or up the frame,
 *    one row per channel call (two per frame).
 *  - The image is then warped through a 16.16 move map with bilinear sampling and a random decay
 *    table (~0.95 per frame). Each map is a swirl/zoom from random parameters; the next map is
 *    built one row per Render call and swapped in when complete.
 *  - Arithmetic: x87 at 53-bit precision (doubles), float32 stores where the binary stores floats
 *    (Math.fround), truncating _ftol, fistp round-half-even, int32 elsewhere.
 *
 * Random numbers: the plug-in's own static multithreaded CRT, whose rand() state is per thread.
 * Initialize runs where AVS loads presets (its window thread): srand(GetTickCount()) and one draw
 * (the first sweep trigger). Every other draw happens in Render on AVS's render thread, whose state
 * starts at 1 (srand is never called there): the port uses ctx.makeRand(GetTickCount()) for the
 * Initialize draw and ctx.makeRand(1) for Render. MillSec is not used.
 *
 * Not recovered / approximate:
 *  - fsin/fcos give 64-bit-mantissa results that the next x87 operation rounds once; Math.sin/cos
 *    round to a double first. This can change the last bit of a move-map coordinate (only visible
 *    if it lands exactly on a 1/65536 step) or of a ring offset. The float sin/cos tables are exact
 *    (checked against 60-digit values: every entry is >38 000 double ulps from a float midpoint).
 *  - The image buffers come from malloc and are not cleared in the original; the port starts them
 *    at 0 (fresh heap pages are zero). After a resize the original frees one buffer twice.
 *  - The DLL's statics are shared by all SVP effects loading this file in one process; the port
 *    keeps one state per create().
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

export interface StarwaveSettings {
  drawSweep: boolean;
  cycleColors: boolean;
  fixedR: number;
  fixedG: number;
  fixedB: number;
}

/** OpenSettings (0x10002182) with no avs.ini: the GetPrivateProfileString defaults. */
export const STARWAVE_DEFAULTS: Readonly<StarwaveSettings> = { drawSweep: true, cycleColors: true, fixedR: 255, fixedG: 255, fixedB: 255 };

const F_0_05 = Math.fround(0.05);
const F_0_3 = Math.fround(0.3);
const F_0_003 = Math.fround(0.003);

/** _ftol: truncation toward zero (low 32 bits). */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

/** 0x10002410: fistp of a float with the default control word: round half to even. */
export function rint(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) >= 2147483648) return -2147483648;
  const r = Math.round(value);
  return (r - value === 0.5 && (r & 1) !== 0 ? r - 1 : r) | 0;
}

/** 0x1000100C: (rand() & 0x7FFF) * max / 32768.0, max a float. */
export function randf(rand: () => number, max: number): number {
  return ((rand() & 0x7fff) * Math.fround(max)) / 32768.0;
}

/** 0x10001032: rand() >= 16384. */
export function randBool(rand: () => number): boolean {
  return (((rand() & 0x7fff) << 1) >> 15) !== 0;
}

/** 0x100023F0: a + ((b - a) * f >> 16). */
export function lerp16(a: number, b: number, f: number): number {
  return ((Math.imul(b - a, f) >> 16) + a) | 0;
}

/** 0x100023C0: clamp with the x87 compare order (NaN -> lo). */
export function clampX87(x: number, hi: number, lo: number): number {
  if (!(x >= lo)) return lo;
  if (x <= hi) return x;
  return hi;
}

/** Initialize (0x10001D75): the 512-entry float tables of sin and cos of 2i * 3.14 / 512. */
export function starwaveTables(): { sin: Float32Array; cos: Float32Array } {
  const sin = new Float32Array(512);
  const cos = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const x = ((i + i) * 3.14) / 512.0;
    sin[i] = Math.sin(x);
    cos[i] = Math.cos(x);
  }
  return { sin, cos };
}

/** 0x100014C1: n palette entries from (r0, g0, b0) to (r1, g1, b1), (i*c1 + (n-i)*c0) / n. */
export function paletteRamp(pal: Int32Array, start: number, r0: number, g0: number, b0: number, r1: number, g1: number, b1: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const o = (start + i) * 3;
    pal[o] = ((i * r1 + (n - i) * r0) / n) | 0;
    pal[o + 1] = ((i * g1 + (n - i) * g0) / n) | 0;
    pal[o + 2] = ((i * b1 + (n - i) * b0) / n) | 0;
  }
}

/** 0x10001550: black -> colour (entries 0..127), colour -> white (128..255). */
export function starwavePalette(pal: Int32Array, r: number, g: number, b: number): void {
  paletteRamp(pal, 0, 0, 0, 0, r, g, b, 128);
  paletteRamp(pal, 128, r, g, b, 255, 255, 255, 128);
}

/** 0x10001CE9: sum of |w[i] - w[i-1]| (signed samples) / 256, at most 127 (float32). */
export function starwaveRoughness(wave: Uint8Array): number {
  let prev = ((wave[0] ?? 0) << 24) >> 24;
  let sum = 0;
  for (let i = 1; i < 512; i++) {
    const cur = ((wave[i] ?? 0) << 24) >> 24;
    sum = Math.fround(Math.abs(prev - cur) + sum);
    prev = cur;
  }
  sum = Math.fround(sum / 256.0);
  if (sum > 127.0) sum = 127;
  return sum;
}

export interface StarwaveState {
  settings: StarwaveSettings;
  sinT: Float32Array;
  cosT: Float32Array;
  initialized: boolean;
  rand: () => number;
  w: number;
  h: number;
  allocated: boolean;
  cur: Int32Array; // 0x1000BF60: move map in use, (x, y) 16.16 per pixel
  next: Int32Array; // 0x1000BF64: move map being built
  img: Uint8Array; // 0x1000BF68
  img2: Uint8Array; // 0x1000BF6C
  lut: Uint8Array; // 0x1000B234: decay table
  pal: Int32Array; // 0x1000B338: 256 x (r, g, b)
  a028: number; // swirl (float, -0.5..0.5)
  a024: number; // strength (float, 0..0.3)
  rings: number; // 0x1000A010: 3..5
  generation: number; // 0x1000A020
  row: number; // 0x1000A01C: next row to build
  colPrev: number; // 0x1000A018
  colNext: number; // 0x1000A014
  blend: number; // 0x1000BF70
  sweepPos: number; // 0x1000BF40
  sweepActive: boolean; // 0x1000BF44
  sweepDown: boolean; // 0x1000BF45
  sweepRange: number; // 0x1000BF48 = 500
  sweepTarget: number; // 0x1000BF4C
  sweepAmp: number; // 0x1000BF50 = 40
  angle: number; // 0x1000BF74 (float)
}

export function starwaveCreateState(settings: StarwaveSettings = STARWAVE_DEFAULTS): StarwaveState {
  const { sin, cos } = starwaveTables();
  return {
    settings: { ...settings },
    sinT: sin,
    cosT: cos,
    initialized: false,
    rand: () => 0,
    w: 0,
    h: 0,
    allocated: false,
    cur: new Int32Array(0),
    next: new Int32Array(0),
    img: new Uint8Array(0),
    img2: new Uint8Array(0),
    lut: new Uint8Array(256),
    pal: new Int32Array(256 * 3),
    a028: 0,
    a024: 0,
    rings: 0,
    generation: 0,
    row: 0,
    colPrev: 0,
    colNext: 0,
    blend: 0,
    sweepPos: 0,
    sweepActive: false,
    sweepDown: false,
    sweepRange: 0,
    sweepTarget: 0,
    sweepAmp: 0,
    angle: 0
  };
}

/**
 * Initialize's random part (0x10001DED..): srand(GetTickCount()) and one draw on the loading
 * thread (`initRand`); `renderRand` is the render thread's generator (holdrand 1).
 */
export function starwaveInitialize(state: StarwaveState, initRand: () => number, renderRand: () => number): void {
  state.sweepRange = 500;
  state.sweepTarget = ftol(randf(initRand, state.sweepRange));
  state.sweepAmp = 40;
  state.rand = renderRand;
  state.initialized = true;
}

/** 0x10001079: new move-map parameters and decay table. */
export function starwaveNewParams(state: StarwaveState): void {
  const rand = state.rand;
  state.a028 = Math.fround(randf(rand, 1.0) - 0.5);
  state.a024 = Math.fround(randf(rand, F_0_3));
  state.row = 0;
  state.rings = ((rand() % 3) + 3) | 0;
  state.generation = (state.generation + 1) | 0;
  for (let i = 0; i < 256; i++) {
    const base = i * 0.95;
    state.lut[i] = ftol(randf(rand, F_0_05) + base) & 0xff;
  }
}

/** 0x10001125: one row of the move map into `next`. */
export function starwaveBuildRow(state: StarwaveState, y: number): void {
  const { w, h } = state;
  const w2 = (w / 2) | 0;
  const h2 = (h / 2) | 0;
  const ny = (y - h2) / h2;
  const k = ((state.a028 * 3.14) / 11.0) * state.a024;
  const second = (state.generation & 2) !== 0;
  const out = state.next;
  let o = 2 * w * y;
  for (let x = 0; x < w; x++) {
    const nx = (x - w2) / w2;
    const r = Math.sqrt(nx * nx + ny * ny);
    const ang = Math.sin(r * 15.0) * k;
    let scale = second ? Math.abs(ang) * (1.1 - r) + 1.1 : 0.94 - (Math.abs(ang) + r * 0.1);
    scale = (scale - 1.0) * state.a024 + 1.0;
    const s = Math.sin(ang) * scale;
    const c = Math.cos(ang) * scale;
    let u = nx * c - ny * s + 1.0;
    let v = ny * c + nx * s + 1.0;
    u = clampX87((w * u) / 2.0, w - 1, 1.0);
    v = clampX87((h * v) / 2.0, h - 1, 1.0);
    out[o++] = ftol(u * 65536.0);
    out[o++] = ftol(v * 65536.0);
  }
}

function rand3(rand: () => number): number {
  let c = rand() & 0xff;
  c |= (rand() & 0xff) << 8;
  c |= (rand() & 0xff) << 16;
  return c;
}

/** 0x10001B95: buffers for a new frame size, first map, start colours. */
export function starwaveAllocate(state: StarwaveState, w: number, h: number): void {
  state.w = w;
  state.h = h;
  state.cur = new Int32Array(2 * w * h);
  state.next = new Int32Array(2 * w * h);
  state.img = new Uint8Array(w * h);
  state.img2 = new Uint8Array(w * h);
  starwaveNewParams(state);
  for (let y = 0; y < h; y++) starwaveBuildRow(state, y);
  const t = state.cur;
  state.cur = state.next;
  state.next = t;
  state.colPrev = rand3(state.rand);
  state.colNext = rand3(state.rand);
}

/** 0x100015A6: colour cycling (step = 1). */
export function starwaveCycle(state: StarwaveState, step: number): void {
  if (state.blend >= 256) {
    state.colPrev = state.colNext;
    state.colNext = rand3(state.rand);
    state.blend -= 256;
  }
  const t = state.blend << 8;
  const c2 = lerp16((state.colPrev >>> 16) & 0xff, (state.colNext >>> 16) & 0xff, t);
  const c1 = lerp16((state.colPrev >>> 8) & 0xff, (state.colNext >>> 8) & 0xff, t);
  const c0 = lerp16(state.colPrev & 0xff, state.colNext & 0xff, t);
  starwavePalette(state.pal, c0, c1, c2);
  state.blend += step;
}

/** 0x100016B9: one row of the next map, or swap and start a new one. */
export function starwaveBuildStep(state: StarwaveState): void {
  if (state.row < state.h) {
    starwaveBuildRow(state, state.row);
    state.row++;
  } else {
    const t = state.cur;
    state.cur = state.next;
    state.next = t;
    starwaveNewParams(state);
  }
}

/** 0x100017F8: a ring of dots for the 512 samples around (cx, cy) (floats). */
export function starwaveRing(state: StarwaveState, wave: Uint8Array, cx: number, cy: number, amp: number): void {
  const { w, h, img, sinT, cosT } = state;
  for (let i = 0; i < 512; i++) {
    const s = ((wave[i] ?? 0) << 24) >> 24;
    if (s === 0) continue;
    const t = Math.fround((s * 90.0) / 256.0 + 40.0);
    const px = rint(Math.fround(t * sinT[i]! * amp + cx));
    const py = rint(Math.fround(t * cosT[i]! * amp + cy));
    if (px > 1 && px < w - 1 && py > 1 && py < h - 1) img[py * w + px] = 0xff;
  }
}

/** 0x1000170F: the sweep line at row `pos`. */
export function starwaveSweepLine(state: StarwaveState, wave: Uint8Array, pos: number, amp: number): void {
  const { w, h, img } = state;
  for (let x = 0; x < w; x++) {
    const i = ((x << 9) / w) | 0;
    const s = ((wave[i] ?? 0) << 24) >> 24;
    if (s === 0) continue;
    const d = ((s * amp) / 128) | 0;
    const y = d < pos ? d + pos : d - pos;
    if (x > 1 && x < w - 1 && y > 1 && y < h - 1) img[y * w + x] = 0xff;
  }
}

/** 0x100018DB: one channel: ring, extra rings while the corner is black, sweep, rotation. */
export function starwaveDrawChannel(state: StarwaveState, wave: Uint8Array, f: number, k: number): void {
  const { w, h } = state;
  const amp = Math.fround((k * f) / 128.0);
  const w2 = (w / 2) | 0;
  const h2 = (h / 2) | 0;
  starwaveRing(state, wave, Math.fround(w2), Math.fround(h2), amp);
  if (state.img[0] === 0) {
    const rad = Math.fround(((127.0 - f) * (h * 0.42)) / 127.0);
    for (let j = 0; j < state.rings; j++) {
      const ang = state.angle + ((j * 4.0) * 3.14) / state.rings;
      const sx = Math.fround(Math.sin(ang) * rad);
      const sy = Math.fround(Math.cos(ang) * rad);
      starwaveRing(state, wave, Math.fround(w2 + sx), Math.fround(h2 + sy), amp);
    }
  }
  if (state.settings.drawSweep) {
    state.sweepPos = ftol(clampX87(state.sweepPos, h, 0.0));
    if (!state.sweepActive) {
      if (rint(Math.fround(randf(state.rand, state.sweepRange))) === state.sweepTarget) {
        state.sweepDown = randBool(state.rand);
        state.sweepPos = state.sweepDown ? 0 : h;
        state.sweepActive = true;
        state.sweepTarget = rint(Math.fround(randf(state.rand, state.sweepRange)));
      }
    } else {
      if (state.sweepDown && state.sweepPos >= h) state.sweepActive = false;
      if (!state.sweepDown && state.sweepPos <= 0) state.sweepActive = false;
    }
    if (state.sweepActive) {
      starwaveSweepLine(state, wave, state.sweepPos, state.sweepAmp);
      state.sweepPos += state.sweepDown ? 1 : -1;
    }
  }
  state.angle = Math.fround(state.angle + F_0_003);
}

/** 0x1000138C: bilinear warp of img through the map, decay table, buffers swapped. */
export function starwaveWarp(state: StarwaveState): void {
  const { w, h, cur, img, img2, lut } = state;
  const n = w * h;
  for (let i = 0, o = 0; i < n; i++) {
    const X = cur[o++]!;
    const Y = cur[o++]!;
    const idx = (X >> 16) + Math.imul(w, Y >> 16);
    const fx = X & 0xffff;
    const top = lerp16(img[idx] ?? 0, img[idx + 1] ?? 0, fx);
    const bot = lerp16(img[idx + w] ?? 0, img[idx + w + 1] ?? 0, fx);
    img2[i] = lut[lerp16(top, bot, Y & 0xffff) & 0xff]!;
  }
  state.img = img2;
  state.img2 = img;
}

/** Render (0x10001E30). */
export function starwaveRender(state: StarwaveState, video: Int32Array, width: number, height: number, pitch: number, vd: SvpVisData): void {
  if (!state.allocated || state.w !== width || state.h !== height) {
    starwaveAllocate(state, width, height);
    state.allocated = true;
  }
  const s = state.settings;
  if (s.cycleColors) starwaveCycle(state, 1);
  else starwavePalette(state.pal, s.fixedR, s.fixedG, s.fixedB);
  starwaveBuildStep(state);
  const f1 = starwaveRoughness(vd.waveform[0]);
  const f2 = starwaveRoughness(vd.waveform[1]);
  starwaveDrawChannel(state, vd.waveform[0], f1, 6.0);
  starwaveDrawChannel(state, vd.waveform[1], f2, 6.0);
  starwaveWarp(state);
  const { img, pal } = state;
  for (let y = 0; y < height; y++) {
    const row = y * pitch;
    const src = y * width;
    for (let x = 0; x < width; x++) {
      const c = img[src + x]! * 3;
      video[row + x] = 0xff000000 | (pal[c]! << 16) | (pal[c + 1]! << 8) | pal[c + 2]!;
    }
  }
}

export function createStarwave(settings: StarwaveSettings = STARWAVE_DEFAULTS): SvpEffect {
  const state = starwaveCreateState(settings);
  return {
    render(video, width, height, pitch, vd, ctx) {
      if (!state.initialized) {
        starwaveInitialize(state, ctx.makeRand(ctx.now() >>> 0), ctx.makeRand(1));
      }
      starwaveRender(state, video, width, height, pitch, vd);
    }
  };
}

export const svp = {
  file: "starwave.svp",
  sha256: ["0f1dcb0d0bffbc96e9ebf7f10af2499421701fac0cff2363d03a762622300869"],
  create(): SvpEffect {
    return createStarwave();
  }
};
