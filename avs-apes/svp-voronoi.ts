/*
 * Voronoi.svp — "Voronoi by Calodox", a Sonique visualization plug-in, as AVS's
 * "Render / SVP Loader" runs it.
 *
 * Library: voronoi.svp
 * Binary:  sha256 83223f55b1ce791a4a0ed5fbb89e9b14ce3577a4106bf1dd3f9f1bc1267ed5f9
 *          (PE32 DLL, MSVC 6 linker, 01.09.1999, static CRT, no msvcrt import)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x10007330): Reserved 0, name "Voronoi by Calodox", lRequired = 1 (VI_WAVEFORM),
 * Initialize 0x10001410, Render 0x10001430, SaveSettings = OpenSettings = 0x10001510 (`return 1`).
 *
 * Settings: none. The plug-in imports no profile functions; OpenSettings("avs.ini") does nothing.
 *
 * Behaviour (Render, 0x10001430):
 *  - If width > 511 or height > 383 it returns at once and draws NOTHING (the frame is left as
 *    it is): its image buffer is a static 512 x 384 x 4 bytes. This is reproduced.
 *  - 15 sites move on Lissajous paths from t = (int)(MillSec / 30) (the even ones on
 *    sin(0.0490625 * (t + 120 i)), cos(0.098125 * (t + 170 i)), the odd ones on
 *    sin(0.012265625 * (t + 130 i)), sin(0.012265625 * (t + 170 i)), scaled 0.1..0.9 of the frame).
 *    All sites take one colour: entry (int)(MillSec * 0.02) & 255 of a 256-entry B,G,R palette
 *    (values 0..63, read from 0x10007030).
 *  - Every even pixel (x, y) finds the squared distance to the nearest of sites 1..14 (site 0 is
 *    computed but never used), measured from (x + 2, y), shifts it right by 2 (width < 160),
 *    3 (width < 300) or 5 bits, and adds it to the colour, clamped to 255 per channel; the odd
 *    pixel repeats its left neighbour.
 *  - A bar graph of channel 0 of the waveform (refreshed only when more than 50 ms passed since
 *    the last refresh) brightens, per column, (sample ^ 0x80) >> 3 rows centred on the middle row:
 *    c = (c + 255) >> 1 per channel.
 *  - The buffer (alpha byte 0) REPLACES the whole frame.
 *  Integer arithmetic throughout except the site paths (x87, 53-bit precision as the CRT's
 *  _setdefaultprecision sets it, truncating _ftol) and the column -> sample scale, which is
 *  stored as a float32 (512 / width).
 *
 * Not recovered / approximate:
 *  - fsin/fcos are x87 instructions; Math.sin/Math.cos may differ in the last bit, which can move
 *    a site by one pixel only when a coordinate lands exactly on an integer.
 *  - The bar for frames lower than 30 rows would write above the buffer in the original (into
 *    the plug-in's own globals); the port clips it to the frame.
 *  - The DLL's statics are shared by every SVP effect that loads the same file in one Winamp
 *    process; the port keeps one state per create().
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

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** 0x10007030: 256 entries of 3 bytes, in pixel byte order (blue, green, red). */
export const VORONOI_PALETTE: Uint8Array = hexBytes(
  "0000000100000201000301000402000502000703000804000904000a05000b05000c06000e07000f0700100800110800" +
  "120900130a00150a00160b00170b00180c00190d001a0d001c0e001d0e001e0f001f1000201000211100231100241200" +
  "2512002613002714002814002a15002b15002c16002d17002e17002f1800311800321900331a00341a00351b00361b00" +
  "381c00391d003a1d003b1e003c1e003d1f003f20003f20003e1f013e1e023d1e033c1d033c1c043b1c053b1b063a1a07" +
  "39190739190838180937170a37170a36160b36150c35140d34140e34130e33120f321210321111311011310f12300f13" +
  "2f0e142f0d152e0d152d0c162d0b172c0a182c0a182b09192a081a2a081b29071c28061c28051d27051e27041f26031f" +
  "250320250221240122230023230023230123230123230222240222240322240321240421250421250521250520250620" +
  "26072026071f26081f26081f27091e27091e270a1e270a1e280b1d280b1d280c1d280c1c280d1c290e1c290e1b290f1b" +
  "290f1b2a101b2a101a2a111a2a111a2b12192b12192b13192b13182c14182c15182c15182c16172d16172d17172d1716" +
  "2d18162e18162e19152e19152e1a152e1a152f1b142f1c142f1c142f1d13301d13301e13301e12301f12311f12312012" +
  "31201131211132211132221032231032231033240f33240f33250f33250f33260e34260e34270e34270d34280d35280d" +
  "35290c352a0c352a0c362b0c362b0b362c0b362c0b372d0a372d0a372e0a372e09382f09382f09383009383108393108" +
  "3932083932073933073933073933073932073932073931073931073930063a30063a2f063a2f063a2e063a2e053a2d05" +
  "3b2d053b2c053b2c053b2b043b2b043b2a043c2a043c29043c29043c28033c28033c27033d27033d26033d26023d2502" +
  "3d25023d24023e24023e23013e23013e22013e22013e21013f20003d1f003a1e00371c00351b00321a002f18002c1700" +
  "2a15002714002413002111001f10001c0e00190d00160c00140a001109000e07000b0600090500060300030200000000"
);

export const VORONOI_MAX_WIDTH = 511;
export const VORONOI_MAX_HEIGHT = 383;
export const VORONOI_SITES = 15;

/** _ftol: truncation toward zero; callers use the low 32 bits. */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

/** 0x10001010: the 15 site positions (x, y pairs) for t = (int)(MillSec / 30). */
export function voronoiSites(t: number, width: number, height: number): Int32Array {
  const out = new Int32Array(VORONOI_SITES * 2);
  let a = t | 0;
  let b = t | 0;
  let c = t | 0;
  for (let i = 0; i < VORONOI_SITES; i++) {
    let x: number;
    let y: number;
    if (i & 1) {
      x = ftol((Math.sin(a * 0.012265625) * 0.4 + 0.5) * width);
      y = ftol((Math.sin(c * 0.012265625) * 0.4 + 0.5) * height);
    } else {
      x = ftol((Math.sin(b * 0.0490625) * 0.4 + 0.5) * width);
      y = ftol((Math.cos(c * 0.098125) * 0.4 + 0.5) * height);
    }
    out[i * 2] = x;
    out[i * 2 + 1] = y;
    a = (a + 0x82) | 0;
    b = (b + 0x78) | 0;
    c = (c + 0xaa) | 0;
  }
  return out;
}

/** 0x10001150: shift applied to the squared distance. */
export function voronoiShift(width: number): number {
  return width >= 300 ? 5 : width >= 160 ? 3 : 2;
}

/** 0x10001010 head: palette entry from MillSec. */
export function voronoiPaletteIndex(millSec: number): number {
  return ftol((millSec >>> 0) * 0.02) & 0xff;
}

/** 0x10001150: the distance field into buf (w * h pixels, stride w); sites 1..14 only. */
export function voronoiField(buf: Int32Array, sites: Int32Array, colour: number, width: number, height: number): void {
  const shift = voronoiShift(width);
  const p0 = VORONOI_PALETTE[colour * 3] ?? 0;
  const p1 = VORONOI_PALETTE[colour * 3 + 1] ?? 0;
  const p2 = VORONOI_PALETTE[colour * 3 + 2] ?? 0;
  let off = 0;
  for (let y = 0; y < height; y++) {
    let pixel = 0;
    for (let x = 0; x < width; x++, off++) {
      if ((x & 1) === 0) {
        let best = 0x7fffffff;
        for (let k = 14; k >= 1; k--) {
          const dy = y - (sites[k * 2 + 1] ?? 0);
          const dx = x + 2 - (sites[k * 2] ?? 0);
          const d = dy * dy + dx * dx;
          if (d < best) best = d;
        }
        const add = best >>> shift;
        const b = Math.min(255, p0 + add);
        const g = Math.min(255, p1 + add);
        const r = Math.min(255, p2 + add);
        pixel = (r << 16) | (g << 8) | b;
      }
      buf[off] = pixel;
    }
  }
}

/** 0x10001310: the waveform bars, brightening (c + 255) >> 1. */
export function voronoiBars(buf: Int32Array, wave: Uint8Array, width: number, height: number): void {
  const scale = Math.fround(512 / width);
  const mid = height >> 1;
  for (let x = 0; x < width; x++) {
    let h = (wave[ftol(x * scale)] ?? 0) >> 3;
    if (h > 0x38) h = 0x38;
    const top = mid - (h >> 1);
    for (let row = 0; row < h; row++) {
      const y = top + row;
      if (y < 0 || y >= height) continue;
      const i = y * width + x;
      const v = buf[i] ?? 0;
      const b = ((v & 0xff) + 255) >> 1;
      const g = (((v >> 8) & 0xff) + 255) >> 1;
      const r = (((v >> 16) & 0xff) + 255) >> 1;
      buf[i] = (v & 0xff000000) | (r << 16) | (g << 8) | b;
    }
  }
}

export function createVoronoi(): SvpEffect {
  // Initialize (0x10001410) clears the 512-byte waveform copy; the refresh time starts at 0.
  const wave = new Uint8Array(512);
  let lastRefresh = 0;
  const buf = new Int32Array(512 * 384);
  return {
    render(video, width, height, pitch, vd) {
      if (width > VORONOI_MAX_WIDTH || height > VORONOI_MAX_HEIGHT) return;
      const millSec = vd.millSec >>> 0;
      const t = ftol(millSec * 0.03333333333333333);
      const sites = voronoiSites(t, width, height);
      voronoiField(buf, sites, voronoiPaletteIndex(millSec), width, height);
      if (((millSec - lastRefresh) >>> 0) > 50) {
        const src = vd.waveform[0];
        for (let i = 0; i < 512; i++) wave[i] = ((src[i] ?? 0) + 0x80) & 0xff;
        lastRefresh = millSec;
      }
      if (width > 0) voronoiBars(buf, wave, width, height);
      for (let y = 0, src = 0; y < height; y++) {
        const row = y * pitch;
        for (let x = 0; x < width; x++) video[row + x] = buf[src++] ?? 0;
      }
    }
  };
}

export const svp = {
  file: "voronoi.svp",
  sha256: ["83223f55b1ce791a4a0ed5fbb89e9b14ce3577a4106bf1dd3f9f1bc1267ed5f9"],
  create(): SvpEffect {
    return createVoronoi();
  }
};
