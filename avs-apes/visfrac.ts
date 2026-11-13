/*
 * VisFrac — AVS Render APE by Peter Pawlowski ("PP"), 2000.
 *
 * APE id:  "VisFrac v1.0 by PP"   (effect list name "Render APE / VisFrac", file vf.ape)
 * Binaries (both 27,136 bytes, MSVC 5.10 linker, dynamic msvcrt.dll):
 *   c5e22d748be303d42c06fca68c57d4c4174797f0ae890891c8c3db600312424b  built 12.09.2000 ("v1.2" in its help
 *       text and dialog) — pack tonic/v2-Made_in_Bulgaria
 *   d1dee36a6984b9d56f7305dc3c9eb4c0222fbddb197999c1456de172fdb27b9b  built 09.09.2000 — packs
 *       troubleshooter/Hopeless_Worlds and undefined/undefined2
 * Port by static reading of the binary (dumpbin /disasm + own PE parsing); nothing was run.
 * Notes with addresses and pseudo-code: scratch/avs-reference/apes/visfrac.md.
 *
 * Config (load_config is a raw memcpy of min(len, 0x834) bytes over the object's settings; every preset
 * stores 2100 = 0x834 bytes):
 *   0x000 u16  number of colour stops between the two end colours (0..256)
 *   0x002 u8   interpolation: 1 = sinusoidal, anything else = linear   (0x003 unused)
 *   0x004 u32  colour at 0.0 (0x00RRGGBB, AVS order)        default 0x000000
 *   0x008 u32  colour at 1.0                                 default 0xFFFFFF
 *   0x00C 256 x {u32 colour, f32 position}  stops (only the first <count> are read; the rest is often
 *         uninitialised memory saved by the plug-in, and is ignored)
 *   0x80C u32  model 0..9 (default 2):  0-4  Z(n+1) = Z(n)^k + Z(n-1) + C,        k = 2,3,4,6,8
 *                                        5-9  Z(n+1) = Z(n)^k + Z(n-1) + Z(n-2)*C, k = 2,3,4,6,8
 *   0x810 u32  iteration limit (default 50, max 255)
 *   0x814 f32  rotation speed of arg(C), radians per ms (default 0.001; dialog slider / 10000)
 *   0x818 f32  dVU: abs(C) = base * (1 - dVU * VU) (default 2.0; slider / 10)
 *   0x81C f32  radius base (default 0.2; slider / 100)
 *   0x820 f32  zoom (default 0.15; slider / 100): half-extent of the view = 3 * 0.01^zoom
 *   0x824 u8   reverse rotation, 0x825 u8 reverse dVU, 0x826 u8 pixel doubling (default 1),
 *   0x827 u8   zoom on beat
 *   0x828 u32  blend: 0 replace, 1 50/50, 2 additive, 3 subtractive (fb - colour), 4 max, 5 min
 *   0x82C f32  on-beat zoom (default 0.15)
 *   0x830 u32  bit 31 = "change model after N beats", bits 0..30 = N (default 100, off)
 *   The newer build resets an out-of-range model (>= 10) to 2, iterations > 255 to 50 and blend >= 6 to 0;
 *   the older build has no checks and only blends 0..3 (its 4 and 5 fall through to replace and 50/50).
 *   The port follows the newer build: one preset (uNDefineD - Push Away, from a pack that ships the older
 *   build) stores blend 4, which only the newer build's dialog can produce, so its author saw "max".
 *
 * Behaviour, per render():
 *   - GetTickCount delta * speed (+/-) is added to a float phase; VU = sum over i=1..575 of
 *     |w0[i-1]-w0[i]| + |w1[i-1]-w1[i]| of the signed waveform, * 1e-5;  r = float((1 -/+ VU*dVU) * base);
 *     C = (float(sin(phase)*r), float(cos(phase)*r)).
 *   - With "change model" on, every N-th beat picks one of the other four models of the same group with
 *     msvcrt rand() (the engine's shared generator, ctx.rand()).
 *   - The view is +-A by +-B with A*B = s^2 and A/B = w/h, s = 3*pow(0.01, zoom) (on-beat zoom on a beat
 *     frame when enabled). Z(0) = pixel coordinate, iterate until |Z|^2 >= 4 or the limit; the count
 *     (1..limit) indexes a gradient palette of limit+1 entries built from the stops (colour channels
 *     rounded with fistp, i.e. to nearest even). Escape counts are found for every 2nd column/row first and
 *     the pixels in between are only computed where the neighbours differ (the binary's own shortcut,
 *     reproduced exactly, including its row-overrun when the row length is not a multiple of 4).
 *   - Pixel doubling computes a (w+1)/2 x (h+2)/2 grid and stretches it with 50/50 averages.
 *   - The result is blended onto the framebuffer; render returns 0.
 *   - Arithmetic: the x87 path (precision control 53 bit, Win32 default) — Z(n) in registers as double,
 *     Z(n-1)/Z(n-2) through float stores, C and coordinates as floats; the operation order of each model
 *     is the binary's (z^6 is z^4*z^2 in model 3 but (z^3)^2 in model 8). Blends are the MMX versions the
 *     plug-in installs on any MMX CPU (50/50, add, sub on all four bytes); max/min are its C versions.
 *
 * Not reproduced / approximate:
 *   - The plug-in also has a 3DNow! path (two points at once in single precision, pavgusb 50/50 that
 *     rounds up) and MMXEXT max/min; it is only taken on AMD K6-2/Athlon-era CPUs. The port is the x87 path
 *     every other CPU takes (Intel, and AMD since 2011, which no longer report 3DNow!).
 *   - pow (msvcrt _CIpow), fsin/fcos and fldpi*t are JS Math.pow/sin/cos/PI: last-bit differences are
 *     possible before the values are rounded to float.
 *   - The palette is limited to its 256 entries; the binary would write past them for stop positions > 1.
 *   - Heap bytes read one past the end of the fractal buffer (doubling mode, w a multiple of 8) are 0 here.
 *   - The first frame's elapsed time is 0 (the binary measures from construction).
 *   - If GeissFluid ran earlier on the same thread it leaves the FPU in 24-bit precision; not modelled.
 */

export interface ApeContext {
  readonly w: number;
  readonly h: number;
  readonly isBeat: boolean;
  /** AVS's char visdata[2][2][576]: index (kind * 2 + channel) * 576 + i, kind 0 spectrum, 1 waveform. */
  readonly visdata: Int8Array;
  readonly visdataUnsigned: Uint8Array;
  /** MSVC rand() (0..32767) of the engine's shared generator (vis_avs's CRT). */
  rand(): number;
  /** A private MSVC rand() for a plug-in linked with its own static CRT (seed as srand). */
  makeRand(seed?: number): () => number;
  readonly registers: Float64Array;
  lineBlendMode: number;
  globalBuffer(index: number, create: boolean): Int32Array | null;
  /** GetTickCount()/timeGetTime() in ms. */
  now(): number;
}
export interface ApeEffect {
  render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number;
  destroy?(): void;
}

const f32 = Math.fround;
const CONFIG_SIZE = 0x834;

/** The settings block exactly as the plug-in keeps it (object offsets 0x404..0xC37). */
export interface VisFracConfig {
  stopCount: number;
  sinusoidal: boolean;
  color0: number;
  color1: number;
  /** All 256 stop slots (colour, position); only the first stopCount are used. */
  stopColors: Uint32Array;
  stopPositions: Float32Array;
  model: number;
  iterations: number;
  speed: number;
  dvu: number;
  radius: number;
  zoom: number;
  reverseRotation: boolean;
  reverseDvu: boolean;
  pixelDoubling: boolean;
  zoomOnBeat: boolean;
  blend: number;
  beatZoom: number;
  /** Raw dword: bit 31 = change model on beats, bits 0..30 = beat count. */
  beatChange: number;
}

/** load_config of the 12.09.2000 build: defaults of the constructor, memcpy, then the range checks. */
export function parseConfig(data: Uint8Array): VisFracConfig {
  const raw = new Uint8Array(CONFIG_SIZE);
  const dv = new DataView(raw.buffer);
  // constructor defaults (the stop slots are uninitialised heap memory there; zero here)
  dv.setUint16(0x000, 0, true);
  dv.setUint16(0x002, 0, true);
  dv.setUint32(0x004, 0x000000, true);
  dv.setUint32(0x008, 0xffffff, true);
  dv.setUint32(0x80c, 2, true);
  dv.setUint32(0x810, 50, true);
  dv.setUint32(0x814, 0x3a83126f, true); // 0.001f
  dv.setUint32(0x818, 0x40000000, true); // 2.0f
  dv.setUint32(0x81c, 0x3e4ccccd, true); // 0.2f
  dv.setUint32(0x820, 0x3e19999a, true); // 0.15f
  raw[0x824] = 0;
  raw[0x825] = 0;
  raw[0x826] = 1;
  raw[0x827] = 0;
  dv.setUint32(0x828, 0, true);
  dv.setUint32(0x82c, 0x3e19999a, true); // 0.15f
  dv.setUint32(0x830, 100, true);
  raw.set(data.subarray(0, Math.min(data.length, CONFIG_SIZE)));
  // range checks of the newer build (unsigned compares)
  if (dv.getUint32(0x828, true) >= 6) dv.setUint32(0x828, 0, true);
  if (dv.getUint32(0x80c, true) >= 10) dv.setUint32(0x80c, 2, true);
  if (dv.getUint32(0x810, true) > 255) dv.setUint32(0x810, 50, true);
  const stopColors = new Uint32Array(256);
  const stopPositions = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    stopColors[i] = dv.getUint32(0x0c + 8 * i, true);
    stopPositions[i] = dv.getFloat32(0x10 + 8 * i, true);
  }
  return {
    stopCount: dv.getUint16(0x000, true),
    sinusoidal: raw[0x002] === 1,
    color0: dv.getUint32(0x004, true),
    color1: dv.getUint32(0x008, true),
    stopColors,
    stopPositions,
    model: dv.getUint32(0x80c, true),
    iterations: dv.getUint32(0x810, true),
    speed: dv.getFloat32(0x814, true),
    dvu: dv.getFloat32(0x818, true),
    radius: dv.getFloat32(0x81c, true),
    zoom: dv.getFloat32(0x820, true),
    reverseRotation: raw[0x824] !== 0,
    reverseDvu: raw[0x825] !== 0,
    pixelDoubling: raw[0x826] !== 0,
    zoomOnBeat: raw[0x827] !== 0,
    blend: dv.getUint32(0x828, true),
    beatZoom: dv.getFloat32(0x82c, true),
    beatChange: dv.getUint32(0x830, true),
  };
}

/** fistp word with round-to-nearest-even; out of range gives the integer indefinite 0x8000. */
function fistpWord(v: number): number {
  if (Number.isNaN(v)) return -32768;
  let r = Math.round(v);
  if (r - v === 0.5 && (r & 1) !== 0) r -= 1;
  if (r < -32768 || r > 32767) return -32768;
  return r;
}

/** 100011B0: colour between c0 and c1 at t (float), per channel (c1-c0)*t + c0 rounded by fistp. */
export function interpolateColor(c0: number, c1: number, t: number, sinusoidal: boolean): number {
  if (sinusoidal) t = f32((1 - Math.cos(t * Math.PI)) * 0.5);
  let out = 0;
  for (let s = 0; s < 24; s += 8) {
    const a = (c0 >>> s) & 0xff;
    const b = (c1 >>> s) & 0xff;
    out |= (fistpWord((b - a) * t + a) & 0xff) << s;
  }
  return out >>> 0;
}

/** 10001250: the palette for iteration counts 0..n (n = (short) iteration limit). */
export function buildPalette(cfg: VisFracConfig, out: Uint32Array = new Uint32Array(256)): Uint32Array {
  const n = (cfg.iterations << 16) >> 16;
  const step = f32(1 / n);
  const sin = cfg.sinusoidal;
  const put = (i: number, c: number): void => {
    if (i >= 0 && i < out.length) out[i] = c >>> 0;
  };
  const guard = 1 << 16; // the binary has no bound; stop runaway loops on corrupt stops
  if (cfg.stopCount === 0) {
    for (let i = 0; i <= n; i++) put(i, interpolateColor(cfg.color0, cfg.color1, f32(i * step), sin));
    return out;
  }
  const stopColor = (j: number): number => (j < 256 ? cfg.stopColors[j]! : 0);
  const stopPos = (j: number): number => (j < 256 ? cfg.stopPositions[j]! : 0);
  put(0, cfg.color0);
  let i = 1;
  let v = step;
  const p0 = stopPos(0);
  // x87 fcomp + "test ah,41h": continue while v <= pos (or unordered)
  while ((v <= p0 || Number.isNaN(p0) || Number.isNaN(v)) && i < guard) {
    put(i, interpolateColor(cfg.color0, stopColor(0), f32(v / p0), sin));
    i++;
    v = i * step;
  }
  for (let j = 0; j < cfg.stopCount - 1; j++) {
    const pa = stopPos(j);
    const pb = stopPos(j + 1);
    v = i * step;
    // "test ah,1": continue while v < pos (or unordered)
    while ((v < pb || Number.isNaN(pb) || Number.isNaN(v)) && i < guard) {
      put(i, interpolateColor(stopColor(j), stopColor(j + 1), f32((v - pa) / (pb - pa)), sin));
      i++;
      v = i * step;
    }
  }
  const last = cfg.stopCount - 1;
  const lastColor = stopColor(last);
  const lastPos = stopPos(last);
  put(n, cfg.color1);
  for (; i < n; i++) put(i, interpolateColor(lastColor, cfg.color1, f32((i * step - lastPos) / (1 - lastPos)), sin));
  return out;
}

/**
 * The x87 model routines (table at 0x100071E0). Returns the 16-bit escape count (limit - bx):
 * 1..limit, the limit meaning "did not escape". (x, y) = Z(0) (floats), (cr, ci) = C (floats).
 */
export function iterate(model: number, x: number, y: number, cr: number, ci: number, limit: number): number {
  let bx = limit & 0xffff;
  let zr = x;
  let zi = y;
  let r2 = zr * zr;
  let i2 = zi * zi;
  // float history slots, all start as Z(0)
  let aRe = x, aIm = y, bRe = x, bIm = y, cRe = x, cIm = y;
  for (;;) {
    bx = (bx - 1) & 0xffff;
    const A = r2 - i2;
    if (bx === 0) break;
    let pr: number;
    let pi: number;
    switch (model) {
      case 0:
      case 5:
        pr = A;
        pi = zr * zi * 2;
        break;
      case 1:
      case 6: {
        const B = zr * zi * 2;
        pr = zr * A - zi * B;
        pi = zr * B + A * zi;
        break;
      }
      case 2:
      case 7: {
        const B = zr * zi * 2;
        pr = A * A - B * B;
        pi = B * A * 2;
        break;
      }
      case 3: {
        const B = zr * zi * 2;
        const C = A * A - B * B;
        const D = A * B * 2;
        pr = A * C - D * B;
        pi = B * C + A * D;
        break;
      }
      case 8: {
        const B = zr * zi * 2;
        const R3 = zr * A - zi * B;
        const I3 = zr * B + A * zi;
        pr = R3 * R3 - I3 * I3;
        pi = I3 * R3 * 2;
        break;
      }
      default: {
        // 4, 9: ((z^2)^2)^2
        const B = zr * zi * 2;
        const C = A * A - B * B;
        const D = B * A * 2;
        pr = C * C - D * D;
        pi = D * C * 2;
        break;
      }
    }
    let nr: number;
    let ni: number;
    if (model < 5) {
      // Z(n)^k + Z(n-1) + C; slot a = [esi] holds Z(n-1), swapped with b after the store
      nr = pr + aRe + cr;
      ni = pi + aIm + ci;
      aRe = bRe;
      aIm = bIm;
      bRe = f32(nr);
      bIm = f32(ni);
    } else {
      // Z(n)^k + Z(n-1) + Z(n-2)*C; a = [ebp] Z(n-1), b = [esi] Z(n-2), c = [edi] Z(n)
      const ur = pr + aRe;
      const ui = pi + aIm;
      const tr = cr * bRe - ci * bIm;
      const ti = cr * bIm + ci * bRe;
      ni = ui + ti;
      nr = ur + tr;
      bRe = aRe;
      bIm = aIm;
      aRe = cRe;
      aIm = cIm;
      cRe = f32(nr);
      cIm = f32(ni);
    }
    zr = nr;
    zi = ni;
    i2 = zi * zi;
    r2 = zr * zr;
    const m = r2 + i2;
    if (!(m < 4) && !Number.isNaN(m)) break;
  }
  return (limit - bx) & 0xffff;
}

/** The blend routines the plug-in installs on an MMX CPU (fastcall: a = new colour, b = framebuffer). */
function avg(a: number, b: number): number {
  return (
    ((((a & 0xff) + (b & 0xff)) >>> 1) |
      (((((a >>> 8) & 0xff) + ((b >>> 8) & 0xff)) >>> 1) << 8) |
      (((((a >>> 16) & 0xff) + ((b >>> 16) & 0xff)) >>> 1) << 16) |
      ((((a >>> 24) + (b >>> 24)) >>> 1) << 24)) >>>
    0
  );
}
function addSat(a: number, b: number): number {
  let out = 0;
  for (let s = 0; s < 32; s += 8) out |= Math.min(255, ((a >>> s) & 0xff) + ((b >>> s) & 0xff)) << s;
  return out >>> 0;
}
function subSat(a: number, b: number): number {
  let out = 0;
  for (let s = 0; s < 32; s += 8) out |= Math.max(0, ((b >>> s) & 0xff) - ((a >>> s) & 0xff)) << s;
  return out >>> 0;
}
function maxC(a: number, b: number): number {
  let out = a & 0xff000000;
  for (let s = 0; s < 24; s += 8) out |= Math.max((a >>> s) & 0xff, (b >>> s) & 0xff) << s;
  return out >>> 0;
}
function minC(a: number, b: number): number {
  let out = a & 0xff000000;
  for (let s = 0; s < 24; s += 8) out |= Math.min((a >>> s) & 0xff, (b >>> s) & 0xff) << s;
  return out >>> 0;
}
export const blendModes: ReadonlyArray<(a: number, b: number) => number> = [
  (a) => a >>> 0,
  avg,
  addSat,
  subSat,
  maxC,
  minC,
];

/** The view rectangle of a frame: [x0, x1, y0, y1] as the floats the plug-in stores. */
export function viewRect(w: number, h: number, zoom: number): [number, number, number, number] {
  const aspect = f32(w / h);
  const s = Math.pow(0.01, zoom) * 3;
  const s2 = s * f32(s);
  const A = Math.sqrt(aspect * f32(s2));
  const B = Math.sqrt(s2 / aspect);
  return [f32(-A), f32(A), f32(-B), f32(B)];
}

/** 10002E00: the VU value (double) from the signed waveform. */
export function vuLevel(visdata: Int8Array): number {
  let sum = 0;
  let p0 = visdata[1152]!;
  let p1 = visdata[1728]!;
  for (let i = 1; i < 576; i++) {
    const c0 = visdata[1152 + i]!;
    const c1 = visdata[1728 + i]!;
    sum += Math.abs(p0 - c0) + Math.abs(p1 - c1);
    p0 = c0;
    p1 = c1;
  }
  return sum * 1e-5;
}

export class VisFrac implements ApeEffect {
  readonly cfg: VisFracConfig;
  readonly palette: Uint32Array;
  model: number;
  phase = 0; // object +0xC50 (float)
  private lastTick = -1;
  private beatCount = 0;
  private buf = new Uint8Array(0);

  constructor(config: Uint8Array) {
    this.cfg = parseConfig(config);
    this.model = this.cfg.model;
    // rebuilt every frame by the plug-in from unchanging inputs
    this.palette = buildPalette(this.cfg);
  }

  /** 10003720: fills the escape-count grid (cols x rows bytes, row-major). */
  computeGrid(cols: number, rows: number, halfW: number, halfH: number, cr: number, ci: number,
    rect: [number, number, number, number]): Uint8Array {
    const need = cols * rows + 8;
    if (this.buf.length < need) {
      const nb = new Uint8Array(need);
      nb.set(this.buf);
      this.buf = nb;
    }
    const buf = this.buf;
    const [x0, x1, y0, y1] = rect;
    const dx = f32((x1 - x0) / halfW);
    const dy = f32((y1 - y0) / halfH);
    const m2dx = f32(dx * -2);
    const m4dx = f32(dx * -4);
    const model = this.model;
    const limit = this.cfg.iterations;
    const n4 = (cols + 3) >>> 2;
    const group = (xa: number, xb: number, y: number): number => {
      const ia = iterate(model, xa, y, cr, ci, limit);
      const ib = iterate(model, xb, y, cr, ci, limit);
      const ebx = ((ia & 0xffff) | ((ib & 0xffff) << 16)) >>> 0;
      if ((ia & 0xff) === (ib & 0xff)) return (ebx | (ebx << 8)) >>> 0;
      const ia2 = iterate(model, f32(xa + dx), y, cr, ci, limit);
      const ib2 = iterate(model, f32(xb + dx), y, cr, ci, limit);
      const ebp = ((ia2 & 0xffff) | ((ib2 & 0xffff) << 16)) >>> 0;
      return (ebx | (ebp << 8)) >>> 0;
    };
    const put = (p: number, v: number): void => {
      if (p + 3 >= buf.length) return;
      buf[p] = v & 0xff;
      buf[p + 1] = (v >>> 8) & 0xff;
      buf[p + 2] = (v >>> 16) & 0xff;
      buf[p + 3] = v >>> 24;
    };
    const get = (p: number): number =>
      p < 0 || p + 3 >= buf.length ? 0 : (buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16) | (buf[p + 3]! << 24)) >>> 0;
    if (cols > 0) {
      let curx = x0;
      let p = 0;
      for (let g = 0; g < n4; g++) {
        put(p, group(curx, f32(curx - m2dx), y0));
        p += 4;
        curx = f32(curx - m4dx);
      }
    }
    let r = 2;
    if (rows > 2) {
      for (; r < rows; r += 2) {
        const yr = f32(r * dy + y0);
        const yr1 = f32((r - 1) * dy + y0);
        if (cols === 0) continue;
        let pr = r * cols;
        let pr1 = (r - 1) * cols;
        let pr2 = (r - 2) * cols;
        let curx = x0;
        for (let g = 0; g < n4; g++) {
          const xb = f32(curx - m2dx);
          const wr = group(curx, xb, yr);
          put(pr, wr);
          pr += 4;
          const above = get(pr2);
          pr2 += 4;
          put(pr1, above === wr ? wr : group(curx, xb, yr1));
          pr1 += 4;
          curx = f32(curx - m4dx);
        }
      }
    }
    if (r === rows && cols > 0) {
      let p = (rows - 1) * cols;
      let curx = x0;
      for (let g = 0; g < n4; g++) {
        put(p, group(curx, f32(curx - m2dx), y1));
        p += 4;
        curx = f32(curx - m4dx);
      }
    }
    return buf;
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    const cfg = this.cfg;
    const w = ctx.w | 0;
    const h = ctx.h | 0;
    // GetTickCount delta (first frame: 0)
    const now = Math.floor(ctx.now()) >>> 0;
    if (this.lastTick < 0) this.lastTick = now;
    const elapsed = (now - this.lastTick) >>> 0;
    this.lastTick = now;
    if (cfg.beatChange & 0x80000000) {
      if (ctx.isBeat) {
        this.beatCount = (this.beatCount + 1) >>> 0;
        if (this.beatCount >= (cfg.beatChange & 0x7fffffff) >>> 0) {
          this.beatCount = 0;
          let m = ctx.rand() & 3;
          if (this.model > 4) m += 5;
          if (m >= this.model) m++;
          this.model = m;
        }
      }
    } else {
      this.beatCount = 0;
    }
    let d = elapsed * cfg.speed;
    if (cfg.reverseRotation) d = -d;
    this.phase = f32(d + this.phase);
    let vu = vuLevel(ctx.visdata) * cfg.dvu;
    if (cfg.reverseDvu) vu = -vu;
    const radius = f32((1 - vu) * cfg.radius);
    if (w <= 0 || h <= 0) return 0;
    const zoom = cfg.zoomOnBeat && ctx.isBeat ? cfg.beatZoom : cfg.zoom;
    const rect = viewRect(w, h, zoom);
    let cols: number;
    let rows: number;
    let halfW: number;
    let halfH: number;
    if (cfg.pixelDoubling) {
      cols = (w + 1) >> 1;
      rows = (h + 2) >> 1;
      if (cols & 1) cols++;
      if (cols & 2) cols += 2;
      halfW = f32((w - 1) * 0.5);
      halfH = f32((h - 1) * 0.5);
    } else {
      cols = w;
      rows = h;
      halfW = f32(w - 1);
      halfH = f32(h - 1);
    }
    const cr = f32(Math.sin(this.phase) * radius);
    const ci = f32(Math.cos(this.phase) * radius);
    const buf = this.computeGrid(cols, rows, halfW, halfH, cr, ci, rect);
    this.draw(framebuffer, w, h, buf, cols);
    return 0;
  }

  /** The output loops of render(): grid -> palette -> blend onto the framebuffer. */
  draw(framebuffer: Int32Array, w: number, h: number, buf: Uint8Array, cols: number): void {
    const cfg = this.cfg;
    const pal = this.palette;
    const blend = blendModes[cfg.blend] ?? blendModes[0]!;
    const total = w * h;
    if (!cfg.pixelDoubling) {
      for (let i = 0; i < total; i++) framebuffer[i] = blend(pal[buf[i]!]!, framebuffer[i]! >>> 0) | 0;
      return;
    }
    // doubling: even output rows from grid row y/2, odd rows average grid rows y>>1 and (y+1)>>1;
    // odd columns average neighbouring cells. Two pixels per step, so an odd width writes one pixel
    // into the next row (blended again there).
    const write = (p: number, c: number): void => {
      if (p < total) framebuffer[p] = blend(c, framebuffer[p]! >>> 0) | 0;
    };
    for (let y = 0; y < h; y++) {
      let p = y * w;
      if (y & 1) {
        const r0 = (y >>> 1) * cols;
        const r1 = ((y + 1) >>> 1) * cols;
        let prev = avg(pal[buf[r1]!]!, pal[buf[r0]!]!);
        for (let x = 0; x < w;) {
          write(p++, prev);
          x += 2;
          const k = x >>> 1;
          const next = avg(pal[buf[r0 + k] ?? 0]!, pal[buf[r1 + k] ?? 0]!);
          write(p++, avg(prev, next));
          prev = next;
        }
      } else {
        const r0 = (y >>> 1) * cols;
        let prev = pal[buf[r0]!]!;
        for (let x = 0; x < w;) {
          write(p++, prev);
          x += 2;
          const next = pal[buf[r0 + (x >>> 1)] ?? 0]!;
          write(p++, avg(prev, next));
          prev = next;
        }
      }
    }
  }
}

export const ape = {
  id: "VisFrac v1.0 by PP",
  sha256: [
    "c5e22d748be303d42c06fca68c57d4c4174797f0ae890891c8c3db600312424b",
    "d1dee36a6984b9d56f7305dc3c9eb4c0222fbddb197999c1456de172fdb27b9b",
  ],
  create(config: Uint8Array): ApeEffect {
    return new VisFrac(config);
  },
};
