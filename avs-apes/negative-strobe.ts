/*
 * APE "Virtual Effect: Negative Strobe" — NegativeStrobe.ape by goebish (Virtual Effect Network,
 * vfx.fr.st; PE timestamp 1 May 2002, the same /GZ debug-style MSVC 6 build as ScreenReverse.ape,
 * linked against MSVCRT.dll; get_desc "Virtual Effect / Negative Strobe").
 * Binary sha256 4b8727d41cdf1f0b761376da248c94056a1f0ed50bf39304cc59530a4ec5ab3b (24 576 bytes) from
 * http://goebish.free.fr/vfx/NegativeStrobe.zip, downloaded by the owner on 10.11.2026; the same file
 * (md5 a5057da06e42cdfed3bd45ea07950f6a) is in APE.zip of the Winamp forum thread "AVS APE Files
 * Wanted". Port by static reading of the binary (capstone disassembly, no execution). Notes with
 * addresses: scratch/avs-reference/apes/negative-strobe.md.
 *
 * Object (constructor 0x10001000): +4 enabled (1), +8 speed (1), +0x0C counter (0, never saved).
 * Config (load_config 0x1000134F; save_config 0x1000141B writes 8 bytes): little-endian int32, each
 * read only while at least 4 bytes remain:
 *   +0 enabled  (check box 1000; any non-zero value is "on")
 *   +4 speed    (trackbar 1004, range 1…50)
 * Changing either in the dialog resets the counter. The one preset with it stores (1, 16).
 *
 * render (0x1000107B) reads neither visdata nor isBeat:
 *   if (!enabled) return 0;                       // the counter does not move either
 *   counter += 1;
 *   if (counter > speed * 2) counter = 0;         // signed 32-bit compares
 *   if (counter >= speed) return 0;
 *   for (i = 0; i < w*h; i++) fbout[i] = framebuffer[i] ^ 0xFFFFFF;
 *   return 1;
 * So the picture is inverted for `speed` frames out of every 2·speed + 1 (the first cycle starts at
 * counter 1: speed − 1 inverted frames), steadily, whatever the music. The byte above the colour
 * (AVS's unused alpha) is kept. Nothing left unrecovered.
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
  /** *APEinfo.lineblendmode (see screen-reverse.ts). */
  lineBlendMode: number;
  /** APEinfo.getNbuffer(w, h, n, do_alloc). */
  globalBuffer(index: number, create: boolean): Int32Array | null;
  /** GetTickCount()/timeGetTime() in ms. */
  now(): number;
}
export interface ApeEffect {
  /** AVS's render(): pixels 0x00RRGGBB, row 0 at the top, w * h. 1 when the result is in fbout. */
  render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number;
  destroy?(): void;
}

export interface NegativeStrobeConfig {
  enabled: number;
  speed: number;
}

/** Constructor 0x10001000. */
export const NEGATIVE_STROBE_DEFAULTS: Readonly<NegativeStrobeConfig> = { enabled: 1, speed: 1 };

export function parseNegativeStrobeConfig(config: Uint8Array): NegativeStrobeConfig {
  const out: NegativeStrobeConfig = { ...NEGATIVE_STROBE_DEFAULTS };
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  let pos = 0;
  for (const field of ["enabled", "speed"] as const) {
    if (config.byteLength - pos < 4) break;
    out[field] = view.getInt32(pos, true);
    pos += 4;
  }
  return out;
}

/** One render's counter step (0x100010A9…0x100010DE): the new counter, and whether this frame inverts. */
export function strobeStep(counter: number, speed: number): { counter: number; invert: boolean } {
  let next = (counter + 1) | 0;
  if (next > Math.imul(speed, 2)) next = 0;
  return { counter: next, invert: next < speed };
}

/** The copy loop (0x100010ED): every pixel of fbout, its colour bits flipped. */
export function invertInto(framebuffer: Int32Array, fbout: Int32Array, count: number): void {
  for (let i = 0; i < count; i += 1) fbout[i] = framebuffer[i]! ^ 0xffffff;
}

export const ape = {
  id: "Virtual Effect: Negative Strobe",
  sha256: ["4b8727d41cdf1f0b761376da248c94056a1f0ed50bf39304cc59530a4ec5ab3b"],
  create(config: Uint8Array): ApeEffect {
    const cfg = parseNegativeStrobeConfig(config);
    let counter = 0; // +0x0C
    return {
      render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number {
        if (cfg.enabled === 0) return 0;
        const step = strobeStep(counter, cfg.speed);
        counter = step.counter;
        if (!step.invert) return 0;
        invertInto(framebuffer, fbout, ctx.w * ctx.h);
        return 1;
      }
    };
  }
};
