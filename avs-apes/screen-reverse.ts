/*
 * APE "Virtual Effect: Screen Reverse" — ScreenReverse.ape, "Screen Reverse APE by Goebish"
 * (PE timestamp 1 May 2002, a /GZ debug-style MSVC 6 build linked against MSVCRT.dll; get_desc
 * "Virtual Effect / Screen Reverse").
 * Binary sha256 164970dd4875a6486a8ef84bc12d08dbee5eec4457328235b2de9895435bce8a.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/screen-reverse.md.
 *
 * Config (load_config 0x100014EF, save_config 0x1000160F writes 12 bytes): little-endian int32,
 * each read only while at least 4 bytes remain:
 *   +0 "Reverse Horizontal" (object +0x04, default 1)
 *   +4 "Reverse Vertical"   (+0x08, default 1)
 *   +8 "On beat reverse"    (+0x0C, default 0)
 * Any non-zero value is "on". All 4 presets in the collection store 12 bytes.
 *
 * render (0x10001082):
 *   if (!onBeat) state = 1;                      // byte +0x10, 0 after construction, not in the config
 *   if (isBeat && onBeat) state = !state;        // toggles on every beat, before anything else
 *   if (!horizontal && !vertical) return 0;
 *   if (!state) return 0;                        // on-beat mode starts "off" until the first beat
 *   both:        fbout[w*h-1-i] = fb[i]                            (a 180° turn)
 *   horizontal:  fbout[y*w + x] = fb[y*w + (w-1-x)]                (left-right mirror)
 *   vertical:    fbout[y*w + x] = fb[(h-1-y)*w + x]                (upside down)
 *   return 1 (every pixel of fbout is written; AVS swaps).
 * A pure permutation: an odd width/height keeps the centre column/row in place, nothing is blended.
 * Nothing left unrecovered. Host nuance: the binary tests isBeat != 0, so AVS's threaded pre-init
 * render (isBeat = 0x80000000) toggles the on-beat state too; the port only has ctx.isBeat (isBeat & 1).
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

export interface ScreenReverseConfig {
  horizontal: number;
  vertical: number;
  onBeat: number;
}

/** Constructor 0x10001000. */
export const SCREEN_REVERSE_DEFAULTS: Readonly<ScreenReverseConfig> = { horizontal: 1, vertical: 1, onBeat: 0 };

export function parseScreenReverseConfig(config: Uint8Array): ScreenReverseConfig {
  const out: ScreenReverseConfig = { ...SCREEN_REVERSE_DEFAULTS };
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  let pos = 0;
  for (const field of ["horizontal", "vertical", "onBeat"] as const) {
    if (config.byteLength - pos < 4) break;
    out[field] = view.getInt32(pos, true);
    pos += 4;
  }
  return out;
}

/** The three copy loops of render (0x10001136, 0x1000119C, 0x10001252). */
export function reverseInto(fb: Int32Array, fbout: Int32Array, w: number, h: number, horizontal: boolean, vertical: boolean): void {
  if (horizontal && vertical) {
    const last = w * h - 1;
    for (let i = 0; i < w * h; i += 1) fbout[last - i] = fb[i]!;
  } else if (horizontal) {
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      for (let x = 0; x < w; x += 1) fbout[row + x] = fb[row + (w - 1 - x)]!;
    }
  } else if (vertical) {
    for (let y = 0; y < h; y += 1) {
      const dst = y * w, src = (h - 1 - y) * w;
      for (let x = 0; x < w; x += 1) fbout[dst + x] = fb[src + x]!;
    }
  }
}

export const ape = {
  id: "Virtual Effect: Screen Reverse",
  sha256: ["164970dd4875a6486a8ef84bc12d08dbee5eec4457328235b2de9895435bce8a"],
  create(config: Uint8Array): ApeEffect {
    const cfg = parseScreenReverseConfig(config);
    let state = 0; // byte +0x10
    return {
      render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number {
        if (cfg.onBeat === 0) state = 1;
        if (ctx.isBeat && cfg.onBeat !== 0) state = state === 0 ? 1 : 0;
        const horizontal = cfg.horizontal !== 0, vertical = cfg.vertical !== 0;
        if (!horizontal && !vertical) return 0;
        if (state === 0) return 0;
        reverseInto(framebuffer, fbout, ctx.w, ctx.h, horizontal, vertical);
        return 1;
      }
    };
  }
};
