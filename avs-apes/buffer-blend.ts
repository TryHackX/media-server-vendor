/*
 * APE "Misc: Buffer blend" — buffer.ape 1.02 by Björn Stabel aka TomyLobo ("Compiled on August 7th
 * 2004", PE timestamp 10 Aug 2004).
 * Binary sha256 8b49648108e180cfc5a9a080836c3a207d97e42cbf62f3ff62f1bed2c2eff95f.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/buffer-blend.md.
 *
 * Config (load_config 0x10001520; save_config 0x100015E0 always writes all 16 bytes): up to four
 * little-endian int32, each read only while at least 4 bytes remain, otherwise the default stays:
 *   +0  enabled  default 1   any non-zero value is "on"
 *   +4  bufferB  default 0   the source "b":      0..7 = global buffer 1..8, 8 = current frame
 *   +8  bufferA  default 8   the destination "a": same coding (dialog labels "Buffer B:"/"Buffer A:")
 *   +12 mode     default 10  0 a=b, 1 a=a+b, 2 max, 3 (a+b)/2, 4 a-b, 5 b-a, 6 a*b/256,
 *                            7 "a=a*x+b*(1-x)", 8 xor, 9 min, 10 |a-b|
 * Every real preset in the collection stores exactly 16 bytes.
 *
 * render (0x10001070), always returns 0 (no swap):
 *   if !enabled → return 0.
 *   b = bufferB == 8 ? framebuffer : getNbuffer(w, h, bufferB, 1)   (called first, always allocates)
 *   a = bufferA == 8 ? framebuffer : getNbuffer(w, h, bufferA, 1)
 *   a[i] = op(a[i], b[i]) in place, MMX, on all four bytes of each pixel (the top byte too):
 *     modes 0 1 2 4 5 8 9 10 move 8 bytes per step for (w*h)>>1 steps, so with an odd w*h the last
 *     pixel is left alone; modes 3 6 7 do one pixel per step over all w*h pixels.
 *     0 movq copy; 1 paddusb; 2 psubusb+paddb = max; 3 bytes→words, paddw, psrlw 1 = (a+b)>>1
 *     (exact, not (a>>1)+(b>>1)); 4 psubusb a-b; 5 psubusb b-a; 6 pmullw, psrlw 8 = (a*b)>>8;
 *     8 pxor; 9 a-(a-b) saturating = min; 10 (a-b)+(b-a) saturating = |a-b|.
 *     7 "adjustable": x comes from object field +0x14, which only the constructor writes (0) — no
 *     config byte and no dialog control sets it. With x = 0 the code computes
 *     pmulhw(a, 0) + pmulhw(b, 0x100) = 0 + (b*256)>>16 = 0 per byte, so mode 7 clears "a" to
 *     0x00000000 (the author's fixed-point scale is off by 256; this is what the binary does).
 *   A mode outside 0..10 does nothing (but both buffers were still fetched/allocated).
 *
 * Not recoverable / choices of the port: a buffer index outside 0..8 makes getNbuffer return NULL
 * and the plug-in writes through it (an access violation in AVS); no preset does that — the port
 * then does nothing. w*h < 2 would make the plug-in's `loop` run 2^32 times; the port simply
 * processes nothing there.
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

export interface BufferBlendConfig {
  enabled: number;
  /** Source "b": 0..7 global buffer 1..8, 8 = current frame. */
  bufferB: number;
  /** Destination "a", written in place: 0..7 global buffer 1..8, 8 = current frame. */
  bufferA: number;
  mode: number;
}

/** The constructor's defaults (0x10001010): enabled, Buffer 1 → Current, |a-b|. */
export const BUFFER_BLEND_DEFAULTS: Readonly<BufferBlendConfig> = { enabled: 1, bufferB: 0, bufferA: 8, mode: 10 };

/** load_config (0x10001520): each int32 only while 4 more bytes remain. */
export function parseBufferBlendConfig(config: Uint8Array): BufferBlendConfig {
  const out: BufferBlendConfig = { ...BUFFER_BLEND_DEFAULTS };
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  const len = config.byteLength;
  let pos = 0;
  if (len - pos >= 4) { out.enabled = view.getInt32(pos, true); pos += 4; }
  if (len - pos >= 4) { out.bufferB = view.getInt32(pos, true); pos += 4; }
  if (len - pos >= 4) { out.bufferA = view.getInt32(pos, true); pos += 4; }
  if (len - pos >= 4) { out.mode = view.getInt32(pos, true); }
  return out;
}

const CURRENT_FRAME = 8;

/** paddusb on the four bytes of one pixel. */
function addUs(a: number, b: number): number {
  let r = 0;
  for (let s = 0; s < 32; s += 8) {
    const v = ((a >>> s) & 255) + ((b >>> s) & 255);
    r |= (v > 255 ? 255 : v) << s;
  }
  return r;
}
/** psubusb a, b on the four bytes of one pixel. */
function subUs(a: number, b: number): number {
  let r = 0;
  for (let s = 0; s < 32; s += 8) {
    const v = ((a >>> s) & 255) - ((b >>> s) & 255);
    r |= (v < 0 ? 0 : v) << s;
  }
  return r;
}
function maxBytes(a: number, b: number): number {
  let r = 0;
  for (let s = 0; s < 32; s += 8) {
    const x = (a >>> s) & 255, y = (b >>> s) & 255;
    r |= (x > y ? x : y) << s;
  }
  return r;
}
function minBytes(a: number, b: number): number {
  let r = 0;
  for (let s = 0; s < 32; s += 8) {
    const x = (a >>> s) & 255, y = (b >>> s) & 255;
    r |= (x < y ? x : y) << s;
  }
  return r;
}
function absDiffBytes(a: number, b: number): number {
  let r = 0;
  for (let s = 0; s < 32; s += 8) {
    const v = ((a >>> s) & 255) - ((b >>> s) & 255);
    r |= (v < 0 ? -v : v) << s;
  }
  return r;
}
/** punpcklbw, paddw, psrlw 1, packuswb. */
function avgBytes(a: number, b: number): number {
  let r = 0;
  for (let s = 0; s < 32; s += 8) r |= ((((a >>> s) & 255) + ((b >>> s) & 255)) >> 1) << s;
  return r;
}
/** punpcklbw, pmullw, psrlw 8, packuswb. */
function mulBytes(a: number, b: number): number {
  let r = 0;
  for (let s = 0; s < 32; s += 8) r |= ((((a >>> s) & 255) * ((b >>> s) & 255)) >> 8) << s;
  return r;
}

/**
 * The blend loop of render (0x1000115D…0x100012CE): a[i] = op(a[i], b[i]) for `count` = w*h pixels.
 * Modes 0 1 2 4 5 8 9 10 run (count >> 1) 8-byte steps (an odd count leaves the last pixel);
 * modes 3 6 7 run count 4-byte steps. Unknown modes do nothing.
 */
export function blendBuffers(mode: number, a: Int32Array, b: Int32Array, count: number): void {
  const pairs = count < 2 ? 0 : (count >>> 1) * 2;
  switch (mode) {
    case 0: for (let i = 0; i < pairs; i += 1) a[i] = b[i]!; break;
    case 1: for (let i = 0; i < pairs; i += 1) a[i] = addUs(a[i]!, b[i]!); break;
    case 2: for (let i = 0; i < pairs; i += 1) a[i] = maxBytes(a[i]!, b[i]!); break;
    case 3: for (let i = 0; i < count; i += 1) a[i] = avgBytes(a[i]!, b[i]!); break;
    case 4: for (let i = 0; i < pairs; i += 1) a[i] = subUs(a[i]!, b[i]!); break;
    case 5: for (let i = 0; i < pairs; i += 1) a[i] = subUs(b[i]!, a[i]!); break;
    case 6: for (let i = 0; i < count; i += 1) a[i] = mulBytes(a[i]!, b[i]!); break;
    // pmulhw(a, x=0) + pmulhw(b, 0x100) = 0 for every byte value: the destination is cleared.
    case 7: for (let i = 0; i < count; i += 1) a[i] = 0; break;
    case 8: for (let i = 0; i < pairs; i += 1) a[i] = a[i]! ^ b[i]!; break;
    case 9: for (let i = 0; i < pairs; i += 1) a[i] = minBytes(a[i]!, b[i]!); break;
    case 10: for (let i = 0; i < pairs; i += 1) a[i] = absDiffBytes(a[i]!, b[i]!); break;
    default: break;
  }
}

export const ape = {
  id: "Misc: Buffer blend",
  sha256: ["8b49648108e180cfc5a9a080836c3a207d97e42cbf62f3ff62f1bed2c2eff95f"],
  create(config: Uint8Array): ApeEffect {
    const cfg = parseBufferBlendConfig(config);
    return {
      render(ctx: ApeContext, framebuffer: Int32Array): number {
        if (cfg.enabled === 0) return 0;
        // getNbuffer(w, h, n, 1) for b first, then for a; 8 means the frame itself.
        const b = cfg.bufferB === CURRENT_FRAME ? framebuffer : ctx.globalBuffer(cfg.bufferB, true);
        const a = cfg.bufferA === CURRENT_FRAME ? framebuffer : ctx.globalBuffer(cfg.bufferA, true);
        if (!a || !b) return 0; // the plug-in would write through NULL here
        blendBuffers(cfg.mode, a, b, ctx.w * ctx.h);
        return 0;
      }
    };
  }
};
