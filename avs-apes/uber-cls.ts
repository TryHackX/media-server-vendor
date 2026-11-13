/*
 * APE "Shreyas:uberCLSv2.00" — CLS_dynamic.ape, "Dynamic Clear Screen APE made by Shreyas Potnis"
 * (PE timestamp 4 May 2003; get_desc "Render / Dynamic Clear Screen").
 * Binary sha256 d03bd929a8d06d27a49d80c43e76a797b1a06750e37c331337145af54303850f.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/uber-cls.md.
 *
 * Config (load_config 0x100019C8, save_config 0x10001B7F writes all 40 bytes): ten little-endian
 * int32, each read only while at least 4 bytes remain:
 *   +0  enabled              (object +0x04, default 1)
 *   +4  colour 0x00RRGGBB    (+0x28, default 0x0000FF) — used only when "random on beat" is off
 *   +8  random red           (+0x08)  ┐
 *   +12 random blue          (+0x10)  │ booleans, any non-zero value is "on". The constructor never
 *   +16 random green         (+0x0C)  │ sets +0x08/+0x0C/+0x10/+0x18, so a dialog that was never
 *   +20 exclude very dark    (+0x14)  │ touched saved heap garbage there — several presets store
 *   +24 random colours on beat (+0x18)│ ASCII text in these fields, which simply counts as "on".
 *   +28 morphing colours     (+0x20)  │ (The port uses 0 for them when a config is too short.)
 *   +32 brightness pump      (+0x1C)  ┘
 *   +36 blend mode           (+0x24, default 0): 0 Replace, 1 Additive, 2 Maximum, 3 50/50,
 *       4 Subtractive1 (frame-colour), 5 Subtractive2 (colour-frame), 6 Multiply, 7 XOR,
 *       8 Invert+Additive; anything else (unsigned > 8) blends nothing.
 * All 11 presets in the collection store 40 bytes.
 *
 * render (0x10001078), returns 0 (in place):
 *   if !enabled return 0.
 *   if isBeat && randomOnBeat: for blue, red, green in that order, the channel's target becomes
 *     flag ? (excludeDark ? rand()%250 + 55 : rand()%255) : 0          (55..304 can exceed 255)
 *   every frame: cur += trunc((target - cur) / 4) for blue, red, green (idiv)
 *   colour: pump p = trunc((signed char)visdata[0][1][0] / 10) (0 without pump);
 *     morphing ? cur + p : target + p, each min(…, 255) then its low byte (a negative pumped value
 *     wraps to a bright byte); bytes 0x00RRGGBB.
 *   if !randomOnBeat: colour = the configured colour (no pump, no morphing).
 *   An internal w*h buffer is filled with the colour and blended onto the frame:
 *     0 copy (all pixels); 1 paddusb; 2 MMX max (bytes 0..2 max; the top byte becomes
 *     (fb>col signed) ? col|fb : 0); 3 (col+fb)>>1 per byte; 4 psubusb fb-col; 5 psubusb col-fb;
 *     6 (col*fb)>>8 per byte; 7 pxor; 8 per channel min(255, fb + 255 - col), top byte 0.
 *     Modes 1 2 4 5 7 work 8 bytes at a time for (w*h)>>1 steps: an odd w*h leaves the last pixel.
 *
 * State: the targets, the current colours, the final colour and the C runtime's rand() seed are
 * static variables of the DLL (the CRT is linked statically, the seed starts at 1 and srand is never
 * called): they are shared by every instance and survive preset changes. The port keeps them at
 * module level for the same reason (the generator is ctx.makeRand(1), made on first use).
 *
 * Not recoverable: the uninitialised fields when a config is shorter than 40 bytes (port: 0); a
 * w*h of 0/1 would make the plug-in's loops run 2^32 times (port: nothing happens there).
 * Host nuance: the binary tests isBeat != 0, so AVS's threaded pre-init render (isBeat = 0x80000000)
 * counts as a beat; the port only has ctx.isBeat (isBeat & 1).
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

export interface UberClsConfig {
  enabled: number;
  /** 0x00RRGGBB as stored (the dialog swaps to/from COLORREF). */
  colour: number;
  randomRed: number;
  randomBlue: number;
  randomGreen: number;
  excludeDark: number;
  randomOnBeat: number;
  morphing: number;
  brightnessPump: number;
  blendMode: number;
}

/** Constructor 0x10001000 (the four never-initialised flags are taken as 0). */
export const UBER_CLS_DEFAULTS: Readonly<UberClsConfig> = {
  enabled: 1, colour: 0x0000ff, randomRed: 0, randomBlue: 0, randomGreen: 0, excludeDark: 0,
  randomOnBeat: 0, morphing: 0, brightnessPump: 0, blendMode: 0
};

/** load_config 0x100019C8: the stored order is not the object's order. */
const FIELD_ORDER: readonly (keyof UberClsConfig)[] = [
  "enabled", "colour", "randomRed", "randomBlue", "randomGreen", "excludeDark", "randomOnBeat",
  "morphing", "brightnessPump", "blendMode"
];

export function parseUberClsConfig(config: Uint8Array): UberClsConfig {
  const out: UberClsConfig = { ...UBER_CLS_DEFAULTS };
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  let pos = 0;
  for (const field of FIELD_ORDER) {
    if (config.byteLength - pos < 4) break;
    out[field] = view.getInt32(pos, true);
    pos += 4;
  }
  return out;
}

/** The DLL's static variables (0x10006498…0x100064B0) and its CRT rand() (seed 0x10006280). */
interface UberClsGlobals {
  /** cur blue, red, green (0x10006498, 0x1000649C, 0x100064A0). */
  cur: [number, number, number];
  /** target blue, red, green (0x100064A4, 0x100064A8, 0x100064AC). */
  target: [number, number, number];
  /** the clear colour of the last frame (0x100064B0). */
  colour: number;
  rand: (() => number) | null;
}
const globals: UberClsGlobals = { cur: [0, 0, 0], target: [0, 0, 0], colour: 0, rand: null };

/** Back to the state of a freshly loaded DLL (for tests). */
export function resetUberClsGlobals(): void {
  globals.cur = [0, 0, 0];
  globals.target = [0, 0, 0];
  globals.colour = 0;
  globals.rand = null;
}
/** A copy of the shared state (for tests). */
export function uberClsGlobals(): { cur: number[]; target: number[]; colour: number } {
  return { cur: [...globals.cur], target: [...globals.target], colour: globals.colour };
}

/** min(v, 255) as a signed compare, then the low byte (mov bl,dl / movzx). */
function channelByte(v: number): number {
  return (v > 255 ? 255 : v) & 255;
}

/** The colour step of render (0x100010CF…0x100012FE). */
export function updateUberClsColour(cfg: UberClsConfig, isBeat: boolean, pumpSample: number, makeRand: () => () => number): number {
  const g = globals;
  if (isBeat && cfg.randomOnBeat !== 0) {
    const draw = () => {
      g.rand ??= makeRand();
      const r = g.rand();
      return cfg.excludeDark !== 0 ? (r % 250) + 55 : r % 255;
    };
    // Order of the draws: blue (+0x10), red (+0x08), green (+0x0C).
    g.target[0] = cfg.randomBlue !== 0 ? draw() : 0;
    g.target[1] = cfg.randomRed !== 0 ? draw() : 0;
    g.target[2] = cfg.randomGreen !== 0 ? draw() : 0;
  }
  for (let k = 0; k < 3; k += 1) g.cur[k] = g.cur[k]! + Math.trunc((g.target[k]! - g.cur[k]!) / 4);
  const p = cfg.brightnessPump !== 0 ? Math.trunc(pumpSample / 10) : 0;
  const src = cfg.morphing !== 0 ? g.cur : g.target;
  const blue = channelByte(src[0] + p), red = channelByte(src[1] + p), green = channelByte(src[2] + p);
  g.colour = (red << 16) | (green << 8) | blue;
  if (cfg.randomOnBeat === 0) g.colour = cfg.colour | 0;
  return g.colour;
}

/** The blend switch of render (jump table 0x100014FB) with the buffer that holds only `col`. */
export function blendUberCls(mode: number, fb: Int32Array, col: number, count: number): void {
  const pairs = count < 2 ? 0 : (count >>> 1) * 2;
  const c0 = col & 255, c1 = (col >>> 8) & 255, c2 = (col >>> 16) & 255, c3 = (col >>> 24) & 255;
  switch (mode) {
    case 0: for (let i = 0; i < count; i += 1) fb[i] = col; break;
    case 1: for (let i = 0; i < pairs; i += 1) {
      const f = fb[i]!;
      fb[i] = Math.min(255, (f & 255) + c0) | Math.min(255, ((f >>> 8) & 255) + c1) << 8
        | Math.min(255, ((f >>> 16) & 255) + c2) << 16 | Math.min(255, (f >>> 24) + c3) << 24;
    } break;
    case 2: for (let i = 0; i < pairs; i += 1) {
      const f = fb[i]!;
      const f3 = f >>> 24;
      // pcmpgtb on the un-flipped top byte: signed compare, and both bytes kept under the mask.
      const top = ((f3 << 24) >> 24) > ((c3 << 24) >> 24) ? (f3 | c3) : 0;
      fb[i] = Math.max(f & 255, c0) | Math.max((f >>> 8) & 255, c1) << 8
        | Math.max((f >>> 16) & 255, c2) << 16 | top << 24;
    } break;
    case 3: for (let i = 0; i < count; i += 1) {
      const f = fb[i]!;
      fb[i] = (((f & 255) + c0) >> 1) | (((f >>> 8 & 255) + c1) >> 1) << 8
        | (((f >>> 16 & 255) + c2) >> 1) << 16 | (((f >>> 24) + c3) >> 1) << 24;
    } break;
    case 4: for (let i = 0; i < pairs; i += 1) {
      const f = fb[i]!;
      fb[i] = Math.max(0, (f & 255) - c0) | Math.max(0, ((f >>> 8) & 255) - c1) << 8
        | Math.max(0, ((f >>> 16) & 255) - c2) << 16 | Math.max(0, (f >>> 24) - c3) << 24;
    } break;
    case 5: for (let i = 0; i < pairs; i += 1) {
      const f = fb[i]!;
      fb[i] = Math.max(0, c0 - (f & 255)) | Math.max(0, c1 - ((f >>> 8) & 255)) << 8
        | Math.max(0, c2 - ((f >>> 16) & 255)) << 16 | Math.max(0, c3 - (f >>> 24)) << 24;
    } break;
    case 6: for (let i = 0; i < count; i += 1) {
      const f = fb[i]!;
      fb[i] = (((f & 255) * c0) >> 8) | (((f >>> 8 & 255) * c1) >> 8) << 8
        | (((f >>> 16 & 255) * c2) >> 8) << 16 | (((f >>> 24) * c3) >> 8) << 24;
    } break;
    case 7: for (let i = 0; i < pairs; i += 1) fb[i] = fb[i]! ^ col; break;
    case 8: for (let i = 0; i < count; i += 1) {
      // 0x1000151F: per channel min(255, pixel - colour + 255); the top byte is not produced.
      const f = fb[i]!;
      fb[i] = Math.min(255, (f & 255) - c0 + 255) | Math.min(255, ((f >>> 8) & 255) - c1 + 255) << 8
        | Math.min(255, ((f >>> 16) & 255) - c2 + 255) << 16;
    } break;
    default: break;
  }
}

/** visdata[0][1][0]: spectrum, channel 1, sample 0. */
const PUMP_INDEX = 576;

export const ape = {
  id: "Shreyas:uberCLSv2.00",
  sha256: ["d03bd929a8d06d27a49d80c43e76a797b1a06750e37c331337145af54303850f"],
  create(config: Uint8Array): ApeEffect {
    const cfg = parseUberClsConfig(config);
    return {
      render(ctx: ApeContext, framebuffer: Int32Array): number {
        if (cfg.enabled === 0) return 0;
        const col = updateUberClsColour(cfg, ctx.isBeat, ctx.visdata[PUMP_INDEX]!, () => ctx.makeRand(1));
        blendUberCls(cfg.blendMode, framebuffer, col, ctx.w * ctx.h);
        return 0;
      }
    };
  }
};
