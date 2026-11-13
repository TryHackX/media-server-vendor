/**
 * Cthugha-L 1.4's flames (src/flames.cc), line by line. Cthugha (c) Kevin "Zaph" Burfitt, Torps
 * Productions; Cthugha-L (c) 1995-97 Harald Deischinger. Non-commercial use only, with credit
 * (COPYING-cthugha-L.txt).
 *
 * A flame blurs the picture of the last frame into the next one, each pixel a quarter of four
 * neighbours less one, so everything burns away while it moves. Kept as in C:
 * - the in-place flames (the PTR macro) run over the buffer shown last in the same order, so the
 *   "fast" ones read the rows they have just written and carry a pixel far in one pass;
 * - the "subtle" flames add in an unsigned char: the sum wraps at 256, which gives them their
 *   bands; "weird" ORs the neighbours instead of adding them;
 * - the general flames take their four neighbours from a random number (the flame-general
 *   option) and, when a translation table is in use, read through it: flame and translation in
 *   one pass (done_translate).
 */

import { type Context, DIVSUB, DIVSUB2, DIVSUB4 } from "./context";

export interface FlameEntry {
  readonly name: string;
  readonly desc: string;
  readonly inUse: boolean;
  run(ctx: Context, flame: FlameState): void;
}

/** What a flame is handed besides the buffers: the translation in use and flame-general. */
export interface FlameState {
  /** The current translation table (source offset of each pixel), or null for none. */
  trans: Int32Array | null;
  /** The flame-general option: a number the general flames take their neighbours from. */
  general: number;
  /** flame_offset[4]: the neighbours of the general flames. */
  readonly offset: Int32Array;
}

export function newFlameState(): FlameState {
  return { trans: null, general: 0, offset: new Int32Array(4) };
}

/** general_offset(): the four neighbours from flame-general, each shifted by one more. */
function generalOffset(ctx: Context, state: FlameState): void {
  const W = ctx.W;
  const position = [-W - 1, -W, -W + 1, -1, 0, 1, W - 1, W, W + 1];
  let gen = Math.trunc(state.general);
  const shift = gen % 9;
  gen = Math.trunc(gen / 9);
  for (let i = 0; i < 4; i += 1) {
    const p = gen % 9;
    gen = Math.trunc(gen / 9);
    state.offset[i] = position[p]! + position[shift]!;
  }
}

function clear(ctx: Context): void {
  ctx.active.fill(0, ctx.BASE, ctx.BASE + ctx.SIZE);
}

function upSlow(ctx: Context): void {
  ctx.swap();
  const a = ctx.active;
  const W = ctx.W;
  let q = ctx.BASE + W + 1;
  let tmp = a[q - 3]! + a[q - 2]! + a[q - 1]!;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    tmp = tmp - a[q - 3]! + a[q]!;
    const tmp2 = tmp + a[q + W - 1]!;
    a[q - W - 1] = DIVSUB[tmp2]!;
    q += 1;
  }
}

function upFast(ctx: Context): void {
  ctx.swap();
  const a = ctx.active;
  const W = ctx.W;
  let q = ctx.BASE + ctx.SIZE;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    a[q] = DIVSUB[a[q]! + a[q + W - 1]! + a[q + W + 1]! + a[q + W]!]!;
    q -= 1;
  }
}

function leftSlow(ctx: Context): void {
  ctx.swap();
  const a = ctx.active;
  const W = ctx.W;
  let q = ctx.BASE + W;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    a[q - W] = DIVSUB[a[q - W + 1]! + a[q]! + a[q + 1]! + a[q + W]!]!;
    q += 1;
  }
}

function leftFast(ctx: Context): void {
  ctx.swap();
  const a = ctx.active;
  const W = ctx.W;
  let q = ctx.BASE + ctx.SIZE;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    a[q] = DIVSUB[a[q]! + a[q + W + 1]! + a[q + W + 1]! + a[q + W]!]!;
    q -= 1;
  }
}

function rightSlow(ctx: Context): void {
  const a = ctx.active;
  const p = ctx.passive;
  const W = ctx.W;
  let s = ctx.BASE + W + 1;
  let d = ctx.BASE + 1;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    a[d] = DIVSUB[p[s - W - 1]! + p[s]! + p[s - 1]! + p[s + W]!]!;
    d += 1;
    s += 1;
  }
}

function rightFast(ctx: Context): void {
  ctx.swap();
  const a = ctx.active;
  const W = ctx.W;
  let q = ctx.BASE + ctx.SIZE;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    a[q] = DIVSUB[a[q]! + a[q + W - 1]! + a[q + W - 1]! + a[q + W]!]!;
    q -= 1;
  }
}

/** flame_water and flame_watersubtle: the top half rises, the bottom half falls. */
function water(ctx: Context, wrap: boolean): void {
  const a = ctx.active;
  const p = ctx.passive;
  const W = ctx.W;
  const mask = wrap ? 255 : 1023;
  let s = ctx.BASE + W;
  let d = ctx.BASE;
  for (let i = (ctx.SIZE >> 1) + W; i !== 0; i -= 1) {
    a[d] = DIVSUB[(p[s - 1]! + p[s]! + p[s + 1]! + p[s + W]!) & mask]!;
    d += 1;
    s += 1;
  }
  s = ctx.BASE + W * (ctx.H - 1);
  d = ctx.BASE + W * ctx.H;
  for (let i = ctx.SIZE >> 1; i !== 0; i -= 1) {
    a[d] = DIVSUB[(p[s - W + 1]! + p[s]! + p[s + 1]! + p[s - W]!) & mask]!;
    d -= 1;
    s -= 1;
  }
}

function skyline(ctx: Context): void {
  const a = ctx.active;
  const p = ctx.passive;
  let s = ctx.BASE + ctx.W + 1;
  let d = ctx.BASE;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    a[d] = DIVSUB[p[s - 1]! + p[s]! + p[s + 1]! + p[s]!]!;
    d += 1;
    s += 1;
  }
}

function weird(ctx: Context): void {
  const a = ctx.active;
  const p = ctx.passive;
  const W = ctx.W;
  let s = ctx.BASE + W + 1;
  let d = ctx.BASE + 1;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    // Signed chars ORed: the low eight bits are the OR of the bytes.
    a[d] = DIVSUB[p[s - 1]! | p[s]! | p[s + 1]! | p[s + W]!]!;
    d += 1;
    s += 1;
  }
}

/** New from Cthugha 5.3. */
function zzz(ctx: Context): void {
  ctx.swap();
  const a = ctx.active;
  const W = ctx.W;
  let q = ctx.BASE + W;
  for (let i = ctx.SIZE; i !== 0; i -= 1) {
    a[q - W] = DIVSUB2[(a[q - 1]! + a[q + W]!) & 255]!;
    q += 1;
  }
}

function fade(ctx: Context): void {
  ctx.swap();
  const a = ctx.active;
  const end = ctx.BASE + (ctx.SIZE >> 2) * 4;
  for (let q = ctx.BASE; q < end; q += 1) a[q] = DIVSUB4[a[q]!]!;
}

/** The general subtle flame: four neighbours of the last picture, added in an unsigned char. */
function generalSubtle(ctx: Context, state: FlameState): void {
  const a = ctx.active;
  const p = ctx.passive;
  const [o1, o2, o3, o4] = state.offset as unknown as [number, number, number, number];
  const trans = state.trans;
  if (!trans) {
    const end = ctx.BASE + (ctx.SIZE >> 2) * 4;
    for (let q = ctx.BASE; q < end; q += 1) a[q] = DIVSUB[(p[q + o1]! + p[q + o2]! + p[q + o3]! + p[q + o4]!) & 255]!;
    return;
  }
  ctx.doneTranslate = true;
  const base = ctx.BASE;
  for (let i = 0; i < ctx.SIZE; i += 1) {
    const t = base + trans[i]!;
    a[base + i] = DIVSUB[(p[t + o1]! + p[t + o2]! + p[t + o3]! + p[t + o4]!) & 255]!;
  }
}

/** The general slow flame: the same in an int, without the wrap. */
function generalSlow(ctx: Context, state: FlameState): void {
  const a = ctx.active;
  const p = ctx.passive;
  const [o1, o2, o3, o4] = state.offset as unknown as [number, number, number, number];
  const trans = state.trans;
  if (!trans) {
    const end = ctx.BASE + ctx.SIZE;
    for (let q = ctx.BASE; q < end; q += 1) a[q] = DIVSUB[p[q + o1]! + p[q + o2]! + p[q + o3]! + p[q + o4]!]!;
    return;
  }
  ctx.doneTranslate = true;
  const base = ctx.BASE;
  for (let i = 0; i < ctx.SIZE; i += 1) {
    const t = base + trans[i]!;
    a[base + i] = DIVSUB[p[t + o1]! + p[t + o2]! + p[t + o3]! + p[t + o4]!]!;
  }
}

/** The subtle flames up, left and right: fixed neighbours through the general subtle flame. */
function subtle(ctx: Context, state: FlameState, offsets: readonly [number, number, number, number]): void {
  for (let i = 0; i < 4; i += 1) state.offset[i] = offsets[i]!;
  generalSubtle(ctx, state);
}

/** By Deischi: let the buffer fall down. */
function down(ctx: Context): void {
  // Row by row from one line above: the border row −1 becomes row 0.
  ctx.active.set(ctx.passive.subarray(ctx.BASE - ctx.W, ctx.BASE - ctx.W + ctx.SIZE), ctx.BASE);
}

export const FLAMES: readonly FlameEntry[] = [
  { name: "Clear", desc: "Blank the buffer", inUse: false, run: (ctx) => clear(ctx) },
  { name: "u-Sl", desc: "Up Slow", inUse: true, run: (ctx) => upSlow(ctx) },
  { name: "u-Su", desc: "Up Subtle", inUse: true, run: (ctx, s) => subtle(ctx, s, [ctx.W - 1, ctx.W, ctx.W + 1, 2 * ctx.W]) },
  { name: "u-Fa", desc: "Up Fast", inUse: true, run: (ctx) => upFast(ctx) },
  { name: "l-Sl", desc: "Left Slow", inUse: true, run: (ctx) => leftSlow(ctx) },
  { name: "l-Su", desc: "Left Subtle", inUse: true, run: (ctx, s) => subtle(ctx, s, [1, ctx.W, ctx.W + 1, 2 * ctx.W]) },
  { name: "l-Fa", desc: "Left Fast", inUse: true, run: (ctx) => leftFast(ctx) },
  { name: "r-Sl", desc: "Right Slow", inUse: true, run: (ctx) => rightSlow(ctx) },
  { name: "r-Su", desc: "Right Subtle", inUse: true, run: (ctx, s) => subtle(ctx, s, [-1, ctx.W - 1, ctx.W, 2 * ctx.W]) },
  { name: "r-Fa", desc: "Right Fast", inUse: true, run: (ctx) => rightFast(ctx) },
  { name: "Water", desc: "Water", inUse: true, run: (ctx) => water(ctx, false) },
  { name: "Wa-s", desc: "Water Subtle", inUse: true, run: (ctx) => water(ctx, true) },
  { name: "Skyline", desc: "Skyline", inUse: true, run: (ctx) => skyline(ctx) },
  { name: "Weird", desc: "Weird", inUse: true, run: (ctx) => weird(ctx) },
  { name: "Zzz", desc: "Zzz", inUse: true, run: (ctx) => zzz(ctx) },
  { name: "Fade", desc: "Fade", inUse: true, run: (ctx) => fade(ctx) },
  {
    name: "GenSubt", desc: "General Subtle", inUse: true,
    run: (ctx, s) => {
      generalOffset(ctx, s);
      generalSubtle(ctx, s);
    }
  },
  {
    name: "GenSlow", desc: "General Slow", inUse: true,
    run: (ctx, s) => {
      generalOffset(ctx, s);
      generalSlow(ctx, s);
    }
  },
  { name: "Down", desc: "Falling Down", inUse: true, run: (ctx) => down(ctx) }
];
