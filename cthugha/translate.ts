/**
 * Cthugha-L 1.4's translations (src/translate.cc) and the programs that made its tables
 * (tab/cmd_*.c): gentable after mkgentable by Zaph; hurricane, smoke and space after the
 * generators by Ofer Faigon (Sep 1994); "Krusty Wheel" 1 and 2 and randswirls. Cthugha (c) Kevin
 * "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald Deischinger. Non-commercial use
 * only, with credit (COPYING-cthugha-L.txt).
 *
 * A translation table says, for every pixel, which pixel of the last picture it takes: the
 * picture flows — spirals, rotates, flies through space — as it burns. Cthugha-L ran each table's
 * program when the table was chosen and read its output ten lines a frame, the table taking
 * effect line by line from the top, and kept it once complete; so here, each program a generator
 * that hands out its lines (randswirls computes for a few frames before its first line).
 */

import { CRandom } from "./context";

/** One line of a table, or null while the program is still computing. */
type Program = Generator<Int32Array | null, void, void>;

export interface TranslateEntry {
  readonly name: string;
  readonly desc: string;
  /** The program, for this buffer size and its own random numbers; none for "none". */
  readonly program: ((W: number, H: number, random: CRandom) => Program) | null;
}

/** C's (int) of a double: towards zero. */
const int = Math.trunc;

/** cmd_gentable: spirals around random centres (or one in the middle), or the yin-yang. */
function* gentable(W: number, H: number, random: CRandom, args: { spirals: number; yinyang: boolean; yywidth: number; deltaR: number; deltaA: number }): Program {
  const centersX: number[] = [];
  const centersY: number[] = [];
  const dir: number[] = [];
  if (args.spirals === 0) {
    centersX.push(int(W / 2));
    centersY.push(int(H / 2));
    dir.push(1);
  } else {
    const n = Math.max(Math.min(args.spirals, 64), 1);
    for (let i = 0; i < n; i += 1) {
      centersX.push(random.rand() % W);
      centersY.push(random.rand() % H);
      dir.push((random.rand() % 5) - 2);
    }
  }
  for (let y = 0; y < H; y += 1) {
    const line = new Int32Array(W);
    for (let x = 0; x < W; x += 1) {
      let closest = 0;
      let dist = 9999999.0;
      for (let i = 0; i < centersX.length; i += 1) {
        const d = Math.sqrt((x - centersX[i]!) ** 2 + (y - centersY[i]!) ** 2);
        if (dist > d) {
          closest = i;
          dist = d;
        }
      }
      let map = 0;
      if (!(x === centersX[closest] && y === centersY[closest])) {
        const centY = centersY[closest]!;
        const centX = centersX[closest]!;
        const tx = Math.abs(x - centX);
        const ty = Math.abs(y - centY);
        let polarR = Math.sqrt(tx * tx + ty * ty);
        let polarA = Math.atan2(x - centX, y - centY);
        polarR += (args.deltaR + (random.rand() % 10) * 0.01) * dir[closest]!;
        if (polarR < 0) polarR = 0;
        if (args.yinyang) {
          polarA -= (args.deltaA * 3.0 * (5 - (int(polarR / 11) % 11))) / 5.0;
          if (int(polarR / args.yywidth) % 2) polarA += args.deltaA;
          else polarA -= args.deltaA;
        } else {
          polarA += (args.deltaA + (random.rand() % 10) * 0.01) * dir[closest]!;
        }
        let mapX = int(polarR * Math.sin(polarA) + centX);
        let mapY = int(polarR * Math.cos(polarA) + centY);
        if (mapY >= H || mapY < 0 || mapX >= W || mapX < 0) {
          mapX = 0;
          mapY = 0;
        }
        map = mapY * W + mapX;
      }
      line[x] = map;
    }
    yield line;
  }
}

/** cmd_space: flying forward through space; a little noise in the middle. */
function* space(W: number, H: number, random: CRandom, speedArg: number, randomnessArg: number): Program {
  const speed = Math.min(Math.max(speedArg, 30), 300);
  const randomness = Math.min(Math.max(randomnessArg, 0), 100);
  for (let y = 0; y < H; y += 1) {
    const line = new Int32Array(W);
    for (let x = 0; x < W; x += 1) {
      const dx = x - int(W / 2);
      const dy = y - int(H / 2);
      let mapX: number;
      let mapY: number;
      if (Math.abs(dx) < 30 && Math.abs(dy) < 20 && random.random(Math.abs(dx) + Math.abs(dy)) < 4) {
        mapX = random.random(W);
        mapY = random.random(H);
      } else {
        let sp: number;
        if (randomness === 0) sp = speed;
        else {
          const speedFactor = random.random(randomness + 1) - int(randomness / 3);
          sp = int((speed * (100 + speedFactor)) / 100);
        }
        mapX = int(x - int((dx * sp) / 700));
        mapY = int(y - int((dy * sp) / 700));
      }
      if (mapY >= H || mapY < 0 || mapX >= W || mapX < 0) {
        mapX = 0;
        mapY = 0;
      }
      line[x] = mapY * W + mapX;
    }
    yield line;
  }
}

/** cmd_smoke: smoke rising from the burning waves. */
function* smoke(W: number, H: number, random: CRandom): Program {
  const speed = 100;
  const randomness = 70;
  for (let y = 0; y < H; y += 1) {
    const line = new Int32Array(W);
    for (let x = 0; x < W; x += 1) {
      let mapX = x - int(((5 + random.random(int((12 * randomness) / 100))) * speed) / 100);
      let mapY = y - int(((5 + random.random(int((12 * randomness) / 100))) * speed) / 100);
      if (mapY >= H || mapY < 0 || mapX >= W || mapX < 0) {
        mapX = 0;
        mapY = 0;
      }
      line[x] = mapY * W + mapX;
    }
    yield line;
  }
}

/** cmd_huricn: a satellite view of a hurricane, or Jupiter's red spot (centre off the middle). */
function* hurricane(W: number, H: number, random: CRandom): Program {
  const xCenter = int(W / 3);
  const yCenter = int(H / 2) - 10;
  const speed = 100;
  const randomness = 70;
  for (let y = 0; y < H; y += 1) {
    const line = new Int32Array(W);
    for (let x = 0; x < W; x += 1) {
      const speedFactor = random.random(randomness + 1) - int(randomness / 3);
      const sp = int((speed * (100 + speedFactor)) / 100);
      let dx = x - xCenter;
      const dy = y - yCenter;
      // The default: -sy, slowing down vertical movements.
      const dSquared = dx * dx + dy * dy + 1;
      dx = int((dx * 2500) / dSquared);
      let mapX = int(x + int((dy * sp) / 700));
      let mapY = int(y - int((dx * sp) / 700));
      while (mapY < 0) mapY += H;
      while (mapX < 0) mapX += W;
      mapY %= H;
      mapX %= W;
      line[x] = mapY * W + mapX;
    }
    yield line;
  }
}

/** cmd_bighalfwheel ("Krusty Wheel 1") and cmd_downspiral ("Krusty Wheel 2"). */
function* wheel(W: number, H: number, half: boolean): Program {
  const PI = 3.14159265399;
  const bsize = W * H;
  const cx = half ? int(W * 0.4) : int(W / 2);
  const cy = half ? 0 : int(H / 2);
  const q = 3.14159265399 / 2;
  const p = half ? 0 : (45 / 180) * PI;
  for (let j = 0; j < H; j += 1) {
    const line = new Int32Array(W);
    for (let i = 0; i < W; i += 1) {
      let dx: number;
      let dy: number;
      if (j === 0) {
        dx = int((cx - i) * 0.75);
        dy = cy - j;
      } else {
        const dist = int(Math.sqrt((i - cx) * (i - cx) + (j - cy) * (j - cy)));
        let ang: number;
        if (i === cx) ang = j > cx ? q : -q;
        else ang = Math.atan((j - cy) / (i - cx));
        if (i < cx) ang += PI;
        if (!half || dist < H) {
          dx = Math.ceil((-Math.sin(ang - p) * dist) / 10.0);
          dy = Math.ceil((Math.cos(ang - p) * dist) / 10.0);
        } else {
          dx = i < cx ? 3 : -3;
          dy = 0;
        }
        if (i === 0) {
          dx = cx - i;
          dy = int((cy - j) * 0.75);
        }
      }
      line[i] = Math.abs(i + dx + (j + dy) * W) % bsize;
    }
    yield line;
  }
}

/** cmd_randswirls: a line swept along a wandering path, each point taking from where it was. */
function* randswirls(W: number, H: number, random: CRandom): Program {
  const bsize = W * H;
  const stepInc = W / 2500;
  const table = new Int32Array(bsize);
  const llen = int(Math.min(W, H) * 0.35);
  const cl = int(llen / 2);
  const dist = Math.max(1, int(8 / stepInc));
  const nx = new Int32Array(llen * dist);
  const ny = new Int32Array(llen * dist);
  for (let j = 0; j < dist; j += 1) for (let k = 0; k < llen; k += 1) ny[j * llen + k] = k;
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) table[i + j * W] = Math.abs(i - 3 + j * W) % bsize;
  let cx = 0;
  let cy = cl;
  let ang = 0;
  let p = random.rand() % 20;
  let a = 0;
  for (let k = 0; k < 100000; k += 1) {
    if (random.rand() % 50 === 1) p = (random.rand() % 20) - 10;
    ang += (p / 360) * stepInc;
    const s = Math.sin(ang) * stepInc;
    const c = Math.cos(ang) * stepInc;
    cx += s;
    cy += c;
    for (let i = 0; i < llen; i += 1) {
      const at = (a % dist) * llen + i;
      const x = int(cx + (cl - i) * c) % W;
      const y = int(cy + (cl - i) * s) % H;
      nx[at] = x;
      ny[at] = y;
      const next = ((a + 1) % dist) * llen + i;
      const dx = nx[next]! - x;
      const dy = ny[next]! - y;
      table[Math.abs(x + y * W) % bsize] = Math.abs(x + dx + (y + dy) * W) % bsize;
      a += 1;
    }
    // The program ran apart from Cthugha-L: a few frames pass before its first line.
    if (k % 12500 === 12499) yield null;
  }
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      if (j === 0) {
        const dx = int((cx - i) * 0.75);
        const dy = int(cy - j);
        table[i + j * W] = Math.abs(i + dx + (j + dy) * W) % bsize;
      } else if (i === 0) {
        const dx = int(cx - i);
        const dy = int((cy - j) * 0.75);
        table[i + j * W] = Math.abs(i + dx + (j + dy) * W) % bsize;
      }
    }
  }
  for (let j = 0; j < H; j += 1) yield table.slice(j * W, (j + 1) * W);
}

/** The tables of Cthugha-L's tab/*.cmd, by file name, and "none". */
export const TRANSLATIONS: readonly TranslateEntry[] = [
  { name: "none", desc: "No Translate", program: null },
  { name: "bighalfwheel", desc: "Krusty Wheel 1", program: (W, H) => wheel(W, H, true) },
  { name: "downspiral", desc: "Krusty Wheel 2", program: (W, H) => wheel(W, H, false) },
  { name: "gentable", desc: "", program: (W, H, r) => gentable(W, H, r, { spirals: 10, yinyang: false, yywidth: 10, deltaR: 2.0, deltaA: 0.1 }) },
  { name: "hurricane", desc: "Hurricane/Jupiters Eye", program: (W, H, r) => hurricane(W, H, r) },
  { name: "randswirls", desc: "", program: (W, H, r) => randswirls(W, H, r) },
  { name: "rotate", desc: "", program: (W, H, r) => gentable(W, H, r, { spirals: 0, yinyang: false, yywidth: 10, deltaR: 0, deltaA: 0.1 }) },
  { name: "smoke", desc: "", program: (W, H, r) => smoke(W, H, r) },
  { name: "space-fast", desc: "Fast space flight", program: (W, H, r) => space(W, H, r, 100, 70) },
  { name: "space-slow", desc: "Slow space flight", program: (W, H, r) => space(W, H, r, 30, 10) },
  { name: "yin-yang", desc: "", program: (W, H, r) => gentable(W, H, r, { spirals: 0, yinyang: true, yywidth: 60, deltaR: 0.0, deltaA: -0.025 }) }
];

/**
 * TranslateOption with load on demand and load late: the chosen table's program runs, its lines
 * come in ten a frame into a common table, and once complete the table is kept.
 */
export class Translator {
  private readonly tables: (Int32Array | null)[];
  private readonly common: Int32Array;
  private current = -1;
  private running: Program | null = null;
  private line = -1;

  constructor(private readonly W: number, private readonly H: number, private readonly random: CRandom) {
    this.tables = TRANSLATIONS.map(() => null);
    this.common = new Int32Array(W * H);
  }

  /** The table the flames read for entry `value`: complete, loading (the common table), or none. */
  table(value: number): Int32Array | null {
    if (value === this.current && this.running) return this.common;
    return this.tables[value] ?? null;
  }

  /** TranslateOption::operator(): go on loading; the translation itself is translate(). */
  update(value: number): void {
    const entry = TRANSLATIONS[value];
    if (!entry) return;
    if (value !== this.current) {
      this.current = value;
      this.running = null;
      if (entry.program && !this.tables[value]) {
        // Cthugha-L kept the common table as the last program left it, so two tables could bleed
        // into each other for a moment; here a new table starts from no translation.
        for (let i = 0; i < this.common.length; i += 1) this.common[i] = i;
        this.running = entry.program(this.W, this.H, new CRandom(this.random.rand() ^ 0x5bd1e995));
        this.line = 0;
      }
    } else if (this.running) {
      if (this.line < this.H) {
        for (let l = 0; l < 10 && this.line < this.H; l += 1) {
          const next = this.running.next();
          if (next.done) {
            this.line = this.H;
            break;
          }
          if (!next.value) break;
          this.common.set(next.value.subarray(0, this.W), this.line * this.W);
          this.line += 1;
        }
      } else {
        this.tables[value] = this.common.slice();
        this.running = null;
      }
    }
  }
}
