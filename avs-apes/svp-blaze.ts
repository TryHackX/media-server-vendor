/*
 * Blaze.uvs — "Blaze", a Sonique UltraVis plug-in, as AVS's "Render / SVP Loader" runs it.
 *
 * Library: blaze.uvs
 * Binary:  sha256 803bc090a52113716d873d986477f77165e358ab1e8a78458fb2ba7925dac0fb
 *          (PE32 DLL, MSVC 6 linker, 11.02.2000, static multithreaded CRT; only export the
 *          mangled ?QueryModule@@YAPAUUltraVisInfo@@XZ, which r_svp.cpp falls back to)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x10008030), the svp_vis.h layout: Reserved 0, name "Blaze", lRequired = 6
 * (VI_SPECTRUM | SONIQUEVISPROC), Initialize 0x10001010, Render 0x10001140,
 * SaveSettings 0x10001700 (frees the image buffer, returns 1), OpenSettings 0x10001720 (`return 1`).
 * The dword after it (0x1000804C, 0xFFFFFF) is the plug-in's flame colour, set to 0xFFFF00 before
 * every use.
 *
 * Settings: none (no profile imports).
 *
 * Behaviour (Render 0x10001140), per call:
 *  - A private image buffer of height * pitch pixels is (re)allocated and zeroed whenever width,
 *    height or pitch change. The buffer is copied over the WHOLE frame first (the frame shows the
 *    state left by the previous call), then updated for the next call.
 *  - Spectrum: 10 bands, each the integer mean of Spectrum[0][i] + Spectrum[1][i] over bins
 *    0-1, 2-3, 4-5, 6-8, 9-13, 14-38, 39-77, 78-161, 162-179, 180-255.
 *  - 10 emitters on a box of W' = w - w%10 - 10 by H' = h - h%10 - 10 centred in the frame:
 *    emitter i sits at x = (int)((i + 0.25) * W' * 0.1f + xoff) on the bottom row of the box;
 *    its level is (int)(band_i * H' * 0.0025f). When the level rises above the stored one, the
 *    emitter stores it, holds it 3 calls, and draws a horizontal segment of 6 * level / 300 + 1
 *    pixels of 0x01FFFF00 at `level` rows above the bottom; otherwise the stored level drops 5 per
 *    call once the hold has run out (it may go negative).
 *  - Fire pass over rows 2 .. h-2, top to bottom, left to right: every pixel with a non-zero top
 *    byte decays (R - 1, G - 4, B - 1, floored at 0; top byte 1 unless all zero) and then, by
 *    rand() % 14: 0 -> copied to the left pixel, 1 -> copied to the right pixel (which is then
 *    processed in turn), 2..11 -> decayed again (R - 1, G - 2, B - 1) and written with top byte 1
 *    to the two pixels above, 12..13 -> the pixel below is cleared.
 *  - rand() is the DLL's own static-CRT rand: per-thread state, seed 1, never reseeded, called only
 *    from Render (AVS's render thread) -> ctx.makeRand(1).
 *  - Pixels carry the plug-in's marker byte: active fire pixels are 0x01RRGGBB, as the DLL leaves
 *    them in AVS's framebuffer.
 *  - Integer arithmetic throughout except the two scale products (x87 doubles, no transcendental
 *    functions, truncating _ftol), so the port is bit-exact given the same rand() sequence.
 *
 * Not recovered / approximate:
 *  - Nothing in the drawing path. Initialize also fills a 512-entry colour table (0x10008D74) and
 *    zeroes several globals that nothing ever reads; not ported.
 *  - The DLL's statics (buffer, emitters, rand state) are shared by every SVP effect that loads
 *    this file in one Winamp process (and SaveSettings frees the shared buffer without clearing
 *    the pointer); the port keeps one state per create(), as a freshly loaded DLL.
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

/** Spectrum bands of Render: [first bin, last bin, divisor]. */
export const BLAZE_BANDS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [2, 3, 2], [4, 5, 2], [6, 8, 3], [9, 13, 5],
  [14, 38, 25], [39, 77, 39], [78, 161, 84], [162, 179, 18], [180, 255, 76]
];

/** 0x100016E4: rand() % 14 -> action (0 left, 1 right, 2 rise, 3 clear below). */
export const BLAZE_ACTIONS: readonly number[] = [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3];

const F_0_25 = 0.25; // 0x100070C8 (float)
const F_0_0025 = Math.fround(0.0025); // 0x100070CC (float) = 0.0024999999441206455
const F_0_1 = Math.fround(0.1); // 0x100070D0 (float) = 0.10000000149011612
const FLAME = 0xffff00; // 0x1000804C as Render sets it

/** _ftol: truncation; low 32 bits. */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

/** Band means of Spectrum[0] + Spectrum[1] (signed int division). */
export function blazeBands(s0: Uint8Array, s1: Uint8Array): Int32Array {
  const out = new Int32Array(10);
  BLAZE_BANDS.forEach(([first, last, divisor], band) => {
    let sum = 0;
    for (let i = first; i <= last; i++) sum += (s0[i] ?? 0) + (s1[i] ?? 0);
    out[band] = (sum / divisor) | 0;
  });
  return out;
}

export interface BlazeGeometry {
  boxW: number; // W' = w - w%10 - 10
  xoff: number; // (w - W') / 2
  boxH: number; // H' = h - h%10 - 10
  bottom: number; // (h - H') / 2 + H' - 1
  emitterX: Int32Array; // x of the 10 emitters
}

/** Box and emitter positions of Render. */
export function blazeGeometry(w: number, h: number): BlazeGeometry {
  const boxW = (w - (w % 10) - 10) | 0;
  const xoff = ((w - boxW) / 2) | 0;
  const boxH = (h - (h % 10) - 10) | 0;
  const bottom = ((((h - boxH) / 2) | 0) + boxH - 1) | 0;
  const kx = boxW * F_0_1;
  const emitterX = new Int32Array(10);
  for (let i = 0; i < 10; i++) emitterX[i] = ftol((i + F_0_25) * kx + xoff);
  return { boxW, xoff, boxH, bottom, emitterX };
}

/** Emitter level from a band mean. */
export function blazeLevel(band: number, boxH: number): number {
  return ftol(band * (boxH * F_0_0025));
}

/** Width in pixels of the segment an emitter draws for `level`. */
export function blazeSegment(level: number): number {
  return ((Math.imul(level, 6) / 300) | 0) + 1;
}

export interface BlazeState {
  buffer: Int32Array | null;
  bufW: number; // 0x10009E18
  bufH: number; // 0x10008D6C
  bufPitch: number; // 0x10008D60
  level: Int32Array; // 0x10009D78 + 16 i
  hold: Int32Array; // 0x10009D7C + 16 i
}

/** Initialize (0x10001010): buffer pointer and stored size cleared, emitter levels 0 (hold is bss, 0). */
export function blazeInitialState(): BlazeState {
  return { buffer: null, bufW: 0, bufH: 0, bufPitch: 0, level: new Int32Array(10), hold: new Int32Array(10) };
}

/** One pixel of the fire pass at index p of a buffer of row stride w. */
export function blazeFirePixel(buf: Int32Array, p: number, w: number, rand: () => number): void {
  const v = buf[p] ?? 0;
  if ((v & 0xff000000) === 0) return;
  let r = ((v >>> 16) & 255) - 1;
  if (r < 0) r = 0;
  let g = ((v >>> 8) & 255) - 4;
  if (g < 0) g = 0;
  let b = (v & 255) - 1;
  if (b < 0) b = 0;
  let nv = (((r << 8) + g) << 8) + b;
  if (nv !== 0) nv += 0x1000000;
  buf[p] = nv;
  switch (BLAZE_ACTIONS[rand() % 14]) {
    case 0:
      buf[p - 1] = nv;
      break;
    case 1:
      buf[p + 1] = nv;
      break;
    case 2: {
      r -= 1;
      if (r < 0) r = 0;
      g -= 2;
      if (g < 0) g = 0;
      b -= 1;
      if (b < 0) b = 0;
      const up = ((((r + 0x100) << 8) + g) << 8) + b;
      buf[p - 2 * w] = up;
      buf[p - w] = up;
      break;
    }
    case 3:
      buf[p + w] = 0;
      break;
  }
}

/** Render (0x10001140). */
export function blazeRender(
  state: BlazeState, video: Int32Array, w: number, h: number, pitch: number,
  s0: Uint8Array, s1: Uint8Array, rand: () => number
): void {
  const geo = blazeGeometry(w, h);
  if (state.bufW !== w || state.bufH !== h || state.bufPitch !== pitch || !state.buffer) {
    state.buffer = new Int32Array(Math.max(0, Math.imul(h, pitch)));
    state.bufH = h;
    state.bufW = w;
    state.bufPitch = pitch;
  }
  const buf = state.buffer;
  const bands = blazeBands(s0, s1);
  video.set(buf.subarray(0, Math.min(buf.length, video.length)));

  for (let i = 0; i < 10; i++) {
    const xi = geo.emitterX[i]!;
    const lvl = blazeLevel(bands[i]!, geo.boxH);
    if (lvl > state.level[i]!) {
      state.level[i] = lvl;
      state.hold[i] = 3;
      const top = (geo.bottom - lvl) | 0;
      const count = blazeSegment(lvl);
      for (let j = 0; j < count; j++) {
        const x = (xi + j) | 0;
        if (x < 0 || x >= w || top < 0 || top >= h) continue;
        buf[top * pitch + j + xi] = FLAME | 0x1000000;
      }
    }
    if (state.hold[i] !== 0) state.hold[i] = state.hold[i]! - 1;
    else state.level[i] = (state.level[i]! - 5) | 0;
  }

  if (h - 1 > 2 && w > 0) {
    for (let y = 2; y <= h - 2; y++) {
      for (let x = 0, p = y * w; x < w; x++, p++) blazeFirePixel(buf, p, w, rand);
    }
  }
}

export function createBlaze(): SvpEffect {
  const state = blazeInitialState();
  let rand: (() => number) | null = null;
  return {
    render(video, width, height, pitch, vd, ctx) {
      rand ??= ctx.makeRand(1);
      blazeRender(state, video, width, height, pitch, vd.spectrum[0], vd.spectrum[1], rand);
    }
  };
}

export const svp = {
  file: "blaze.uvs",
  sha256: ["803bc090a52113716d873d986477f77165e358ab1e8a78458fb2ba7925dac0fb"],
  create(): SvpEffect {
    return createBlaze();
  }
};
