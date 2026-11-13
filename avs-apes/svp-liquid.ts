/*
 * Liquid.svp — "CoR's Liquid 2.1", a Sonique visualization plug-in, as AVS's "Render / SVP Loader"
 * runs it.
 *
 * Library: liquid.svp
 * Binary:  sha256 6032d997f162432c6014408836a51b973cc3866001eba471bdd882185cbc2bd7
 *          (PE32 DLL "Debug/LiquidVis21.svp", MSVC 6, 26.10.1999, static multithreaded debug CRT;
 *          exports are reached through an incremental-link jmp table at 0x10001000)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x10021A30): name "CoR's Liquid 2.1", lRequired = 2 (VI_SPECTRUM),
 * Initialize 0x10001050, Render 0x10001200, SaveSettings 0x10001F40, OpenSettings 0x10001F90.
 *
 * Settings (OpenSettings reads section "LiquidVis 2.1" of avs.ini, which does not exist, so the
 * defaults apply; digits and spaces are parsed, 0 is replaced by the default):
 *   fadePause  = 300  frames showing one texture before a cross-fade starts
 *   fadeLength = 50   frames a cross-fade lasts
 *
 * Textures: Initialize loads up to 32 files "Liquid_*.bmp" from the process's current directory
 * (24-bit BMPs, resampled bilinearly to 256 x 256). None ship with the presets' pack, so the
 * plug-in falls back to its two built-in 256 x 256 textures, which the port uses:
 *   0: (x ^ y) in the blue byte;  1: a 32-pixel checkerboard of 0x23C981 and 0.
 *
 * Behaviour (Render 0x10001200), every frame REPLACES the whole w x h frame:
 *  - On a frame-size change: a radius table r(x, y) = (int)(sqrt(u^2 + v^2) * 700) with
 *    u = 2 (x - w/2) / w, v = 2 (y - h/2) / h (0..989), and two textures picked with the DLL's own
 *    rand() (static CRT, seed 1 per thread; only Render calls it, from AVS's render thread).
 *  - Bass (spectrum bins 0-5 of both channels) is smoothed avgA = (sum + 9 avgA) / 10; a
 *    1024-entry radius history (starts at 4096) shifts outwards by 20 entries per frame and its 20
 *    new inner entries are A[20] - (avgA - avgA_old) * (20 - k) / 4 — a ripple running outwards.
 *    Bins 30-69 and 70-109 give avgB, avgC = (sum + 19 avg) / 20, which stretch the texture axes.
 *  - Texture coordinates rotate with the frame counter n: angle (180 n) * 2pi/65536, radius 2.0 *
 *    65536; scrolled by 2^27 - (int)(sin(n/120) * -2^26) and 2^27 - (int)(cos(n/115) * -2^26).
 *    Per pixel: U = (x - w/2) P1 + (y - h/2) P3, V = (x - w/2) P2 + (y - h/2) P4 (int32),
 *    texel u = ((U >> 8) * A[r] + offU) >> 20 & 255, v likewise -> texture[v * 256 + u].
 *  - After fadePause frames, a cross-fade of fadeLength frames to the other texture: one of four
 *    radius profiles (linear outwards, linear inwards, two sine-modulated ones with 3..11 / 3..7
 *    waves, chosen with rand()) rises by 1280 / 50 + 1 or 1480 / 50 + 1 per frame; where it is
 *    <= 0 the old texture shows, > 255 the new one, in between (c_old (255 - a) + c_new a) >> 8.
 *  - Integer arithmetic (int32 wrap, truncating division) except the table, the rotation and the
 *    profiles, which are x87 doubles truncated by _ftol.
 *
 * Not recovered / approximate:
 *  - Liquid_*.bmp textures, if a user had them in Winamp's directory, are not supported (the BMP
 *    reader at 0x10001BC0 is described in the notes but not ported).
 *  - fsin/fcos results feed _ftol after a multiplication by 2^26, 131072 or 200; Math.sin/cos may
 *    differ from the x87 in the last bit, which changes a value only when it lands on an integer.
 *  - The DLL's statics (and its rand state) are shared by every SVP effect loading this file in one
 *    process; the port keeps one state per create() and draws rand from ctx.makeRand(1).
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

export const LIQUID_FADE_PAUSE = 300;
export const LIQUID_FADE_LENGTH = 50;

// .rdata doubles
const K_RADIUS = 700.0; // 0x1001F060
const K_SCALE = 65536.0; // 0x1001F068
const K_ANGLE = 9.587380065917968e-05; // 0x1001F070, 6.2831854 / 65536
const K_SCROLL_U = 0.008333333333333333; // 0x1001F078, 1/120
const K_SCROLL = -67108864.0; // 0x1001F080
const K_SCROLL_V = 0.008695652173913044; // 0x1001F088, 1/115
const K_WAVE = 0.0061359232421875; // 0x1001F090, 6.2831854 / 1024
const K_200 = 200.0; // 0x1001F098
const ZOOM = 2.0; // 0x10026498, set by Initialize, copied to 0x100264A8 on a size change

/** _ftol: truncation; low 32 bits. */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

/** Initialize's fallback textures (0x10001162): 256 x 256 each. */
export function liquidTextures(): Int32Array[] {
  const t0 = new Int32Array(65536);
  const t1 = new Int32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const x = i & 255;
    const y = i >> 8;
    t0[i] = x ^ y;
    t1[i] = Math.imul(((y >> 5) ^ (x >> 5)) & 1, 0x23c981);
  }
  return [t0, t1];
}

/** 0x10001266: radius table, rebuilt on every frame-size change. */
export function liquidRadiusTable(w: number, h: number): Int32Array {
  const table = new Int32Array(Math.max(0, w * h));
  const w2 = (w - (w >> 31)) >> 1;
  const h2 = (h - (h >> 31)) >> 1;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const v = ((y - h2) + (y - h2)) / h;
    const vv = v * v;
    for (let x = 0; x < w; x++) {
      const u = ((x - w2) + (x - w2)) / w;
      table[p++] = ftol(Math.sqrt(u * u + vv) * K_RADIUS);
    }
  }
  return table;
}

/** The per-frame texture mapping parameters (0x10001498 .. 0x1000161E). */
export interface LiquidFrame {
  p1: number; p2: number; p3: number; p4: number;
  u0: number; v0: number;
  offU: number; offV: number;
}

export function liquidFrameParams(frame: number, w: number, h: number, avgB: number, avgC: number): LiquidFrame {
  const radius = ftol(ZOOM * K_SCALE);
  const angle = Math.imul(frame, 180) * K_ANGLE;
  const rc = ftol(Math.cos(angle) * radius);
  const rs = ftol(Math.sin(angle) * radius);
  const b = (avgB + 300) | 0;
  const c = (avgC + 300) | 0;
  const p1 = (Math.imul(((rc << 7) / w) | 0, b) / 300) | 0;
  const p2 = (Math.imul(((rs << 7) / w) | 0, c) / 300) | 0;
  const p3 = (Math.imul(((rs << 7) / h) | 0, b) / 300) | 0;
  const p4 = (Math.imul((((-rc) << 7) / h) | 0, c) / 300) | 0;
  const w2 = (w - (w >> 31)) >> 1;
  const h2 = (h - (h >> 31)) >> 1;
  const u0 = (Math.imul(-w2, p1) - Math.imul(h2, p3)) | 0;
  const v0 = (Math.imul(-h2, p4) - Math.imul(w2, p2)) | 0;
  const offU = (0x8000000 - ftol(Math.sin(frame * K_SCROLL_U) * K_SCROLL)) | 0;
  const offV = (0x8000000 - ftol(Math.cos(frame * K_SCROLL_V) * K_SCROLL)) | 0;
  return { p1, p2, p3, p4, u0, v0, offU, offV };
}

/** Texel index of a pixel: (v << 8) | u. */
export function liquidTexel(u: number, v: number, scale: number, offU: number, offV: number): number {
  const su = (Math.imul(u >> 8, scale) + offU) | 0;
  const sv = (Math.imul(v >> 8, scale) + offV) | 0;
  return ((sv >> 20) & 255) << 8 | ((su >> 20) & 255);
}

/** 0x100019F6: cross-fade blend of two texels, a = 1..255. */
export function liquidBlend(oldPixel: number, newPixel: number, a: number): number {
  const alpha = ((newPixel | (a << 24)) >>> 24) & 255;
  const inv = alpha ^ 255;
  const r = ((oldPixel >>> 16) & 255) * inv + ((newPixel >>> 16) & 255) * alpha;
  const g = ((oldPixel >>> 8) & 255) * inv + ((newPixel >>> 8) & 255) * alpha;
  const bl = (oldPixel & 255) * inv + (newPixel & 255) * alpha;
  return ((r << 8) & 0xff0000) | (g & 0xff00) | (bl >> 8);
}

/** 0x10001721: one of the four fade profiles; returns the per-frame step. */
export function liquidFadeProfile(profile: Int32Array, kind: number, rand: () => number, fadeLength: number): number {
  let step = 0;
  if (kind === 0) {
    for (let i = 0; i < 1024; i++) profile[i] = i - 1024;
    step = ((0x500 / fadeLength) | 0) + 1;
  } else if (kind === 1) {
    for (let i = 0; i < 1024; i++) profile[i] = -i;
    step = ((0x500 / fadeLength) | 0) + 1;
  } else if (kind === 2) {
    const m = ((rand() * 9) >> 15) + 3;
    for (let k = 0; k < 1024; k++) profile[k] = -k - ftol(K_200 - Math.sin(k * m * K_WAVE) * K_200);
    step = ((0x5c8 / fadeLength) | 0) + 1;
  } else if (kind === 3) {
    const m = ((rand() * 5) >> 15) + 3;
    for (let k = 0; k < 1024; k++) profile[k] = k - ftol(K_200 - Math.sin(k * m * K_WAVE) * K_200) - 1024;
    step = ((0x5c8 / fadeLength) | 0) + 1;
  } else {
    profile.fill(0);
    step = ((0x100 / fadeLength) | 0) + 1;
  }
  return step;
}

export interface LiquidState {
  fadePause: number;
  fadeLength: number;
  countdown: number;
  fading: boolean;
  step: number;
  lastW: number;
  lastH: number;
  table: Int32Array;
  history: Int32Array; // 0x100264B0
  profile: Int32Array; // 0x10026490
  textures: Int32Array[];
  texA: number;
  texB: number;
  avgA: number;
  avgB: number;
  avgC: number;
  frame: number;
  rand: (() => number) | null;
}

/** OpenSettings (defaults) followed by Initialize, as AVS's SetLibrary calls them. */
export function liquidInitialState(): LiquidState {
  return {
    fadePause: LIQUID_FADE_PAUSE,
    fadeLength: LIQUID_FADE_LENGTH,
    countdown: LIQUID_FADE_PAUSE,
    fading: false,
    step: 0,
    lastW: 0,
    lastH: 0,
    table: new Int32Array(0),
    history: new Int32Array(1024).fill(0x1000),
    profile: new Int32Array(1024),
    textures: liquidTextures(),
    texA: 0,
    texB: 0,
    avgA: 0,
    avgB: 0,
    avgC: 0,
    frame: 0,
    rand: null
  };
}

function pickTexture(state: LiquidState, rand: () => number): number {
  return (rand() * state.textures.length) >> 15;
}

/** Render (0x10001200). */
export function liquidRender(state: LiquidState, video: Int32Array, w: number, h: number, pitch: number, vd: SvpVisData, rand: () => number): void {
  if (state.lastW !== w || state.lastH !== h) {
    state.lastW = w;
    state.lastH = h;
    state.table = liquidRadiusTable(w, h);
    state.texA = pickTexture(state, rand);
    state.texB = pickTexture(state, rand);
  }
  const s0 = vd.spectrum[0];
  const s1 = vd.spectrum[1];
  const band = (from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += (s0[i] ?? 0) + (s1[i] ?? 0);
    return sum;
  };
  const oldA = state.avgA;
  state.avgA = ((band(0, 6) + 9 * oldA) / 10) | 0;
  state.avgB = ((band(30, 70) + 19 * state.avgB) / 20) | 0;
  state.avgC = ((band(70, 110) + 19 * state.avgC) / 20) | 0;
  const hist = state.history;
  hist.copyWithin(20, 0, 1004);
  const delta = (state.avgA - oldA) | 0;
  for (let k = 0; k < 20; k++) hist[k] = (hist[20]! - ((Math.imul(delta, 20 - k) / 4) | 0)) | 0;

  const f = liquidFrameParams(state.frame, w, h, state.avgB, state.avgC);
  const table = state.table;
  const texA = state.textures[state.texA]!;
  const texB = state.textures[state.texB]!;
  let u0 = f.u0;
  let v0 = f.v0;
  let t = 0;
  if (!state.fading) {
    for (let y = 0; y < h; y++) {
      let u = u0;
      let v = v0;
      let p = y * pitch;
      for (let x = 0; x < w; x++) {
        const scale = hist[table[t++]!]!;
        video[p++] = texA[liquidTexel(u, v, scale, f.offU, f.offV)]!;
        u = (u + f.p1) | 0;
        v = (v + f.p2) | 0;
      }
      u0 = (u0 + f.p3) | 0;
      v0 = (v0 + f.p4) | 0;
    }
    if (--state.countdown === 0) {
      state.fading = true;
      state.countdown = state.fadeLength;
      if (state.fadeLength > 0) {
        state.step = liquidFadeProfile(state.profile, (rand() * 4) >> 15, rand, state.fadeLength);
      } else {
        endFade(state, rand);
      }
    }
  } else {
    const prof = state.profile;
    for (let i = 0; i < 1024; i++) prof[i] = (prof[i]! + state.step) | 0;
    for (let y = 0; y < h; y++) {
      let u = u0;
      let v = v0;
      let p = y * pitch;
      for (let x = 0; x < w; x++) {
        const r = table[t++]!;
        const texel = liquidTexel(u, v, hist[r]!, f.offU, f.offV);
        const a = prof[r]!;
        if (a <= 0) video[p] = texA[texel]!;
        else if (a > 255) video[p] = texB[texel]!;
        else video[p] = liquidBlend(texA[texel]!, texB[texel]!, a);
        p++;
        u = (u + f.p1) | 0;
        v = (v + f.p2) | 0;
      }
      u0 = (u0 + f.p3) | 0;
      v0 = (v0 + f.p4) | 0;
    }
    if (--state.countdown === 0) endFade(state, rand);
  }
  state.frame = (state.frame + 1) | 0;
}

function endFade(state: LiquidState, rand: () => number): void {
  state.texA = state.texB;
  state.fading = false;
  state.countdown = state.fadePause;
  if (state.textures.length > 1) {
    do state.texB = pickTexture(state, rand);
    while (state.texB === state.texA);
  }
}

export function createLiquid(): SvpEffect {
  const state = liquidInitialState();
  return {
    render(video, width, height, pitch, vd, ctx) {
      if (!state.rand) state.rand = ctx.makeRand(1);
      liquidRender(state, video, width, height, pitch, vd, state.rand);
    }
  };
}

export const svp = {
  file: "liquid.svp",
  sha256: ["6032d997f162432c6014408836a51b973cc3866001eba471bdd882185cbc2bd7"],
  create(): SvpEffect {
    return createLiquid();
  }
};
