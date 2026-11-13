/*
 * APE "Nullsoft TV v1" — tv.ape (Nullsoft, PE timestamp 15 Nov 1999; get_desc "Render APE / TV").
 * Binary sha256 47e251f762d7ed75708c484b99f34a4cdd1bff9cfddd13df2db3b9d9c6fb4e24.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/tv.md.
 *
 * Config (load_config 0x100010A0; save_config 0x10001120 writes 20 bytes), little-endian int32:
 *   +0   enabled (default 1) — read when len >= 4
 *   +4…+19 four "static colors" 0x00RRGGBB (defaults 0x00FF00, 0x00C000, 0x008000, 0x004000) —
 *        read only when at least 16 bytes remain after the enabled field, all four or none.
 * All 6 presets in the collection store 20 bytes.
 *
 * render (0x10001190), returns 0 (in place):
 *   if (!enabled) return 0;
 *   for every pixel in memory order (w*h, row 0 first):
 *     c = colors[rand() & 3];
 *     px = ((px >>> 1) & 0xFF7F7F7F) + ((c >>> 1) & 0xFF7F7F7F)   // per byte (px>>1)+(c>>1), top byte too
 *   The noise is therefore a 50/50 mix (each operand halved first) of the frame with one of the four
 *   colours per pixel, no beat or audio dependence.
 *
 * Random generator: rand() at 0x1000159A is the statically linked C runtime's (seed variable
 * 0x10005050, initial value 1, never re-seeded — there is no srand and the seed has no other
 * writer), i.e. a private MSVC LCG, not vis_avs's: ctx.makeRand(1). It is a static of the DLL, so all
 * TV instances share one sequence and it is not reset on preset changes; the port keeps it at module
 * level for that reason.
 *
 * Nothing left unrecovered; w*h <= 0 does nothing as in the plug-in.
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

export interface TvConfig {
  enabled: number;
  colors: [number, number, number, number];
}

/** Constructor 0x10001000. */
export const TV_DEFAULTS: Readonly<TvConfig> = { enabled: 1, colors: [0x00ff00, 0x00c000, 0x008000, 0x004000] };

export function parseTvConfig(config: Uint8Array): TvConfig {
  const out: TvConfig = { enabled: TV_DEFAULTS.enabled, colors: [...TV_DEFAULTS.colors] };
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  let pos = 0;
  if (config.byteLength >= 4) { out.enabled = view.getInt32(0, true); pos = 4; }
  if (config.byteLength - pos >= 16) {
    for (let k = 0; k < 4; k += 1) out.colors[k] = view.getInt32(pos + 4 * k, true);
  }
  return out;
}

/** The DLL's CRT rand() (seed 0x10005050), shared by every instance. */
let sharedRand: (() => number) | null = null;

/** Back to a freshly loaded DLL (for tests). */
export function resetTvRand(): void {
  sharedRand = null;
}

/** The render loop (0x100011B3…0x100011D9). */
export function tvNoise(fb: Int32Array, count: number, colors: readonly number[], rand: () => number): void {
  for (let i = 0; i < count; i += 1) {
    const c = colors[rand() & 3]!;
    fb[i] = (((fb[i]! >>> 1) & 0xff7f7f7f) + ((c >>> 1) & 0xff7f7f7f)) | 0;
  }
}

export const ape = {
  id: "Nullsoft TV v1",
  sha256: ["47e251f762d7ed75708c484b99f34a4cdd1bff9cfddd13df2db3b9d9c6fb4e24"],
  create(config: Uint8Array): ApeEffect {
    const cfg = parseTvConfig(config);
    return {
      render(ctx: ApeContext, framebuffer: Int32Array): number {
        if (cfg.enabled === 0) return 0;
        const count = ctx.w * ctx.h;
        if (count <= 0) return 0;
        sharedRand ??= ctx.makeRand(1);
        tvNoise(framebuffer, count, cfg.colors, sharedRand);
        return 0;
      }
    };
  }
};
