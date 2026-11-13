/**
 * Cthugha-L 1.4's waves (src/waves.cc): how the sound is drawn into the buffer before the next
 * flame burns it. Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97
 * Harald Deischinger; waves by Pete, Aaron, Russ, Rus Maxham and Deischi as credited below.
 * Non-commercial use only, with credit (COPYING-cthugha-L.txt).
 *
 * Ported line by line, with the C source's static variables as fields of Waves (one set per
 * engine). Where the C code read past an array (a sample index beyond 1023, a colour beyond the
 * last table) this reads 0; where it wrote past the buffer nothing is written.
 */

import type { Context } from "./context";

/** A 3-D object: a list of lines, each two points (x, y, z). */
export type WObject = readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[];

/** big K */
const BIG_K: WObject = [
  [[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 3, 0]], [[1, 3, 0], [3, 0, 0]], [[3, 0, 0], [4, 0, 0]],
  [[4, 0, 0], [2, 3, 0]], [[2, 3, 0], [4, 7, 0]], [[4, 7, 0], [3, 7, 0]], [[3, 7, 0], [1, 4, 0]],
  [[1, 4, 0], [1, 7, 0]], [[1, 7, 0], [0, 7, 0]], [[0, 7, 0], [0, 0, 0]],
  [[0, 0, 1], [1, 0, 1]], [[1, 0, 1], [1, 3, 1]], [[1, 3, 1], [3, 0, 1]], [[3, 0, 1], [4, 0, 1]],
  [[4, 0, 1], [2, 3, 1]], [[2, 3, 1], [4, 7, 1]], [[4, 7, 1], [3, 7, 1]], [[3, 7, 1], [1, 4, 1]],
  [[1, 4, 1], [1, 7, 1]], [[1, 7, 1], [0, 7, 1]], [[0, 7, 1], [0, 0, 1]],
  [[0, 0, 1], [0, 0, 0]], [[1, 0, 1], [1, 0, 0]], [[1, 3, 1], [1, 3, 0]], [[3, 0, 1], [3, 0, 0]],
  [[4, 0, 1], [4, 0, 0]], [[2, 3, 1], [2, 3, 0]], [[4, 7, 1], [4, 7, 0]], [[3, 7, 1], [3, 7, 0]],
  [[1, 4, 1], [1, 4, 0]], [[1, 7, 1], [1, 7, 0]], [[0, 7, 1], [0, 7, 0]]
];

/** cube */
const CUBE4: WObject = [
  [[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 1, 0]], [[1, 1, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 0]],
  [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]], [[1, 1, 0], [1, 1, 1]], [[0, 1, 0], [0, 1, 1]],
  [[0, 0, 1], [1, 0, 1]], [[1, 0, 1], [1, 1, 1]], [[1, 1, 1], [0, 1, 1]], [[0, 1, 1], [0, 0, 1]]
];

/** another cube (named bigH) */
const CUBE1: WObject = [
  [[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 1, 0]], [[1, 1, 0], [2, 1, 0]], [[2, 1, 0], [2, 0, 0]],
  [[2, 0, 0], [3, 0, 0]], [[3, 0, 0], [3, 3, 0]], [[3, 3, 0], [2, 3, 0]], [[2, 3, 0], [2, 2, 0]],
  [[2, 2, 0], [1, 2, 0]], [[1, 2, 0], [1, 3, 0]], [[1, 3, 0], [0, 3, 0]], [[0, 3, 0], [0, 0, 0]]
];

export const OBJECTS: readonly { name: string; object: WObject }[] = [
  { name: "bigK", object: BIG_K },
  { name: "bigH", object: CUBE1 },
  { name: "Cube4", object: CUBE4 }
];

/** What a wave reads besides the buffer and the sound: the options of the moment. */
export interface WaveOptions {
  table: number;
  waveScale: number;
  object: WObject;
}

interface Firework {
  xv: number; yv: number; xp: number; yp: number; dur: number; col: number; oxp: number; oyp: number;
}

interface WarpRing {
  r: number; s: number; theta: number; omg: number; trails: number; col: number; rgrav: number;
}

/** The waves, with what each kept in static variables. */
export class Waves {
  private ctx: Context;
  private options: WaveOptions = { table: 0, waveScale: 0, object: BIG_K };
  /** static int data[MAX_BUFF_WIDTH][2]: the sound scaled to the samples a wave needs. */
  private readonly data = new Int32Array(2 * 1024);

  // wave_lineHor, wave_lineHLdiff
  private lineHorLast = 0;
  private hlDiffLast = 0;
  // wave_buff9 (Walking), wave_buff10 (Falling)
  private walkCol = 128;
  private fallRow = 0;
  // wave_pete0 (FireFlies)
  private xoff0 = 160; private yoff0 = 100; private xoff1 = 160; private yoff1 = 100;
  // wave_fract1, wave_fract2 (Zippy)
  private z1 = [0, 0, 0, 0];
  private z2 = [0, 0, 0, 0];
  // wave_aaron (Rings of Fire)
  private ax = 40; private ay = 0; private aaronFirst = true;
  private cxl = -1; private cxr = -1; private cyl = -1; private cyr = -1;
  // wave_wire1, wave_wire2
  private wireTheta = 0;
  private objChange = true;
  private whirlTheta = 0;
  private readonly psi = new Int32Array(10);
  private readonly rate = new Int32Array(10);
  private readonly col = new Int32Array(10);
  private readonly loc = new Int32Array(30);
  // wave_spiral
  private spiralOfs = 0; private spiralCol = 0; private spiralLoops = 2; private spiralLoopCount = 0;
  // wave_pyro
  private pyroFirst = true; private maxV = 0; private pyroMaxA = 30;
  private readonly works: Firework[] = Array.from({ length: 15 }, () => ({ xv: 0, yv: 0, xp: 0, yp: 0, dur: -1, col: 0, oxp: 0, oyp: 0 }));
  // wave_warp
  private warpFirst = true; private warpCx = 0; private warpCy = 0; private maxRad = 0; private warpMaxA = 0;
  private readonly warps: WarpRing[] = Array.from({ length: 15 }, () => ({ r: -1, s: 0, theta: 0, omg: 0, trails: 0, col: 0, rgrav: 0 }));
  // wave_laser
  private xl = 0; private xr = 0;
  // wave_corner
  private cornerX = 0; private cornerY = 0;
  // wave_jump
  private readonly speed = new Int32Array(1024);
  private readonly pos = new Int32Array(1024);
  private readonly dir = new Int32Array(1024);

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  /** The object changed (obj_change): Wire frame 2 sets up its whirl again. */
  objectChanged(): void {
    this.objChange = true;
  }

  /**
   * The waves in the order of the C source's list: each draws and returns true, or returns
   * false when the buffer is too small for it (the C code then moved on to the next wave).
   */
  readonly list: readonly { name: string; desc: string; draw: () => boolean }[] = [
    { name: "DotHor", desc: "Dots Horizontal", draw: () => this.dotHor() },
    { name: "DotVert", desc: "Dots Vertical", draw: () => this.dotVert() },
    { name: "LineHor", desc: "Lines Horizontal", draw: () => this.lineHor() },
    { name: "LineVert", desc: "Lines Vertical", draw: () => this.lineVert() },
    { name: "Spike", desc: "Spikes", draw: () => this.spike() },
    { name: "SpikeH", desc: "Spikes Hollow", draw: () => this.spikeH() },
    { name: "Walking", desc: "Walking", draw: () => this.walking() },
    { name: "Falling", desc: "Falling", draw: () => this.falling() },
    { name: "Lissa", desc: "Lissa", draw: () => this.lissa() },
    { name: "LineX", desc: "Line X", draw: () => this.lineX() },
    { name: "Light1", desc: "Lightning 1", draw: () => this.lightning(true) },
    { name: "Light2", desc: "Lightning 2", draw: () => this.lightning(false) },
    { name: "Pete0", desc: "FireFlies", draw: () => this.fireflies() },
    { name: "Pete1", desc: "Pete", draw: () => this.pete() },
    { name: "Pete2", desc: "Dot VS sine", draw: () => this.dotVsSine() },
    { name: "Fract1", desc: "Zippy 1", draw: () => this.zippy(this.z1, 1) },
    { name: "Fract2", desc: "Zippy 2", draw: () => this.zippy(this.z2, 0) },
    { name: "Test", desc: "Test", draw: () => this.test() },
    { name: "Aaron", desc: "Rings of Fire", draw: () => this.aaron() },
    { name: "Wire1", desc: "Wire frame 1", draw: () => this.wire1() },
    { name: "Wire2", desc: "Wire frame 2", draw: () => this.wire2() },
    { name: "LineHLDiff", desc: "Difference Hor.", draw: () => this.lineHLdiff() },
    { name: "Spiral", desc: "Spirograph", draw: () => this.spiral() },
    { name: "Pyro", desc: "Fire works", draw: () => this.pyro() },
    { name: "Warp", desc: "Space warp", draw: () => this.warp() },
    { name: "Laser", desc: "Laser", draw: () => this.laser() },
    { name: "Corner", desc: "Corner", draw: () => this.corner() },
    { name: "Jump", desc: "Jumping points", draw: () => this.jump() },
    { name: "Sticks", desc: "Random sticks", draw: () => this.sticks() }
  ];

  draw(index: number, options: WaveOptions): boolean {
    this.options = options;
    return this.list[index]?.draw() ?? true;
  }

  // --- helpers -------------------------------------------------------------------------------

  private tcolor(x: number): number {
    const index = this.options.table * 256 + x;
    return index >= 0 && index < 2560 ? this.ctx.tables[index]! : 0;
  }

  private putat(x: number, y: number, val: number): void {
    const ctx = this.ctx;
    const a = ctx.active;
    const at = ctx.BASE + x + y * ctx.W;
    a[at] = val;
    a[at - 1] = val;
    a[at + 1] = val;
    a[at + ctx.W] = val;
    a[at - ctx.W] = val;
  }

  private putatCut(x: number, y: number, val: number): void {
    if (x < 0 || x >= this.ctx.W) return;
    if (y < 0 || y >= this.ctx.H) return;
    this.putat(x, y, val);
  }

  private drawLine(x1: number, y1: number, x2: number, y2: number, c: number): void {
    const W = this.ctx.W;
    const H = this.ctx.H;
    const a = this.ctx.active;
    const base = this.ctx.BASE;
    x1 = Math.trunc(x1); y1 = Math.trunc(y1); x2 = Math.trunc(x2); y2 = Math.trunc(y2);
    if (x1 < 0) x1 = 0;
    if (x1 > W) x1 = W;
    if (x2 < 0) x2 = 0;
    if (x2 > W) x2 = W;
    if (y1 < 0) y1 = 0;
    if (y1 > H) y1 = H;
    if (y2 < 0) y2 = 0;
    if (y2 > H) y2 = H;
    const lx = Math.abs(x1 - x2);
    const ly = Math.abs(y1 - y2);
    const dx = x1 > x2 ? -1 : 1;
    const dy = y1 > y2 ? -1 : 1;
    if (lx > ly) {
      for (let i = x1, j = y1, k = 0; i !== x2; i += dx, k += ly) {
        if (k >= lx) {
          k -= lx;
          j += dy;
        }
        a[base + i + j * W] = c;
      }
    } else {
      for (let i = y1, j = x1, k = 0; i !== y2; i += dy, k += lx) {
        if (k >= ly) {
          k -= ly;
          j += dx;
        }
        a[base + j + i * W] = c;
      }
    }
  }

  private vwave(ystart: number, yend: number, x: number, val: number): void {
    const H = this.ctx.H;
    let ys = ystart > yend ? yend : ystart;
    let ye = ystart > yend ? ystart : yend;
    if (ys < 0) ys = 0;
    if (ys >= H) ys = H - 1;
    if (ye < 0) ye = 0;
    if (ye >= H) ye = H - 1;
    const a = this.ctx.active;
    let pos = this.ctx.BASE + x + ys * this.ctx.W;
    for (; ys <= ye; ys += 1) {
      a[pos] = val;
      pos += this.ctx.W;
    }
  }

  private hwave(xstart: number, xend: number, y: number, val: number): void {
    const W = this.ctx.W;
    let xs = xstart > xend ? xend : xstart;
    let xe = xstart > xend ? xstart : xend;
    while (xs < 0 && xe < 0) {
      xs += W;
      xe += W;
    }
    while (xs >= W && xe >= W) {
      xs -= W;
      xe -= W;
    }
    if (xs < 0) xs = 0;
    if (xs >= W) xs = W - 1;
    if (xe < 0) xe = 0;
    if (xe >= W) xe = W - 1;
    const a = this.ctx.active;
    let pos = this.ctx.BASE + xs + y * W;
    for (; xs <= xe; xs += 1) {
      a[pos] = val;
      pos += 1;
    }
  }

  /** prepareSoundData(n, add): dataProc scaled to n samples, plus `add`. */
  private prepare(n: number, add = 128): void {
    const proc = this.ctx.sound.proc;
    const data = this.data;
    let p = 0;
    const s = Math.trunc((1024 << 16) / n);
    for (let i = 0; i < n && i < 1024; i += 1) {
      const at = p >> 16;
      data[2 * i] = proc[2 * at]! + add;
      data[2 * i + 1] = proc[2 * at + 1]! + add;
      p += s;
    }
  }

  private d(i: number, channel: number): number {
    return i >= 0 && i < 1024 ? this.data[2 * i + channel]! : 0;
  }

  private get scale(): number {
    return this.options.waveScale;
  }

  // --- the waves ----------------------------------------------------------------------------

  private dotHor(): boolean {
    const { W, H } = this.ctx;
    const low = H - Math.trunc(H / 10);
    this.prepare(W);
    for (let x = 0; x < W; x += 1) {
      let tmp = this.d(x, 0);
      this.putatCut(x >> 1, low - (tmp >> this.scale), this.tcolor(tmp));
      tmp = this.d(x, 1);
      this.putatCut((x + W) >> 1, low - (tmp >> this.scale), this.tcolor(tmp));
    }
    return true;
  }

  private dotVert(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    const mid = W >> 1;
    this.prepare(bottom);
    for (let x = 0; x < bottom; x += 1) {
      let tmp = this.d(x, 0);
      this.putatCut(mid - (tmp >> this.scale), x, this.tcolor(tmp));
      tmp = this.d(x, 1);
      this.putatCut(mid + (tmp >> this.scale), x, this.tcolor(tmp));
    }
    return true;
  }

  private lineHor(): boolean {
    const { W, H } = this.ctx;
    const midY = H >> 1;
    this.prepare(W);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const tmp = this.d(x, y);
        this.vwave(midY - ((tmp - 128) >> this.scale), midY - ((this.lineHorLast - 128) >> this.scale),
          y ? (x + W) >> 1 : x >> 1, this.tcolor(tmp));
        this.lineHorLast = tmp;
      }
    }
    return true;
  }

  private lineVert(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    const mid = W >> 1;
    let last1 = 128;
    let last2 = 128;
    this.prepare(bottom);
    for (let x = 0; x < bottom; x += 1) {
      let tmp = this.d(x, 0);
      this.hwave(mid - (tmp >> this.scale), mid - (last1 >> this.scale), x, this.tcolor(tmp));
      last1 = tmp;
      tmp = this.d(x, 1);
      this.hwave(mid + (tmp >> this.scale), mid + (last2 >> this.scale), x, this.tcolor(tmp));
      last2 = tmp;
    }
    return true;
  }

  private spike(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    this.prepare(W, 0);
    for (let x = 0; x < W; x += 1) {
      let tmp = (2 * Math.abs(this.d(x, 0))) >> this.scale;
      if (tmp >= bottom) tmp = bottom - 1;
      for (let i = 0; i < tmp; i += 1) this.putat(x >> 1, bottom - i, this.tcolor(i));
      tmp = (2 * Math.abs(this.d(x, 1))) >> this.scale;
      if (tmp >= bottom) tmp = bottom - 1;
      for (let i = 0; i < tmp; i += 1) this.putat((x + W) >> 1, bottom - i, this.tcolor(i));
    }
    return true;
  }

  private spikeH(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    let last = 0;
    this.prepare(W, 0);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const tmp = (2 * Math.abs(this.d(x, y))) >> this.scale;
        this.vwave(bottom - tmp, bottom - last, y ? (x + W) >> 1 : x >> 1, this.tcolor(tmp));
        last = tmp;
      }
    }
    return true;
  }

  /** wave_buff9 */
  private walking(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    let last1 = 128;
    let last2 = 128;
    this.walkCol = (this.walkCol + 1) % W;
    const col = this.walkCol;
    this.prepare(bottom);
    for (let x = 0; x < bottom; x += 1) {
      let tmp = this.d(x, 0);
      this.hwave(col - (tmp >> this.scale), col - (last1 >> this.scale), x, this.tcolor(tmp));
      last1 = tmp;
      tmp = this.d(x, 1);
      this.hwave(col + (tmp >> this.scale), col + (last2 >> this.scale), x, this.tcolor(tmp));
      last2 = tmp;
    }
    return true;
  }

  /** wave_buff10 */
  private falling(): boolean {
    const { W, H } = this.ctx;
    const mid = W >> 1;
    this.prepare(2 * mid);
    this.fallRow = (this.fallRow + 1) % (H - 1);
    const row = this.fallRow;
    for (let i = 0; i < mid; i += 1) {
      this.putat(i, row + 1, this.tcolor(this.d(i, 0)));
      this.putat(i + mid, row + 1, this.tcolor(this.d(i, 1)));
      this.putat(i, row, this.tcolor(this.d(i + mid, 0)));
      this.putat(i + mid, row, this.tcolor(this.d(i + mid, 1)));
    }
    return true;
  }

  /** wave_buff11 */
  private lissa(): boolean {
    const { W, H } = this.ctx;
    this.prepare(W);
    for (let x = 0; x < W; x += 1) {
      const tmp = this.d(x, 0);
      const tmp2 = this.d(x, 1);
      this.putat((tmp2 + 32) % W, (tmp + 200 - 28) % (H - 1), this.tcolor(tmp));
    }
    return true;
  }

  /** wave_buff14 */
  private lineX(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    const mid = W >> 1;
    let last = 128;
    this.prepare(bottom);
    for (let x = 0; x < bottom; x += 1) {
      const tmp = this.d(x, 0);
      this.hwave(mid - (tmp >> this.scale), mid - (last >> this.scale), x, this.tcolor(tmp));
      last = tmp;
    }
    for (let x = 0; x < bottom; x += 1) {
      const tmp = this.d(x, 1);
      this.hwave(mid - 40 + (tmp >> this.scale), mid - 40 + (last >> this.scale), x, this.tcolor(tmp));
      last = tmp;
    }
    return true;
  }

  /** wave_buff15 (Lightning 1) and wave_buff16 (Lightning 2). */
  private lightning(first: boolean): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    const shift = first ? 4 : 5;
    this.prepare(first ? bottom : W, 0);
    for (let channel = 0; channel < 2; channel += 1) {
      let last = channel ? Math.trunc((2 * W) / 3) : Math.trunc(W / 3);
      for (let x = 0; x < bottom; x += 1) {
        let tmp = (this.d(x, channel) >> shift) + last;
        if (tmp >= W) tmp = W - 1;
        if (tmp < 0) tmp = 0;
        this.hwave(tmp, last, x, 255);
        last = tmp;
      }
    }
    return true;
  }

  /** wave_pete0 */
  private fireflies(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    this.prepare(W);
    this.xoff0 += (this.d(0, 0) % 9) - 4;
    this.yoff0 += (this.d(1, 0) % 9) - 4;
    this.xoff1 += (this.d(0, 1) % 9) - 4;
    this.yoff1 += (this.d(1, 1) % 9) - 4;
    while (this.xoff0 < 0) this.xoff0 += W;
    while (this.yoff0 < 0) this.yoff0 += bottom;
    while (this.xoff1 < 0) this.xoff1 += W;
    while (this.yoff1 < 0) this.yoff1 += bottom;
    this.xoff0 %= W;
    this.xoff1 %= W;
    this.yoff0 %= H;
    this.yoff1 %= H;
    for (let x = 0; x < W; x += 1) {
      let temp = this.d(x, 0);
      let temp2 = this.d((x + 80) % W, 0);
      this.putat(((temp2 >> 2) + this.xoff0) % W, ((temp >> 2) + this.yoff0) % bottom, this.tcolor(temp));
      temp = this.d(x, 1) + 128;
      temp2 = this.d((x + 80) % W, 1) + 128;
      this.putat(((temp2 >> 2) + this.xoff1) % W, ((temp >> 2) + this.yoff1) % bottom, this.tcolor(temp));
    }
    return true;
  }

  /** wave_pete1 */
  private pete(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    const mid = W >> 1;
    let left = 0;
    let right = 0;
    this.prepare(W, 0);
    for (let x = 0; x < W; x += 1) {
      left += Math.abs(this.d(x, 0));
      right += Math.abs(this.d(x, 1));
    }
    left = Math.min(Math.trunc(left / mid), bottom);
    right = Math.min(Math.trunc(right / mid), bottom);
    const bsine = this.ctx.bsine;
    for (let x = 0; x < mid; x += 1) {
      this.putatCut(x, bottom - (Math.abs(left * bsine[x]!) >> 8), this.tcolor(this.d(x, 0)));
    }
    for (let x = mid; x < W; x += 1) {
      this.putatCut(x, bottom - (Math.abs(right * bsine[x]!) >> 8), this.tcolor(this.d(x, 1)));
    }
    return true;
  }

  /** wave_pete2 */
  private dotVsSine(): boolean {
    const { W, H } = this.ctx;
    const mid = W >> 1;
    const sine = this.ctx.sine;
    this.prepare(H);
    for (let x = 0; x < H; x += 1) {
      let tmp = this.d(x, 0);
      this.putatCut(mid - (tmp >> this.scale), x, this.tcolor(sine[tmp] ?? 0));
      tmp = this.d(x, 1);
      this.putatCut(mid + (tmp >> this.scale), x, this.tcolor(sine[tmp] ?? 0));
    }
    return true;
  }

  /** wave_fract1 (shift 1) and wave_fract2 (shift 0): [xoff0, yoff0, xoff1, yoff1]. */
  private zippy(off: number[], shift: number): boolean {
    const { W, H } = this.ctx;
    this.prepare(W);
    let temp = this.d(0, 0);
    for (let x = 0; x < W - 2; x += 2) {
      off[0] = off[0]! + ((this.d(x, 0) - temp) >> shift);
      temp = this.d(x, 0);
      // Zippy 1 loops "while (xoff0 < 0)", Zippy 2 tests it once: the same, since it is set ≥ 0.
      if (off[0]! < 0) off[0] = W - 1;
      off[0] = off[0]! % W;
      this.putat(off[0]!, off[1]!, this.tcolor(temp));
      off[1] = off[1]! + ((this.d(x + 1, 0) - temp) >> shift);
      temp = this.d(x + 1, 0);
      if (off[1]! < 0) off[1] = H - 1;
      off[1] = off[1]! % H;
      this.putat(off[0]!, off[1]!, this.tcolor(temp));
    }
    temp = this.d(0, 1);
    for (let x = 0; x < W - 2; x += 2) {
      off[2] = off[2]! + ((this.d(x, 1) - temp) >> shift);
      temp = this.d(x, 1);
      if (off[2]! < 0) off[2] = W - 1;
      off[2] = off[2]! % W;
      this.putat(off[2]!, off[3]!, this.tcolor(temp));
      off[3] = off[3]! - ((this.d(x + 1, 1) - temp) >> shift);
      temp = this.d(x + 1, 1);
      if (off[3]! < 0) off[3] = H - 1;
      off[3] = off[3]! % H;
      this.putat(off[2]!, off[3]!, this.tcolor(temp));
    }
    return true;
  }

  private test(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    const mid = W >> 1;
    let left = 0;
    let right = 0;
    this.prepare(W, 0);
    for (let x = 0; x < W; x += 1) {
      left += Math.abs(this.d(x, 0));
      right += Math.abs(this.d(x, 1));
    }
    left = Math.min(Math.trunc(left / 128), 199);
    right = Math.min(Math.trunc(right / 128), 199);
    const bsine = this.ctx.bsine;
    for (let x = 0; x < mid; x += 1) {
      this.putatCut(x, bottom - (Math.abs(left * bsine[x]!) >> 8), this.tcolor(this.d(x, 0) + 128));
    }
    for (let x = mid; x < W; x += 1) {
      this.putatCut(x, bottom - (Math.abs(right * bsine[x]!) >> 8), this.tcolor(this.d(x, 1) + 128));
    }
    return true;
  }

  /**
   * From root@hangon.onramp.net, Sun Jun 18 1995, changed by Deischinger Harald and Rus Maxham:
   * the rings have a radius of 64.
   */
  private aaron(): boolean {
    const { W, H } = this.ctx;
    const bottom = H - 1;
    if (this.aaronFirst) {
      this.aaronFirst = false;
      this.cxl = Math.trunc((W - 256) / 2) + 64 + 128;
      this.cxr = Math.trunc((W - 256) / 2) - 64 + 128;
      this.cyl = Math.trunc((bottom - 256) / 2) + 128;
      this.cyr = this.cyl;
    }
    if (!(H > 128 && W >= 256)) return false;
    const sine = this.ctx.sine;
    let txl = 0;
    let tyl = 0;
    let txr = 0;
    let tyr = 0;
    this.prepare(W);
    for (let i = 0; i < W; i += 1) {
      if (this.ay >= 320) this.ay -= 320;
      if (this.ax >= 320) this.ax -= 320;
      let tmp = this.d(i, 0);
      let sx = (sine[this.ax]! * tmp) >> 9;
      txl += sx;
      let sy = (sine[this.ay]! * tmp) >> 9;
      tyl += sy;
      this.putatCut(this.cxl + sx, this.cyl + sy, this.tcolor(tmp));
      tmp = this.d(i, 1);
      sx = (sine[this.ax]! * tmp) >> 9;
      txr += sx;
      sy = (sine[this.ay]! * tmp) >> 9;
      tyr += sy;
      this.putatCut(this.cxr - sx, this.cyr - sy, this.tcolor(tmp));
      this.ax += 1;
      this.ay += 1;
    }
    this.cxl += Math.trunc((txl * 3) / W) + 1;
    this.cyl += Math.trunc((tyl * 3) / W) + 1;
    this.cxr += Math.trunc((txr * 3) / W) + 1;
    this.cyr += Math.trunc((tyr * 3) / W) + 1;
    this.cxl %= W;
    this.cxr %= W;
    this.cyl %= H;
    this.cyr %= H;
    if (this.cxl < 0) this.cxl += W;
    if (this.cxr < 0) this.cxr += W;
    if (this.cyl < 0) this.cyl += H;
    if (this.cyr < 0) this.cyr += H;
    return true;
  }

  /** Line horizontal long diff */
  private lineHLdiff(): boolean {
    const { W, H } = this.ctx;
    const midY = H >> 1;
    this.prepare(W, 0);
    for (let x = 0; x < W; x += 1) {
      const tmp = this.d(x, 0) - this.d(x, 1);
      this.vwave(midY - tmp, midY - this.hlDiffLast, x, this.tcolor(tmp + 128));
      this.hlDiffLast = H < 300 ? tmp : tmp << 1;
    }
    return true;
  }

  /** by Russ, changed by Harald */
  private wire1(): boolean {
    const { W, H } = this.ctx;
    const obj = this.options.object;
    const n = obj.length;
    if (!n) return false;
    const proc = this.ctx.sound.proc;
    this.wireTheta += Math.PI / 45;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const line of obj) {
      for (const point of line) {
        if (point[0] > mx) mx = point[0];
        if (point[1] > my) my = point[1];
        if (point[2] > mz) mz = point[2];
      }
    }
    let m = Math.max(mx, my, mz);
    m += 1;
    const scl = (Math.min(H, W) * 0.9) / m;
    const ox = Math.trunc(W / 2) - Math.trunc(mx / 2);
    const oy = Math.trunc(H / 2) - Math.trunc(my / 2);
    const px = mx / 2;
    const py = my / 2;
    const pz = mz / 2;
    const st = Math.sin(this.wireTheta);
    const ct = Math.cos(this.wireTheta);
    const per = Math.trunc(W / n);
    for (let i = 0; i < n; i += 1) {
      let s0 = 0;
      let s1 = 0;
      for (let j = 0; j < Math.trunc(1024 / n); j += 1) {
        const at = i * n + j;
        if (at < 1024) {
          s0 += Math.abs(proc[2 * at]!);
          s1 += Math.abs(proc[2 * at + 1]!);
        }
      }
      const scale0 = (scl * (s0 / per)) / 64;
      const scale1 = (scl * (s1 / per)) / 64;
      const line = obj[i]!;
      let x = line[0][0] - px;
      let y = line[0][1] - py;
      let z = line[0][2] - pz;
      let ax = x * ct + z * st;
      let ay = y;
      let az = z * ct - x * st;
      const x1 = Math.trunc((ax * scale0) / (az + m) + ox);
      const y1 = Math.trunc((ay * scale0) / (az + m) + oy);
      x = line[1][0] - px;
      y = line[1][1] - py;
      z = line[1][2] - pz;
      ax = x * ct + z * st;
      ay = y;
      az = z * ct - x * st;
      const x2 = Math.trunc((ax * scale1) / (az + m) + ox);
      const y2 = Math.trunc((ay * scale1) / (az + m) + oy);
      this.drawLine(x1, y1, x2, y2, this.tcolor(255));
    }
    return true;
  }

  /** by Russ, changed by Harald: ten copies of the object whirling round. */
  private wire2(): boolean {
    const { W, H } = this.ctx;
    const random = this.ctx.random;
    const obj = this.options.object;
    if (!obj.length) return false;
    const radius = 45;
    if (this.objChange) {
      this.objChange = false;
      for (let i = 0; i < 10; i += 1) {
        this.loc[3 * i + 1] = (random.rand() % (radius * 2)) - radius;
        const j = random.rand() % 320;
        const k = random.rand() % radius;
        this.loc[3 * i] = Math.trunc(this.ctx.isin(j) * k);
        this.loc[3 * i + 2] = Math.trunc(this.ctx.icos(j) * k);
        this.rate[i] = random.rand() % 8;
        if (random.rand() % 2) this.rate[i] = -this.rate[i]!;
        this.psi[i] = 0;
        this.col[i] = Math.abs(random.rand() % 256);
      }
    }
    this.whirlTheta += 1;
    let omx = 0;
    let omy = 0;
    let omz = 0;
    for (const line of obj) {
      for (const point of line) {
        if (point[0] > omx) omx = point[0];
        if (point[1] > omy) omy = point[1];
        if (point[2] > omz) omz = point[2];
      }
    }
    omx /= 2;
    omy /= 2;
    omz /= 2;
    const om = omy / 3;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 10; i += 1) {
      if (this.loc[3 * i]! > mx) mx = this.loc[3 * i]!;
      if (this.loc[3 * i + 1]! > my) my = this.loc[3 * i + 1]!;
    }
    const m = Math.trunc((radius * 3) / 2);
    const scl = H * 0.8 || 1;
    const ox = Math.trunc(W / 2) - Math.trunc(mx / 2);
    const oy = Math.trunc(H / 2) - Math.trunc(my / 2);
    const st = this.ctx.isin(this.whirlTheta);
    const ct = this.ctx.icos(this.whirlTheta);
    for (let j = 0; j < 10; j += 1) {
      const sto = this.ctx.isin(this.psi[j]!);
      const cto = this.ctx.icos(this.psi[j]!);
      this.psi[j] = this.psi[j]! + this.rate[j]!;
      const lx = this.loc[3 * j]!;
      const ly = this.loc[3 * j + 1]!;
      const lz = this.loc[3 * j + 2]!;
      for (const line of obj) {
        let ax = lx * ct + lz * st;
        let ay = ly;
        let az = lz * ct - lx * st;
        let x = (line[0][0] - omx) / om;
        let y = (line[0][1] - omy) / om;
        let z = (line[0][2] - omz) / om;
        ax += x * cto + z * sto;
        ay += y;
        az += z * cto - x * sto;
        const x1 = Math.trunc((ax * scl) / (az + m) + ox);
        const y1 = Math.trunc((ay * scl) / (az + m) + oy);
        ax = lx * ct + lz * st;
        ay = ly;
        az = lz * ct - lx * st;
        x = (line[1][0] - omx) / om;
        y = (line[1][1] - omy) / om;
        z = (line[1][2] - omz) / om;
        ax += x * cto + z * sto;
        ay += y;
        az += z * cto - x * sto;
        const x2 = Math.trunc((ax * scl) / (az + m) + ox);
        const y2 = Math.trunc((ay * scl) / (az + m) + oy);
        this.drawLine(x1, y1, x2, y2, this.tcolor(this.col[j]!));
      }
    }
    return true;
  }

  /** by Russ */
  private spiral(): boolean {
    const { W, H } = this.ctx;
    const sine = this.ctx.sine;
    const analysis = this.ctx.analysis;
    this.spiralCol = (this.spiralCol + 1) % 256;
    this.spiralOfs = (this.spiralOfs + 1) % 320;
    if (this.spiralLoopCount <= 0) {
      this.spiralLoopCount = Math.abs(this.ctx.random.rand() % 1000);
      this.spiralLoops = 2 + Math.abs(this.ctx.random.rand() % 8);
    }
    this.spiralLoopCount -= 1;
    const ofs = this.spiralOfs;
    const loops = this.spiralLoops;
    const mx = Math.min(W, H);
    const cx = Math.trunc(W / 2);
    const cy = Math.trunc(H / 2);
    const a = (analysis.amplitude * mx) / 256 / 128;
    const la = (analysis.amplitudeLeft * mx) / 256 / 128;
    const ra = (analysis.amplitudeRight * mx) / 256 / 128;
    let ox = Math.trunc(a * sine[(ofs + 120) % 320]! + (la * sine[120]!) / 2);
    let oy = Math.trunc(a * sine[ofs]! + (ra * sine[0]!) / 2);
    const colour = this.tcolor(this.spiralCol);
    for (let i = 1; i < 320; i += 1) {
      const x = a * sine[(i + ofs + 120) % 320]! + (la * sine[(i * loops + 120) % 320]!) / 2;
      const y = a * sine[(i + ofs) % 320]! + (ra * sine[(i * loops) % 320]!) / 2;
      this.drawLine(cx + ox, cy + oy, cx + x, cy + y, colour);
      ox = x;
      oy = y;
    }
    return true;
  }

  /** by Russ: fire works, launched by the attack of the sound. */
  private pyro(): boolean {
    const { W, H } = this.ctx;
    const random = this.ctx.random;
    const analysis = this.ctx.analysis;
    if (this.pyroFirst) {
      this.pyroFirst = false;
      for (const work of this.works) work.dur = -1;
      let fire = 0;
      this.maxV = 0;
      for (; fire < H; this.maxV += 1, fire += this.maxV);
      this.maxV -= 1;
      this.pyroMaxA = 30;
    }
    for (const work of this.works) {
      if (work.dur !== -1) {
        const x1 = work.xp + work.xv;
        const y1 = work.yp + work.yv;
        this.drawLine(work.oxp, work.oyp, x1, y1, this.tcolor(work.col));
        this.drawLine(work.oxp + 1, work.oyp, x1 + 1, y1, this.tcolor(work.col));
        if (x1 < 0 || x1 > W) work.xv *= -1;
        work.yv += 1;
        work.dur += 1;
        work.oxp = work.xp;
        work.oyp = work.yp;
        work.xp = x1;
        work.yp = y1;
        if (work.yv > 5 || work.yp < 0) work.dur = -1;
      } else if (analysis.fire) {
        if (analysis.fire * 4 > this.pyroMaxA) this.pyroMaxA = analysis.fire * 4;
        if (this.pyroMaxA > 30) this.pyroMaxA -= 1;
        work.dur = 0;
        work.oxp = work.xp = random.rand() % W;
        work.oyp = work.yp = H - 4;
        work.xv = (random.rand() % 20) - 10;
        work.yv = -Math.trunc((analysis.fire * this.maxV) / Math.max(1, Math.trunc(this.pyroMaxA / 4)));
        work.col = random.rand() % 256;
        analysis.fire = Math.trunc((analysis.fire * 2) / 3);
      }
    }
    return true;
  }

  /** Space warp: rings of lines flying out of the middle on the attack of the sound. */
  private warp(): boolean {
    const { W, H } = this.ctx;
    const random = this.ctx.random;
    const analysis = this.ctx.analysis;
    if (this.warpFirst) {
      this.warpFirst = false;
      for (const ring of this.warps) ring.r = -1;
      this.warpCx = Math.trunc(W / 2);
      this.warpCy = Math.trunc(H / 2);
      this.maxRad = Math.max(this.warpCx, this.warpCy);
    }
    const cx = this.warpCx;
    const cy = this.warpCy;
    for (const ring of this.warps) {
      if (ring.r !== -1) {
        const r2 = ring.r + ring.s;
        const t2 = ring.theta + ring.omg;
        const tr = ring.trails;
        for (let j = 0; j < tr; j += 1) {
          const step = Math.trunc((360 * j) / tr);
          const x1 = Math.trunc(cx + ring.r * this.ctx.isin(step + ring.theta));
          const y1 = Math.trunc(cy + ring.r * this.ctx.icos(step + ring.theta));
          const x2 = Math.trunc(cx + r2 * this.ctx.isin(step + t2));
          const y2 = Math.trunc(cy + r2 * this.ctx.icos(step + t2));
          this.drawLine(x1, y1, x2, y2, this.tcolor(ring.col));
        }
        ring.r += ring.s;
        ring.theta += ring.omg;
        ring.s -= ring.rgrav;
        if (ring.r > this.maxRad || ring.r < 0) ring.r = -1;
      } else if (analysis.fire) {
        if (analysis.fire * 4 > this.warpMaxA) this.warpMaxA = analysis.fire * 4;
        if (this.warpMaxA > 30) this.warpMaxA -= 1;
        const maxA = Math.max(1, this.warpMaxA);
        ring.r = 0;
        ring.s = 3 + Math.trunc((analysis.fire * 4 * 20) / maxA);
        ring.trails = 1 + Math.trunc((analysis.fire * 4 * 20) / maxA);
        ring.theta = random.rand() % 360;
        ring.omg = Math.trunc((((random.rand() % 16) - 8) * analysis.fire * 4) / maxA);
        ring.col = random.rand() % 256;
        ring.rgrav = random.rand() % 2;
        analysis.fire = 0;
      }
    }
    return true;
  }

  /** by Deischi */
  private laser(): boolean {
    const { W, H } = this.ctx;
    const n = Math.trunc(W / 10);
    this.prepare(n, 0);
    const y = Math.trunc(H / 10);
    for (let x = 0; x < n; x += 1) {
      this.drawLine(Math.trunc(W / 2), Math.trunc(H / 2), this.xl, y, this.tcolor(255));
      this.xl = (this.xl + Math.abs(this.d(x, 0) - this.d(x + 1, 0))) % W;
      this.drawLine(Math.trunc(W / 2), Math.trunc(H / 2), this.xr, H - y, this.tcolor(255));
      this.xr = (this.xr + Math.abs(this.d(x, 1) - this.d(x + 1, 1))) % W;
    }
    return true;
  }

  /** by Deischi (inspired by RTL2) */
  private corner(): boolean {
    const { W, H } = this.ctx;
    const random = this.ctx.random;
    const analysis = this.ctx.analysis;
    const fire = analysis.fire;
    if (fire > 0) {
      this.cornerX = ((this.cornerX + (random.rand() % fire)) % (W - 16)) + 8;
      this.cornerY = ((this.cornerY + (random.rand() % fire)) % (H - 16)) + 8;
      const x = this.cornerX;
      const y = this.cornerY;
      const t = Math.min(fire >> 2, 8);
      if (random.rand() & 1) {
        // A corner pointing right down.
        for (let i = 0; i < t; i += 1) {
          for (let j = 0; j < x; j += 1) {
            this.putat(j, y + i, 255 >> i);
            this.putat(j, y - i, 255 >> i);
          }
          for (let j = 0; j < y; j += 1) {
            this.putat(x - i, j, 255 >> i);
            this.putat(x + i, j, 255 >> i);
          }
        }
      } else {
        // A corner pointing up left.
        for (let i = 0; i < t; i += 1) {
          for (let j = x; j < W; j += 1) {
            this.putat(j, y + i, 255 >> i);
            this.putat(j, y - i, 255 >> i);
          }
          for (let j = y; j < H; j += 1) {
            this.putat(x - i, j, 255 >> i);
            this.putat(x + i, j, 255 >> i);
          }
        }
      }
    }
    analysis.fire = 0;
    return true;
  }

  /** by Deischi */
  private jump(): boolean {
    const { W, H } = this.ctx;
    this.prepare(W);
    const scale = 2 + this.scale;
    const fps = Math.trunc(this.ctx.fps);
    for (let i = 0; i < W && i < 1024; i += 1) {
      const e = this.d(i, 0) + this.d(i, 1);
      if (this.pos[i]! < Math.abs(e)) {
        this.speed[i] = Math.abs(e);
        this.dir[i] = e > 0 ? 1 : 0;
      }
      this.pos[i] = this.pos[i]! + this.speed[i]!;
      if (this.pos[i]! < 0) {
        this.pos[i] = 0;
        this.speed[i] = 0;
      } else {
        this.speed[i] = this.speed[i]! - fps;
      }
      const offset = this.pos[i]! >> scale;
      this.putatCut(i, (this.dir[i]! > 0 ? offset : -offset) + Math.trunc(H / 2), 255);
    }
    return true;
  }

  /** by Deischi */
  private sticks(): boolean {
    const { W, H } = this.ctx;
    const random = this.ctx.random;
    const n = this.ctx.analysis.fire >> this.scale;
    for (let i = 0; i < n; i += 1) {
      this.drawLine(random.random(W), random.random(H), random.random(W), random.random(H), random.random(256));
    }
    return true;
  }
}
