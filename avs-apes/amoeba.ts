/*
 * APE "Amoeba" — amoeba.ape by Steven Wittens (UnConeD), "Render / Amoeba" (PE timestamp 19 Mar 2002).
 * Binary sha256 2d23112a93c2f8c8758a2077b71f341822ecc1fdd6eadace9904ef838cb10e09.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/amoeba.md.
 *
 * Config (load_config 0x10002B40; save_config 0x10002BF0 always writes 20 bytes): when len <= 20 the
 * bytes are copied over the defaults as they are (memcpy, so a partial int keeps its other default
 * bytes); a longer config is ignored entirely. Five little-endian int32:
 *   +0  arms      default 8          clamped to >= 1         ("Arms")
 *   +4  segments  default 30         clamped to >= 2         ("Segments": history length per arm)
 *   +8  color     default 0xFFFFFF   0x00RRGGBB              ("Color")
 *   +12 mode      default 1          0 Replace, 1 Additive, 2 Blend 50/50; any other value = Additive
 *   +16 size      default 50         clamped to 1..100       ("Size %")
 * The three configs in the collection are (8,30,#ffffff,2,50), (3,30,#ff0080,2,100), (5,30,#00ff00,2,50).
 *
 * render (0x10002290), draws into framebuffer, returns 0. All maths is x87 with doubles; every
 * float→int is the CRT's truncating conversion (0x100031E0 sets RC=chop and does fistp qword).
 *   - "volume": the left waveform (visdata[1][0], 576 bytes) is read as 288 little-endian int16
 *     (a quirk of the original: byte pairs, not samples) and summed; vol = min(trunc(sum/144), 32768).
 *   - s2c = trunc((7*s2c + vol)/8); s30 = trunc((4*s30 + 6*vol)/10); phase += s2c / 16384.
 *   - pos = (pos+1) % segments; angle[arm][pos] = arm/arms*2π + phase + vol*0.7/32768.
 *   - Each arm is a polyline from the centre (w/2, h/2) through the history slots
 *     j = segments-1 … 1 (slot (pos+j) % segments, i.e. from the newest-but-one angle at the centre
 *     to the oldest at the tip; the angle just written is drawn from the next frame on), radius
 *     r = trunc((segments-j-1) * R / segments) with R = trunc(50*min(w,h)/100), point
 *     x = trunc(cx + cos(a)*size*0.02*r*A/8192), y likewise with sin, A = min(s30+5000, 32768).
 *     Arms are drawn in order 0..arms-1, each from the centre outwards.
 *   - Lines use the plug-in's own anti-aliased line (0x100014B0), not AVS's line(): 3 pixels per
 *     major-axis step with a cosine/sqrt intensity profile (see aaLine), blended per pixel:
 *     Replace = (c*a>>8)+(d*(255-a)>>8) per channel, Blend 50/50 = the same with a>>1,
 *     Additive = min((c*a>>8)+d, 255). AVS's line blend mode / width are not used (no
 *     AVS_APE_SetExtInfo export). isBeat is not used.
 *   - A w*h byte buffer is allocated and cleared every frame but never read (dead code; omitted).
 *   - When w*h changes, all angles are reset to arm/arms*2π (phase and smoothing are kept).
 *
 * Approximation: Math.cos/Math.sin/Math.sqrt replace x87 fcos/fsin/fsqrt (assumes the process'
 * default 53-bit precision control). fsqrt is exact; fcos/fsin can differ from Math.cos/sin in the
 * last bit, which can move a truncated coordinate or alpha by one only at exact boundaries.
 * Everything else (integer steps, truncations, constants, draw order) is the binary's.
 */

export interface ApeContext {
  readonly w: number;                 // frame width and height in pixels
  readonly h: number;
  readonly isBeat: boolean;           // isBeat & 1 of AVS's render() call
  /** AVS's char visdata[2][2][576]: index (kind * 2 + channel) * 576 + i, kind 0 spectrum, 1 waveform. */
  readonly visdata: Int8Array;
  readonly visdataUnsigned: Uint8Array; // the same bytes, unsigned
  /** MSVC rand() (0..32767) of the engine's shared generator (vis_avs's CRT). */
  rand(): number;
  /** A private MSVC rand() for a plug-in linked with its own static CRT (seed as srand). */
  makeRand(seed?: number): () => number;
  /** reg00..reg99 (APEinfo.global_registers), shared with all code of the preset. */
  readonly registers: Float64Array;
  /** *APEinfo.lineblendmode: low byte mode (0 replace, 1 add, 2 max, 3 avg, 4 sub 1-2, 5 sub 2-1,
   *  6 multiply, 7 adjustable, 8 xor, 9 min), bits 8..15 adjustable value, bits 16..23 width. */
  lineBlendMode: number;
  /** APEinfo.getNbuffer(w, h, n, do_alloc): buffer n (0..7) as w*h pixels, or null when it does not
   *  exist and create is false. Writes into it are kept. */
  globalBuffer(index: number, create: boolean): Int32Array | null;
  /** GetTickCount()/timeGetTime() in ms. */
  now(): number;
}
export interface ApeEffect {
  /** AVS's render(): pixels 0x00RRGGBB (blue in the low byte, as AVS's int framebuffer), row 0 at
   *  the top, w * h. Return 1 when the result is in fbout (AVS then swaps), else 0. */
  render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number;
  destroy?(): void;
}

export interface AmoebaConfig {
  arms: number;
  segments: number;
  color: number;
  /** 0 Replace, 1 Additive, 2 Blend 50/50 (anything else draws additively). */
  mode: number;
  size: number;
}

/** Constructor defaults (0x10001300). */
export const AMOEBA_DEFAULTS: Readonly<AmoebaConfig> = { arms: 8, segments: 30, color: 0xffffff, mode: 1, size: 50 };

/** load_config (0x10002B40): memcpy over the defaults when len <= 20, then the clamps. */
export function parseAmoebaConfig(config: Uint8Array): AmoebaConfig {
  const raw = new Uint8Array(20);
  const dv = new DataView(raw.buffer);
  dv.setInt32(0, AMOEBA_DEFAULTS.arms, true);
  dv.setInt32(4, AMOEBA_DEFAULTS.segments, true);
  dv.setInt32(8, AMOEBA_DEFAULTS.color, true);
  dv.setInt32(12, AMOEBA_DEFAULTS.mode, true);
  dv.setInt32(16, AMOEBA_DEFAULTS.size, true);
  if (config.length <= 20) raw.set(config);
  let arms = dv.getInt32(0, true);
  let segments = dv.getInt32(4, true);
  let size = dv.getInt32(16, true);
  if (!(arms > 1)) arms = 1;
  if (!(segments > 2)) segments = 2;
  if (!(size > 1)) size = 1;
  if (!(size < 100)) size = 100;
  return { arms, segments, color: dv.getInt32(8, true), mode: dv.getInt32(12, true), size };
}

// Constants of .rdata 0x1000A008.. (the exact doubles).
const K_ANGLE = 0.012319607843137256; // 3.1415/255
const K_HALFPI = 1.57;
const INV255 = 0.00392156862745098;   // 1/255
const TWO_PI = 6.283185307179586;

/** Replace blend (0x10002160): per channel (c*a>>8) + (d*(255-a)>>8); only the low byte of a counts. */
export function blendReplace(c: number, d: number, alpha: number): number {
  const a = alpha & 0xff;
  const ia = (255 - a) & 0xff;
  const s = ((((c & 0xff00ff) * a) & 0xff00ffff) | (((c & 0xff00) * a) & 0xff0000)) >>> 8;
  const t = ((((d & 0xff00ff) * ia) & 0xff00ffff) | (((d & 0xff00) * ia) & 0xff0000)) >>> 8;
  return (s + t) | 0;
}

/** "Blend 50/50" (0x100021D0): the replace blend with alpha >> 1. */
export function blendHalf(c: number, d: number, alpha: number): number {
  return blendReplace(c, d, (alpha & 0xff) >> 1);
}

/** Additive blend (0x100021F0): per channel min((c*a>>8) + d, 255). */
export function blendAdditive(c: number, d: number, alpha: number): number {
  const a = alpha & 0xff;
  let g = ((((c & 0xff00) * a) & 0xff0000) >>> 16) + ((d >>> 8) & 0xff);
  if (g >= 0xff) g = 0xff;
  let r = (((c & 0xff00ff) * a) >>> 24) + ((d >>> 16) & 0xff);
  if (r >= 0xff) r = 0xff;
  let b = ((((c & 0xff) * a) & 0xff00) >>> 8) + (d & 0xff);
  if (b >= 0xff) b = 0xff;
  return (r << 16) | (g << 8) | b;
}

/** The three per-step intensities of the AA line for the error term t (0..254). */
export function centerAlpha(t: number): number {
  return Math.trunc(Math.cos(t * K_ANGLE - K_HALFPI) * 128.0 + 128.0);
}
function sqrtProfile(v: number): number {
  const b = Math.trunc(v > 0.0 ? v : 0.0) & 0xff; // max(v, 0) via fcom, truncated, low byte
  return Math.trunc(Math.sqrt(b * INV255) * 255.0);
}
/** Neighbour on the side of the next minor-axis step. */
export function forwardAlpha(t: number): number { return sqrtProfile(t * -0.9 + 127.0); }
/** Neighbour on the other side. */
export function backAlpha(t: number): number { return sqrtProfile(t * 0.9 - 101.5); }

type Blend = (c: number, d: number, a: number) => number;

/**
 * The plug-in's anti-aliased line (0x100014B0). Endpoints are swapped so that x1 <= x2. Vertical:
 * y1..y2 inclusive, (x,y) a=255 then (x-1,y), (x+1,y) a=32. Horizontal: x1..x2-1 (end excluded),
 * (x,y+1), (x,y-1) a=32 then (x,y) a=255. Otherwise a Bresenham walk over the major axis, both ends
 * inclusive, with err starting at 0: t = |trunc(-255*err/major) + 127|, centre pixel with
 * centerAlpha(t), then the minor-axis neighbour in the step direction with forwardAlpha(t) and
 * the opposite one with backAlpha(t); err += minor, if 2*err >= major the minor coordinate steps.
 * Pixels outside the frame read as 0 and are not written.
 */
export function aaLine(fb: Int32Array, color: number, w: number, h: number,
                       x1: number, y1: number, x2: number, y2: number, mode: number): void {
  const blend: Blend = mode === 0 ? blendReplace : mode === 2 ? blendHalf : blendAdditive;
  const plot = (x: number, y: number, a: number): void => {
    const inside = x >= 0 && x < w && y >= 0 && y < h;
    const r = blend(color, inside ? fb[y * w + x]! : 0, a);
    if (inside) fb[y * w + x] = r;
  };
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (dx < 0) {
    let t = x1; x1 = x2; x2 = t;
    t = y1; y1 = y2; y2 = t;
    dx = -dx; dy = -dy;
  }
  let err = 0;
  if (dx === 0) {
    if (dy > 0) {
      for (let y = y1; y <= y2; y++) { plot(x1, y, 255); plot(x1 - 1, y, 0x20); plot(x1 + 1, y, 0x20); }
    } else {
      for (let y = y1; y >= y2; y--) { plot(x1, y, 255); plot(x1 - 1, y, 0x20); plot(x1 + 1, y, 0x20); }
    }
    return;
  }
  if (dy > 0) {
    if (dy >= dx) {
      let x = x1;
      for (let y = y1; y <= y2; y++) {
        const t = Math.abs(Math.trunc(-(255 * err) / dy) + 127);
        plot(x, y, centerAlpha(t)); plot(x + 1, y, forwardAlpha(t)); plot(x - 1, y, backAlpha(t));
        err += dx;
        if (2 * err >= dy) { x++; err -= dy; }
      }
    } else {
      let y = y1;
      for (let x = x1; x <= x2; x++) {
        const t = Math.abs(Math.trunc(-(255 * err) / dx) + 127);
        plot(x, y, centerAlpha(t)); plot(x, y + 1, forwardAlpha(t)); plot(x, y - 1, backAlpha(t));
        err += dy;
        if (2 * err >= dx) { y++; err -= dx; }
      }
    }
  } else if (dy < 0) {
    const ady = -dy;
    if (dx <= ady) {
      let x = x1;
      for (let y = y1; y >= y2; y--) {
        const t = Math.abs(Math.trunc((255 * err) / dy) + 127);
        plot(x, y, centerAlpha(t)); plot(x + 1, y, forwardAlpha(t)); plot(x - 1, y, backAlpha(t));
        err += dx;
        if (2 * err >= ady) { x++; err += dy; }
      }
    } else {
      let y = y1;
      for (let x = x1; x <= x2; x++) {
        const t = Math.abs(Math.trunc(-(255 * err) / dx) + 127);
        plot(x, y, centerAlpha(t)); plot(x, y - 1, forwardAlpha(t)); plot(x, y + 1, backAlpha(t));
        err -= dy;
        if (2 * err >= dx) { y--; err -= dx; }
      }
    }
  } else {
    for (let x = x1; x < x2; x++) { plot(x, y1 + 1, 0x20); plot(x, y1 - 1, 0x20); plot(x, y1, 255); }
  }
}

/** The "volume" of render: 288 little-endian int16 of visdata[1][0] summed, /144, capped at 32768. */
export function amoebaVolume(visdataUnsigned: Uint8Array): number {
  let sum = 0;
  const base = 2 * 576;
  for (let k = 0; k < 288; k++) {
    const v = visdataUnsigned[base + 2 * k]! | (visdataUnsigned[base + 2 * k + 1]! << 8);
    sum += (v << 16) >> 16;
  }
  const vol = Math.trunc(sum / 144);
  return vol >= 0x8000 ? 0x8000 : vol;
}

export class Amoeba implements ApeEffect {
  readonly cfg: AmoebaConfig;
  /** angle[arm * segments + slot], doubles (0x1C). */
  angles: Float64Array;
  lastWH = 0;      // 0x20
  lastCount = 0;   // 0x24
  pos = 0;         // 0x28
  smoothRot = 0;   // 0x2C
  smoothAmp = 0;   // 0x30
  phase = 0;       // 0x38

  constructor(config: Uint8Array) {
    this.cfg = parseAmoebaConfig(config);
    this.angles = new Float64Array(this.cfg.arms * this.cfg.segments);
  }

  private resetAngles(): void {
    const { arms, segments } = this.cfg;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TWO_PI;
      for (let j = 0; j < segments; j++) this.angles[segments * i + j] = a;
    }
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    const { w, h } = ctx;
    const { arms, segments, color, mode, size } = this.cfg;
    const wh = Math.imul(w, h);
    if (this.lastWH !== wh) {
      this.lastWH = wh;
      this.resetAngles();
    }
    const count = Math.imul(arms, segments);
    if (this.lastCount !== count) {
      this.lastCount = count;
      this.angles = new Float64Array(count);
      this.resetAngles();
    }
    this.pos = (this.pos + 1) % segments;

    const vol = amoebaVolume(ctx.visdataUnsigned);
    this.smoothRot = Math.trunc((7 * this.smoothRot + vol) / 8);
    this.smoothAmp = Math.trunc((4 * this.smoothAmp + 6 * vol) / 10);
    this.phase = this.smoothRot * 6.103515625e-5 + this.phase;
    const volTerm = vol * 2.13623046875e-5;
    for (let i = 0; i < arms; i++) {
      this.angles[segments * i + this.pos] = (i / arms) * TWO_PI + this.phase + volTerm;
    }

    const minWH = h < w ? h : w;
    const scale = size * 0.02;
    const cx = Math.trunc(w / 2);
    const cy = Math.trunc(h / 2);
    const R = Math.trunc((50 * minWH) / 100);
    for (let i = 0; i < arms; i++) {
      let px = cx;
      let py = cy;
      for (let j = segments - 1; j > 0; j--) {
        const slot = (this.pos + j) % segments;
        const a = this.angles[i * segments + slot]!;
        const r = Math.trunc(((segments - j - 1) * R) / segments);
        let amp = this.smoothAmp + 5000;
        if (amp >= 0x8000) amp = 0x8000;
        const x = Math.trunc(Math.cos(a) * scale * r * amp * 0.0001220703125 + cx);
        const y = Math.trunc(Math.sin(a) * scale * r * amp * 0.0001220703125 + cy);
        aaLine(framebuffer, color, w, h, px, py, x, y, mode);
        px = x;
        py = y;
      }
    }
    return 0;
  }
}

export const ape = {
  id: "Amoeba",
  sha256: ["2d23112a93c2f8c8758a2077b71f341822ecc1fdd6eadace9904ef838cb10e09"],
  create(config: Uint8Array): ApeEffect {
    return new Amoeba(config);
  }
};
