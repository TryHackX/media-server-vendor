/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; free for personal use (vis_sh.txt); never
 * committed. The three table generators of its \tabs folder that came without C source, ported
 * from the programs themselves by static analysis only (none of them was run):
 *
 * - Wintabs.exe (Tom Willaert, January 1998), compiled QuickBASIC 4.5 (packed with EXEPACK):
 *   slidever.tab, slidehor.tab, fourcorn.tab, blocks.tab. Its source, wintabs.bas, came with it,
 *   and the compiled code matches it constant for constant.
 * - Wintab.exe (Simon Werner, "uses ideas from Tom Willaert", March 1998), Turbo C++ 1.0 with a
 *   Turbo Debugger symbol table (so the functions keep their names, given below): slidehor.tab,
 *   slidever.tab, corners.tab, squares.tab, blocks.tab, warp.tab, ripple.tab, warple.tab.
 * - TABMAKE.EXE (Kasuha, March 1998), Turbo Pascal 7 packed with WWPACK: "SMOKE.TAB creator".
 *
 * Every table is the plug-in's format: 640 × 480 dwords, the source pixel's offset in the low
 * 24 bits and how much to darken it in the top 8.
 */

// tabs.ts's TAB_WIDTH and TAB_HEIGHT (not imported: tabs.ts imports this module).
const TAB_WIDTH = 640;
const TAB_HEIGHT = 480;
const SIZE = TAB_WIDTH * TAB_HEIGHT;

/**
 * A table being made: it yields now and then (every few rows, or every few thousand joins of
 * smoke.tab), so a scene can make it a little at a time, and returns the table.
 */
export type TabJob = Generator<void, Uint32Array, void>;

/** Runs a job to its end. */
export function finish(job: TabJob): Uint32Array {
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}

/** A double from its bytes as the program stores it (little-endian hex). */
function double(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 8; i += 1) view.setUint8(i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return view.getFloat64(0, true);
}

// ------------------------------------------------------------------------------------ Wintabs

/** wintabs.bas, CreateTab1…4, in the order it wrote them; Bind$() packs y·640 + x. */
export const WINTABS = ["slidever.tab", "slidehor.tab", "fourcorn.tab", "blocks.tab"] as const;

export function* wintabsJob(name: (typeof WINTABS)[number]): TabJob {
  const out = new Uint32Array(SIZE);
  let i = 0;
  for (let y1 = 0; y1 < TAB_HEIGHT; y1 += 1) {
    if (y1 % 32 === 31) yield;
    for (let x1 = 0; x1 < TAB_WIDTH; x1 += 1) {
      let x2 = x1;
      let y2 = y1;
      let blend: number;
      if (name === "slidever.tab") {
        // "slides the screen in blades (vertical)": even columns up a line, odd ones down.
        y2 = x1 % 2 === 0 ? y1 - 1 : y1 + 1;
        if (y2 === -1) y2 = 479;
        if (y2 === 480) y2 = 0;
        blend = 4;
      } else if (name === "slidehor.tab") {
        x2 = y1 % 2 === 0 ? x1 - 1 : x1 + 1;
        if (x2 === -1) x2 = 639;
        if (x2 === 640) x2 = 0;
        blend = 4;
      } else if (name === "fourcorn.tab") {
        // The centre (160,120)-(479,359) copied to the four corners; the centre stays.
        if (!(x1 >= 160 && x1 <= 479 && y1 >= 120 && y1 <= 359)) {
          x2 = x1 < 320 ? x1 + 160 : x1 - 160;
          y2 = y1 < 240 ? y1 + 120 : y1 - 120;
        }
        blend = 8;
      } else {
        x2 = Math.trunc(x1 / 4) * 4;
        y2 = Math.trunc(y1 / 4) * 4;
        blend = 32;
      }
      out[i++] = (((y2 * 640 + x2) & 0xffffff) | (blend << 24)) >>> 0;
    }
  }
  return out;
}

export function wintabsTable(name: (typeof WINTABS)[number]): Uint32Array {
  return finish(wintabsJob(name));
}

// ------------------------------------------------------------------------------------- Wintab

/** createtab()'s file names (DS:014C…019D), in the order it wrote them. */
export const WINTAB = [
  "slidehor.tab",
  "slidever.tab",
  "corners.tab",
  "squares.tab",
  "blocks.tab",
  "warp.tab",
  "ripple.tab",
  "warple.tab"
] as const;

/** The constants in its data segment. frequency (DS:011E) is a double; the rest are floats. */
const FREQUENCY = double("aaa713ea06fc29c0"); // -12.992240252398762
/** segsize = atan(2.5°) · 2 (DS:0126, DS:012E), stored as a float. */
const SEGSIZE = Math.fround(Math.atan(double("2546e74a1857a63f")) * 2);

/** Turbo C's rand(): seed · 0x015A4E35 + 1, bits 16–30. */
function turboRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 0x015a4e35) + 1) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
}

/** The globals warp() and ripple() share (they carry over from pixel to pixel). */
interface WarpState {
  screenDist: number;
  valx: number;
  valy: number;
  dist: number;
  segAngle: number;
}

/**
 * warp() (03E7): a sine of the distance from the centre bends each pixel along its angle,
 * then pulls it 6/(distance + 1) of the way towards the centre. When y1 is 240 it steps y1 to
 * 241 and keeps the angle of the pixel before (the division by 240 − y1 is skipped), so the
 * whole middle line takes the angle of the line above's last pixel, as the program did.
 */
function warp(s: WarpState, x1: number, y1: number): [number, number] {
  const amplitude = Math.fround(SEGSIZE * s.screenDist);
  s.dist = Math.sin(-s.screenDist / FREQUENCY) * amplitude;
  if (y1 === 240) y1 += 1;
  else s.segAngle = Math.fround(Math.atan((x1 - 320) / (240 - y1)));
  const c = Math.cos(s.segAngle) * s.dist;
  const n = Math.sin(s.segAngle) * s.dist;
  let x2: number;
  let y2: number;
  if (y1 > 240) {
    x2 = Math.trunc(x1 - c);
    y2 = Math.trunc(y1 - n);
  } else {
    x2 = Math.trunc(c + x1);
    y2 = Math.trunc(n + y1);
  }
  x2 = Math.trunc(((320 - x2) * 6) / (s.screenDist + 1) + x2);
  y2 = Math.trunc(((240 - y2) * 6) / (s.screenDist + 1) + y2);
  return [x2, y2];
}

/**
 * ripple() (05C0): pushes the pixel out along (valx, valy) by sin(distance) · 15 + 20 over
 * distance + 1, then measures valx, valy and the distance again from the result, which the
 * next pixel uses: ripple.tab runs on what the pixel before left (the program never measured
 * it there), warple.tab on its own pixel's. Inside 34.5 of the centre the result is pixel 0.
 */
function ripple(s: WarpState, x1: number, y1: number): [number, number] {
  s.dist = Math.sin(-s.screenDist / FREQUENCY) * 15 + 20;
  let x2 = Math.trunc((s.valx * s.dist) / (s.screenDist + 1) + x1);
  let y2 = Math.trunc((s.valy * s.dist) / (s.screenDist + 1) + y1);
  s.valx = 320 - x2;
  s.valy = 240 - y2;
  s.screenDist = Math.sqrt(s.valx * s.valx + s.valy * s.valy);
  if (s.screenDist < 34.5) {
    x2 = 0;
    y2 = 0;
  }
  return [x2, y2];
}

/**
 * init_blocks() (089A): srand(time(NULL)) (the scene's seed here, its low word as the program
 * passed it) and a random order of the 48 blocks of 80 × 80.
 */
export function wintabBlocks(seed: number): number[] {
  const rand = turboRand(seed & 0xffff);
  const block = new Array<number>(48).fill(-1);
  for (let k = 0; k < 48; k += 1) {
    let r: number;
    do r = rand() % 48;
    while (block[r] !== -1);
    block[r] = k;
  }
  return block;
}

/**
 * One table of createtab() (0938) for its switch case `f`. writetab() (0310) keeps x2 and y2
 * on the screen and adds the darkening. ripple.tab starts from what warp.tab's last pixel left
 * (valx −319, valy −239), since the program wrote them one after the other.
 */
export function* wintabJob(name: (typeof WINTAB)[number], seed: number): TabJob {
  const f = WINTAB.indexOf(name);
  const out = new Uint32Array(SIZE);
  const blend = [6, 6, 6, 6, 10, 6, 10, 16][f]! * 0x1000000;
  const block = f === 4 ? wintabBlocks(seed) : [];
  const s: WarpState = { screenDist: Math.sqrt(319 * 319 + 239 * 239), valx: -319, valy: -239, dist: 0, segAngle: 0 };
  let i = 0;
  for (let y1 = 0; y1 < TAB_HEIGHT; y1 += 1) {
    if (y1 % 16 === 15) yield;
    for (let x1 = 0; x1 < TAB_WIDTH; x1 += 1) {
      let x2 = x1;
      let y2 = y1;
      if (f === 0) {
        // slide_hor() (070D)
        x2 = y1 % 2 === 0 ? x1 - 1 : x1 + 1;
        if (x2 === -1) x2 = 639;
        if (x2 === 640) x2 = 0;
      } else if (f === 1) {
        // slide_ver() (06C5)
        y2 = x1 % 2 === 0 ? y1 - 1 : y1 + 1;
        if (y2 === -1) y2 = 479;
        if (y2 === 480) y2 = 0;
      } else if (f === 2) {
        // corners() (0755)
        if (!(x1 >= 160 && x1 <= 479 && y1 >= 120 && y1 <= 359)) {
          x2 = x1 < 320 ? x1 + 160 : x1 - 160;
          y2 = y1 < 240 ? y1 + 120 : y1 - 120;
        }
      } else if (f === 3) {
        // squares(4) (07C7)
        x2 = Math.trunc(x1 / 4) * 4;
        y2 = Math.trunc(y1 / 4) * 4;
      } else if (f === 4) {
        // blocks() (07F1): each 80 × 80 block shows block[n] of the shuffled order.
        const bx = Math.trunc(x1 / 80);
        const by = Math.trunc(y1 / 80);
        const source = block[8 * by + bx]!;
        x2 = x1 + ((source % 8) - bx) * 80;
        y2 = y1 + (Math.trunc(source / 8) - by) * 80;
      } else if (f === 6) {
        [x2, y2] = ripple(s, x1, y1);
      } else {
        s.valx = 320 - x1;
        s.valy = 240 - y1;
        s.screenDist = Math.sqrt(s.valx * s.valx + s.valy * s.valy);
        [x2, y2] = warp(s, x1, y1);
        if (f === 5) {
          // centerhole() (0909): pixel 0 inside 23 of the centre.
          if (s.screenDist < 23) {
            x2 = 0;
            y2 = 0;
          }
        } else {
          [x2, y2] = ripple(s, x2, y2);
        }
      }
      x2 = Math.min(Math.max(x2, 0), 639);
      y2 = Math.min(Math.max(y2, 0), 479);
      out[i++] = (y2 * 640 + x2 + blend) >>> 0;
    }
  }
  return out;
}

export function wintabTable(name: (typeof WINTAB)[number], seed: number): Uint32Array {
  return finish(wintabJob(name, seed));
}

// ------------------------------------------------------------------------------------ TABMAKE

/**
 * TABMAKE.EXE: "SMOKE.TAB creator by Kasuha". It starts from no translation and swaps the
 * entries of two pixels again and again, until every pixel is joined into one set (a
 * union-find in the file smoke.rep, which it erases at the end):
 * - a random pixel (x, y) (Turbo Pascal's Random; Randomize is never called, so RandSeed
 *   starts at 0 and the program always wrote the same file);
 * - around the pixel its entry comes from, (sx, sy), every pixel (i, j) within R (3; 11 for the
 *   last 99 joins) that is in another set and whose own entry comes from within R of (x, y);
 * - one of them at random: the two swap entries, each darkened by 6 + the squared distance
 *   to its new source, and their sets are joined.
 * The loop, the order of the candidates (columns, then rows) and every Random() are as in the
 * program's main block (047B…0BE7), so this is its smoke.tab exactly. ESC is not modelled.
 */
export function* smokeJob(): TabJob {
  let seed = 0;
  const random = (range: number): number => {
    seed = (Math.imul(seed, 0x08088405) + 1) >>> 0;
    return Math.floor((seed * range) / 0x100000000);
  };
  const tab = new Uint32Array(SIZE);
  const rep = new Int32Array(SIZE);
  for (let k = 0; k < SIZE; k += 1) {
    tab[k] = k;
    rep[k] = k;
  }
  const find = (v: number): number => {
    let r = v;
    while (rep[r] !== r) r = rep[r]!;
    while (rep[v] !== r) {
      const next = rep[v]!;
      rep[v] = r;
      v = next;
    }
    return r;
  };
  const disk = (r: number): Int32Array => {
    const list: number[] = [];
    for (let di = -r; di <= r; di += 1) for (let dj = -r; dj <= r; dj += 1) if (di * di + dj * dj <= r * r) list.push(di, dj);
    return Int32Array.from(list);
  };
  const disks: Record<number, Int32Array> = { 3: disk(3), 11: disk(11) };
  const candidates = new Int32Array(2001);
  let count = SIZE;
  let radius = 3;
  let tries = 0;
  while (count > 1) {
    tries += 1;
    if (tries % 2048 === 0) yield;
    const x = random(640);
    const y = random(480);
    const here = y * 640 + x;
    const v = tab[here]! & 0xffffff;
    const root = find(here);
    const sx = v % 640;
    const sy = (v - sx) / 640;
    const rr = radius * radius;
    const offsets = disks[radius]!;
    let n = 0;
    for (let o = 0; o < offsets.length; o += 2) {
      const i = sx + offsets[o]!;
      const j = sy + offsets[o + 1]!;
      if (i < 0 || i > 639 || j < 0 || j > 479) continue;
      const k = j * 640 + i;
      if (find(k) === root) continue;
      const w = tab[k]! & 0xffffff;
      const wx = w % 640;
      const wy = (w - wx) / 640;
      if ((y - wy) * (y - wy) + (x - wx) * (x - wx) <= rr) candidates[n++] = k;
    }
    if (n === 0) continue;
    const k = candidates[random(n)]!;
    count -= 1;
    if (count < 100) radius = 11;
    const i = k % 640;
    const j = (k - i) / 640;
    const w = tab[k]! & 0xffffff;
    const wx = w % 640;
    const wy = (w - wx) / 640;
    tab[here] = (w + ((wy - y) * (wy - y) + (wx - x) * (wx - x) + 6) * 0x1000000) >>> 0;
    tab[k] = (v + ((sy - j) * (sy - j) + (sx - i) * (sx - i) + 6) * 0x1000000) >>> 0;
    rep[find(root)] = find(k);
  }
  return tab;
}

export function smokeTable(): Uint32Array {
  return finish(smokeJob());
}
