/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; based on Cthugha by Kevin "Zaph" Burfitt and
 * Cthugha-L by Harald Deischinger; free for personal use (vis_sh.txt); never committed.
 *
 * Translation tables (*.tab). A table is 640 × 480 dwords, each the source pixel's offset in a
 * 640-wide picture (low 24 bits) and how much to darken it (top 8 bits). The plug-in wrote its
 * own five on first start (dialog "Running for the first time … It is neccesary to generate
 * translation files"), from code inside Vis_sh.dll, translated here instruction by instruction:
 * space.tab (10008150), rotate.tab (100082A0), down_spiral.tab (10008480, which the
 * Translations page also writes as smoke.tab), huricane.tab (100086B0) and big_wheel.tab
 * (10008830). That ran while the registry was read, before Init's srand(time(0)), so their
 * rand() started from 1 and the five come out the same on every machine.
 *
 * The \tabs folder also held generators for more tables, run by hand; mkspace.exe, mkhuricane.exe
 * and mkgentable.exe are ported from their sources (tabgens_src: mkspace.cpp, mkhur.cpp,
 * mkgen.cpp) for the extra tables, with their default parameters. mkspiral.cpp is the source of
 * down_spiral. Wintabs.exe, Wintab.exe and TABMAKE.EXE came without C source; tabgens.ts ports
 * them from the programs.
 *
 * convertTable() is the loader's resizing (translations.cpp, 10008CE0): 640 × 400 takes rows
 * 40…439, the 320-wide modes every second row and column, 160 × 120 every fourth.
 */

import { MsRandom } from "./random";
import { smokeJob, type TabJob, WINTAB, wintabJob, WINTABS, wintabsJob } from "./tabgens";

export const TAB_WIDTH = 640;
export const TAB_HEIGHT = 480;
const TAB_SIZE = TAB_WIDTH * TAB_HEIGHT;

/** _ftol: truncation; the x87's "integer indefinite" (low dword 0) for NaN and the infinities. */
export function ftol(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) >= 9.2e18) return 0;
  return Math.trunc(value) | 0;
}

/** 10008130: rand() % n, or 0 (and no rand()) when n ≤ 0. */
function rnd(random: MsRandom, n: number): number {
  return n > 0 ? random.rand() % n : 0;
}

const HALF_PI_F = 1.5707963705062866;
const PI_F = 3.1415927410125732;
const PI_D = 3.141592653589793;
const QUARTER_PI_F = 0.7853981852531433;

/** space.tab (10008150): flying forward through space, a random speed per pixel. */
function space(random: MsRandom, out: Uint32Array): void {
  let i = 0;
  for (let y = 0; y < TAB_HEIGHT; y += 1) {
    for (let x = 0; x < TAB_WIDTH; x += 1) {
      const ax = Math.abs(x - 320);
      const ay = Math.abs(y - 240);
      let sx: number;
      let sy: number;
      if (ax < 30 && ay < 20 && rnd(random, ax + ay) < 4) {
        sx = rnd(random, 640);
        sy = rnd(random, 480);
      } else {
        const k = rnd(random, 71) + 77;
        sx = x - Math.trunc((k * (x - 320)) / 700);
        sy = y - Math.trunc((k * (y - 240)) / 700);
      }
      if (sy >= 480 || sy < 0 || sx >= 640 || sx < 0) {
        sx = 0;
        sy = 0;
      }
      out[i++] = (sy * 640 + sx + 0x08000000) >>> 0;
    }
  }
}

/**
 * rotate.tab (100082A0) and down_spiral.tab (10008480, mkspiral.cpp): each pixel a tenth of its
 * radius round, the spiral's direction turned a further 45°.
 */
function rotate(out: Uint32Array, spiral: boolean): void {
  let i = 0;
  const blend = spiral ? 0x0c000000 : 0x08000000;
  for (let row = 0; row < TAB_HEIGHT; row += 1) {
    const yy = 240 - row;
    for (let x = 0; x < TAB_WIDTH; x += 1) {
      let x2: number;
      let y2: number;
      if (yy === 240 || yy === -240) {
        x2 = ftol((320 - x) * 0.75);
        y2 = yy;
      } else {
        const dx = x - 320;
        const dy = row - 240;
        const r = ftol(Math.sqrt(dx * dx + dy * dy));
        let a = x === 320 ? (yy < -80 ? HALF_PI_F : -HALF_PI_F) : Math.atan(dy / dx);
        if (x < 320) a -= spiral ? -PI_D : -PI_F;
        if (spiral) a -= QUARTER_PI_F;
        const af = Math.fround(a);
        x2 = ftol(Math.ceil(Math.sin(a) * r * -0.1));
        y2 = ftol(Math.ceil(Math.cos(af) * r * 0.1));
        if (x === 0 || x === 640) {
          x2 = 320 - x;
          y2 = ftol(yy * 0.75);
        }
      }
      out[i++] = ((Math.abs((y2 + row) * 640 + x2 + x) % TAB_SIZE) + blend) >>> 0;
    }
  }
}

/** huricane.tab (100086B0): mkhur.cpp's hurricane at speed 50 ± 25 %, centred at 213:320. */
function huricane(random: MsRandom, out: Uint32Array): void {
  let i = 0;
  for (let y = 0; y < TAB_HEIGHT; y += 1) {
    const dy = y - 320;
    for (let x = 0; x < TAB_WIDTH; x += 1) {
      const k = Math.trunc(((rnd(random, 51) + 84) * 50) / 100);
      const dxp = x - 213;
      const q = Math.trunc((dxp * 2500) / (dxp * dxp + dy * dy + 1));
      let mx = Math.trunc((k * dy) / 700) + x;
      let my = y - Math.trunc((k * q) / 700);
      if (my < 0) my += 480 * Math.floor((479 - my) / 480);
      if (mx < 0) mx += 640 * Math.floor((639 - mx) / 640);
      out[i++] = ((my % 480) * 640 + (mx % 640) + 0x08000000) >>> 0;
    }
  }
}

/** big_wheel.tab (10008830): rotate.tab's turn about a point at the top edge (256, 0). */
function bigWheel(out: Uint32Array): void {
  let i = 0;
  for (let row = 0; row < TAB_HEIGHT; row += 1) {
    const yy = -row;
    for (let x = 0; x < TAB_WIDTH; x += 1) {
      let x2: number;
      let y2: number;
      if (yy === 0 || yy === -480) {
        x2 = ftol((256 - x) * 0.75);
        y2 = yy;
      } else {
        const dx = x - 256;
        const r = ftol(Math.sqrt(dx * dx + row * row));
        let a = x === 256 ? (yy < -256 ? HALF_PI_F : -HALF_PI_F) : Math.atan(row / dx);
        if (x < 256) a -= -PI_D;
        if (r < 480) {
          const af = Math.fround(a);
          x2 = ftol(Math.ceil(Math.sin(a) * r * -0.1));
          y2 = ftol(Math.ceil(Math.cos(af) * r * 0.1));
        } else {
          x2 = x >= 256 ? -3 : 3;
          y2 = 0;
        }
        if (x === 0 || x === 640) {
          x2 = 256 - x;
          y2 = ftol(yy * 0.75);
        }
      }
      out[i++] = ((Math.abs((y2 + row) * 640 + x2 + x) % TAB_SIZE) + 0x08000000) >>> 0;
    }
  }
}

/** mkspace.exe (mkspace.cpp) with its defaults: speed 100, randomness 70, blend 8, forward. */
function mkspace(random: MsRandom, out: Uint32Array, speed = 100, randomness = 70, blend = 8, reverse = false): void {
  let i = 0;
  for (let y = 0; y < TAB_HEIGHT; y += 1) {
    for (let x = 0; x < TAB_WIDTH; x += 1) {
      const dx = x - 320;
      const dy = y - 240;
      let mx: number;
      let my: number;
      if (!reverse && Math.abs(dx) < 30 && Math.abs(dy) < 20 && rnd(random, Math.abs(dx) + Math.abs(dy)) < 4) {
        mx = rnd(random, 640);
        my = rnd(random, 480);
      } else {
        let sp = speed;
        if (randomness) sp = Math.trunc((speed * (100 + rnd(random, randomness + 1) - Math.trunc(randomness / 3))) / 100);
        if (reverse) sp = -sp;
        mx = x - Math.trunc((dx * sp) / 700);
        my = y - Math.trunc((dy * sp) / 700);
      }
      if (my >= 480 || my < 0 || mx >= 640 || mx < 0) {
        mx = 0;
        my = 0;
      }
      out[i++] = (my * 640 + mx + blend * 0x1000000) >>> 0;
    }
  }
}

/** mkhuricane.exe (mkhur.cpp) with its defaults: speed 100, randomness 70, blend 8, -sy, 213:230. */
function mkhuricane(random: MsRandom, out: Uint32Array, speed = 100, randomness = 70, blend = 8, cx = 213, cy = 230): void {
  let i = 0;
  for (let y = 0; y < TAB_HEIGHT; y += 1) {
    for (let x = 0; x < TAB_WIDTH; x += 1) {
      let sp = speed;
      if (randomness) sp = Math.trunc((speed * (100 + rnd(random, randomness + 1) - Math.trunc(randomness / 3))) / 100);
      let dx = x - cx;
      const dy = y - cy;
      dx = Math.trunc((dx * 2500) / (dx * dx + dy * dy + 1));
      let mx = x + Math.trunc((dy * sp) / 700);
      let my = y - Math.trunc((dx * sp) / 700);
      while (my < 0) my += 480;
      while (mx < 0) mx += 640;
      out[i++] = ((my % 480) * 640 + (mx % 640) + blend * 0x1000000) >>> 0;
    }
  }
}

/**
 * mkgentable.exe (mkgen.cpp) as "gentable x.tab 0": one spiral about the middle, turning one way,
 * delta_r 2, delta_a 0.1, each pixel a little off at random (srand(time) there; the scene's seed
 * here). Its centre pixel writes whatever the pixel before it wrote, as the program did.
 */
function mkgentable(random: MsRandom, out: Uint32Array, deltaR = 2, deltaA = 0.1): void {
  let i = 0;
  let full = 0;
  const cx = 320;
  const cy = 240;
  for (let y = 0; y < TAB_HEIGHT; y += 1) {
    for (let x = 0; x < TAB_WIDTH; x += 1) {
      if (x !== cx || y !== cy) {
        const tx = Math.abs(x - cx);
        const ty = Math.abs(y - cy);
        let r = Math.sqrt(tx * tx + ty * ty);
        let a = Math.atan2(x - cx, y - cy);
        r += deltaR + (random.rand() % 10) * 0.01;
        if (r < 0) r = 0;
        a += deltaA + (random.rand() % 10) * 0.01;
        let mx = Math.trunc(r * Math.sin(a) + cx);
        let my = Math.trunc(r * Math.cos(a) + cy);
        if (my >= 480 || my < 0 || mx >= 640 || mx < 0) {
          mx = 0;
          my = 0;
        }
        full = my * 640 + mx + (8 << 24);
      }
      out[i++] = full >>> 0;
    }
  }
}

/**
 * A generator's table, made a little at a time while the scene runs (prepare) or all at once
 * when it is chosen before that: the plug-in loaded its tables in a thread of their own, and
 * smoke.tab takes about 0.2 s to make in one go.
 */
export class LazyTab {
  private job: TabJob | null = null;
  private table: Uint32Array | null = null;

  constructor(private readonly make: () => TabJob) {}

  get done(): boolean {
    return this.table !== null;
  }

  /** Works on the table until `deadline` (performance.now()); true once it is made. */
  work(deadline: number): boolean {
    if (this.table) return true;
    this.job ??= this.make();
    for (;;) {
      const step = this.job.next();
      if (step.done) {
        this.table = step.value;
        this.job = null;
        return true;
      }
      if (performance.now() >= deadline) return false;
    }
  }

  get(): Uint32Array {
    this.work(Infinity);
    return this.table!;
  }
}

export type TabSource = Uint32Array | LazyTab;

export interface TabSet {
  /** File names in the order FindFirstFile listed them (creation order on a fresh install). */
  names: string[];
  tables: TabSource[];
}

export function rawTable(source: TabSource): Uint32Array {
  return source instanceof LazyTab ? source.get() : source;
}

let builtIn: TabSet | null = null;
let extra: { first: TabSet; generated: { names: string[]; tables: (LazyTab | null)[] } } | null = null;

/** The five tables the first start wrote, in the order it wrote them (rand() from 1). */
export function builtInTabs(): TabSet {
  if (builtIn) return builtIn;
  const random = new MsRandom(1);
  const make = (): Uint32Array => new Uint32Array(TAB_SIZE);
  const spaceTab = make();
  space(random, spaceTab);
  const rotateTab = make();
  rotate(rotateTab, false);
  const spiralTab = make();
  rotate(spiralTab, true);
  const hurricaneTab = make();
  huricane(random, hurricaneTab);
  const wheelTab = make();
  bigWheel(wheelTab);
  builtIn = {
    names: ["space.tab", "rotate.tab", "down_spiral.tab", "huricane.tab", "big_wheel.tab"],
    tables: [spaceTab, rotateTab, spiralTab, hurricaneTab, wheelTab]
  };
  return builtIn;
}

/**
 * Tables the \tabs generators make, each run as its own process, in the order of the programs'
 * dates:
 * - "mkhuricane x.tab" (its defaults), "mkspace x.tab 100 70 8 r" (backwards; with its defaults
 *   it writes space.tab over again, byte for byte) and "gentable x.tab 0" (rand() from 1;
 *   mkgentable's from srand(time(0)), the scene's seed here);
 * - Wintabs.exe's four, TABMAKE.EXE's smoke.tab and Wintab.exe's eight (tabgens.ts). Wintab
 *   writes slidehor.tab, slidever.tab and blocks.tab too, which in one folder would replace
 *   Wintabs' files; both are kept, Wintabs' named with the program in brackets. Wintab's
 *   blocks.tab shuffles by srand(time), the scene's seed here.
 * The generators' tables are made while the scene runs (LazyTab), or when first chosen.
 */
export function extraTabs(seed: number): TabSet {
  if (!extra) {
    const back = new Uint32Array(TAB_SIZE);
    mkspace(new MsRandom(1), back, 100, 70, 8, true);
    const hurricane2 = new Uint32Array(TAB_SIZE);
    mkhuricane(new MsRandom(1), hurricane2);
    const generated: { names: string[]; tables: (LazyTab | null)[] } = { names: [], tables: [] };
    for (const name of WINTABS) {
      generated.names.push(WINTAB.includes(name as (typeof WINTAB)[number]) ? `${name} (Wintabs)` : name);
      generated.tables.push(new LazyTab(() => wintabsJob(name)));
    }
    generated.names.push("smoke.tab");
    generated.tables.push(new LazyTab(smokeJob));
    for (const name of WINTAB) {
      generated.names.push(name);
      // blocks.tab depends on the seed: each scene makes its own (below).
      generated.tables.push(name === "blocks.tab" ? null : new LazyTab(() => wintabJob(name, 0)));
    }
    extra = { first: { names: ["mkspace_back.tab", "mkhuricane.tab"], tables: [back, hurricane2] }, generated };
  }
  const spiral = new Uint32Array(TAB_SIZE);
  mkgentable(new MsRandom(seed), spiral);
  const generated = extra.generated.tables.map((table) => table ?? new LazyTab(() => wintabJob("blocks.tab", seed)));
  return {
    names: [...extra.first.names, "gentable.tab", ...extra.generated.names],
    tables: [...extra.first.tables, spiral, ...generated]
  };
}

/** The loader's resolution steps (10008CE0's jump table on the Resolution setting). */
function steps(width: number, height: number): { skip: number; step: number } {
  if (width === 640) return { skip: height === 400 ? 40 : 0, step: 1 };
  if (width === 320) return { skip: height === 200 ? 40 : 0, step: 2 };
  return { skip: 0, step: 4 };
}

/** A 640 × 480 table read for a `width × height` buffer into `out` (width × height entries). */
export function convertTable(raw: Uint32Array, width: number, height: number, out: Uint32Array): void {
  const { skip, step } = steps(width, height);
  const limit = width * height;
  let count = 0;
  for (let y = 0; y < TAB_HEIGHT && count <= limit; y += 1) {
    if (y < skip || y >= TAB_HEIGHT - skip || y % step !== 0) continue;
    const row = y * TAB_WIDTH;
    for (let x = 0; x < TAB_WIDTH && count <= limit; x += 1) {
      if (x % step !== 0) continue;
      const v = raw[row + x]!;
      const o = (v & 0xffffff) - skip * 640;
      let n = Math.trunc(Math.trunc(o / 640) / step) * width + Math.trunc((o % 640) / step);
      if (n > limit || n < 0) n = 0;
      if (count < out.length) out[count] = ((n & 0xffffff) | (v & 0xff000000)) >>> 0;
      count += 1;
    }
  }
}
