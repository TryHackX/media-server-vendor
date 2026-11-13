/**
 * Cthugha98 0.6a's waves (wavearray at 0x4794E0), translated from the executable
 * (Cthugha98.exe, the 2D build) by static analysis: how the sound is drawn into the buffer
 * before the next flame burns it. Cthugha98 (c) 1998 Kevin "Zaph" Burfitt, Torps Productions;
 * Pete's, Aaron's, Russ's and the other waves as Cthugha 5.3 and Cthugha-L credited them.
 * Postcardware, non-commercial use only, with credit. Never committed.
 *
 * Every wave took one argument, (mode == 3), which is always 0 in 0.6a; only its 0 paths are
 * here. The C functions' static variables are fields of C98Waves with the values the
 * executable's data gave them. Each call reads the buffer, W and H from the host, as the code
 * read the globals. host.stereo[2i] is L[i], [2i + 1] R[i], unsigned (128 is silence).
 *
 * Colours are the low byte of table[curtable][v], read flat as the code read it, so an index
 * past 255 is the next table. Two waves index outside the whole table[10][256]: Dot VS (24)
 * with sine[v] (negative: before table 0 lay the palette-fade copy and a few flags) and Rings
 * of Fire with sample + 128 (up to 383: after table 9 lay settings). Those read 0 here.
 * No wave writes outside W × H.
 *
 * The floating point of Spirograph and Space warp (sqrt of integers, sine / 128 and / 256 / 128
 * times small integers) is exact in doubles, whatever the x87 precision; _ftol (0x413F00)
 * truncates. Zippy 1 and 2 step one sample at a time where 5.3 stepped two, so their x never
 * moves (each x step is a sample minus itself): a vertical line, as in the executable.
 */

import type { C98Host } from "./host";

/** _ftol (0x413F00): fistp with chop, the low 32 bits of the 64-bit integer. */
function ftol(x: number): number {
  return Math.abs(x) < 9223372036854775808 ? Math.trunc(x) | 0 : 0;
}

/** C's int `/` (cdq; idiv): truncates toward zero. */
function idiv(a: number, b: number): number {
  return (a / b) | 0;
}

/** Fire works' sparks (0x4BACD8, 15 records of 0x110 bytes). */
interface Spark {
  xv: number;
  yv: number;
  xp: number;
  yp: number;
  dur: number;
  col: number;
  oxp: number;
  oyp: number;
}

/** Space warp's rings (0x4BBCD8, 15 records of 0x1C bytes). */
interface WarpRing {
  r: number;
  s: number;
  theta: number;
  omg: number;
  trails: number;
  col: number;
  rgrav: number;
}

/** FireFlies', Zippy 1's and Zippy 2's two moving offsets. */
interface Offsets {
  init: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class C98Waves {
  private readonly host: C98Host;

  // Dot HS, Dot HL: frame counters (0x4A95BC, 0x4A95C0).
  private dotHsFrame = 0;
  private dotHlFrame = 0;
  // Walking: the column (0x47980C = 128). Falling: the row (0x4A95C4).
  private walkCol = 128;
  private fallRow = 0;
  // FireFlies (flags 0x4A2288; 0x4A32A8, 0x4A229C, 0x4A32A4, 0x4A228C), Zippy 1 (flags 0x4A3CB8;
  // 0x4A32B4, 0x4A32AC, 0x4A3CC0, 0x4A32B0), Zippy 2 (flags 0x4A22A0; 0x4A2294, 0x4A2298,
  // 0x4A2290, 0x4A3CBC): set to the middle at the first call.
  private readonly flies: Offsets = { init: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly zippy1: Offsets = { init: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly zippy2: Offsets = { init: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  // Rings of Fire: first (0x479A1C = 1), its width (0x4BBE8C), the centres (0x479A20, 0x479A24,
  // 0x479A28, 0x479A2C = -1), the angles (0x479A18 = 40, 0x4BBE88).
  private ringsFirst = true;
  private ringsW = 0;
  private cxl = -1;
  private cxr = -1;
  private cyl = -1;
  private cyr = -1;
  private ringAx = 40;
  private ringAy = 0;
  // Spirograph: colour (0x4BBE98), offset (0x4BBE90), loops left (0x4BBE9C), loops (0x4BBE7C),
  // last amplitude (0x4BBE94).
  private spiralCol = 0;
  private spiralOfs = 0;
  private spiralLoopCount = 0;
  private spiralLoops = 0;
  private spiralLastA = 0;
  // Fire works: first (0x479FD0 = 1), the sparks, maxV (0x4BBCD4), maxA (0x4BBCC8), last
  // amplitude (0x4BBEA0), the rise so far (0x4BBEA4).
  private pyroFirst = true;
  private readonly sparks: Spark[] = Array.from({ length: 15 }, () => ({ xv: 0, yv: 0, xp: 0, yp: 0, dur: 0, col: 0, oxp: 0, oyp: 0 }));
  private pyroMaxV = 0;
  private pyroMaxA = 0;
  private pyroLastA = 0;
  private pyroRise = 0;
  // Space warp: first (0x479FD4 = 1), its width (0x4BBEB0), the rings, the centre (0x4BBCCC,
  // 0x4BBCD0), maxRad (0x4BBE84), maxA (0x4BBE80), last amplitude (0x4BBEA8), the rise
  // (0x4BBEAC).
  private warpFirst = true;
  private warpW = 0;
  private readonly rings: WarpRing[] = Array.from({ length: 15 }, () => ({ r: 0, s: 0, theta: 0, omg: 0, trails: 0, col: 0, rgrav: 0 }));
  private warpCx = 0;
  private warpCy = 0;
  private warpMaxRad = 0;
  private warpMaxA = 0;
  private warpLastA = 0;
  private warpRise = 0;

  constructor(host: C98Host) {
    this.host = host;
  }

  /** wavearray[] in order: name, when (255: chosen at random; 0: never at random), draw(). */
  readonly list: readonly { name: string; when: number; draw(): void }[] = [
    { name: "Dot HS", when: 255, draw: () => this.dotHS() },
    { name: "Dot HL", when: 255, draw: () => this.dotHL() },
    { name: "Line VW", when: 255, draw: () => this.lineVW() },
    { name: "Spike S", when: 255, draw: () => this.spikeS() },
    { name: "Spike L", when: 255, draw: () => this.spikeL() },
    { name: "Line HS", when: 255, draw: () => this.lineHS() },
    { name: "Line HL", when: 255, draw: () => this.lineHL() },
    { name: "Dot VL", when: 255, draw: () => this.dotVL() },
    { name: "Spike", when: 255, draw: () => this.spike() },
    { name: "Walking", when: 255, draw: () => this.walking() },
    { name: "Falling", when: 255, draw: () => this.falling() },
    { name: "Lissa", when: 255, draw: () => this.lissa() },
    { name: "Line VS", when: 255, draw: () => this.lineV(2) },
    { name: "Line VL", when: 255, draw: () => this.lineV(1) },
    { name: "Line X", when: 255, draw: () => this.lineX() },
    { name: "Lightning1", when: 255, draw: () => this.lightning(16, true) },
    { name: "Lightning2", when: 255, draw: () => this.lightning(32, false) },
    { name: "Dot VS", when: 255, draw: () => this.dotVS() },
    { name: "FireFlies", when: 255, draw: () => this.fireflies() },
    { name: "Rings of Fire", when: 255, draw: () => this.ringsOfFire() },
    { name: "Spirograph", when: 255, draw: () => this.spirograph() },
    { name: "Fire works", when: 255, draw: () => this.fireworks() },
    { name: "Space warp", when: 255, draw: () => this.spaceWarp() },
    { name: "Pete", when: 0, draw: () => this.pete(false) },
    { name: "Dot VS", when: 0, draw: () => this.dotVSsine() },
    { name: "Zippy 1", when: 0, draw: () => this.zippy(this.zippy1, true) },
    { name: "Zippy 2", when: 0, draw: () => this.zippy(this.zippy2, false) },
    { name: "Zaph Test", when: 0, draw: () => this.pete(true) }
  ];

  // --- helpers -------------------------------------------------------------------------------

  /** The low byte of table[curtable][v], flat; outside table[10][256], 0. */
  private tc(v: number): number {
    const at = this.host.curtable * 256 + v;
    return at >= 0 && at < 2560 ? this.host.table[at]! & 255 : 0;
  }

  /** 0x40D6AC: a column from ystart to yend at x, clamped to the buffer. */
  private vwave(ystart: number, yend: number, x: number, val: number): void {
    const { b, W, H } = this.host;
    ystart = Math.min(Math.max(ystart, 0), H - 1);
    yend = Math.min(Math.max(yend, 0), H - 1);
    x = Math.min(Math.max(x, 0), W - 1);
    const ys = ystart > yend ? yend : ystart;
    const ye = ystart > yend ? ystart : yend;
    let pos = ys * W + x;
    for (let y = ys; y <= ye; y += 1) {
      b[pos] = val;
      pos += W;
    }
  }

  /** 0x40DC62: a row from xstart to xend at y, clamped to the buffer (a memset). */
  private hwave(xstart: number, xend: number, y: number, val: number): void {
    const { b, W, H } = this.host;
    xstart = Math.min(Math.max(xstart, 0), W - 1);
    xend = Math.min(Math.max(xend, 0), W - 1);
    y = Math.min(Math.max(y, 0), H - 1);
    const xs = xstart > xend ? xend : xstart;
    const xe = xstart > xend ? xstart : xend;
    b.fill(val & 255, y * W + xs, y * W + xe + 1);
  }

  /**
   * 0x41252A: a line from (x1, y1) up to, not including, (x2, y2). Nothing when both ends are
   * off the same side; drawn from the end that is on the buffer, and it stops at the first
   * point off it.
   */
  private line(x1: number, y1: number, x2: number, y2: number, c: number): void {
    const { b, W, H } = this.host;
    if (x1 < 0 && x2 < 0) return;
    if (x1 >= W && x2 >= W) return;
    if (y1 < 0 && y2 < 0) return;
    if (y1 >= H && y2 >= H) return;
    if (x1 < 0 || x1 >= W || y1 < 0 || y1 >= H) {
      let t = x1;
      x1 = x2;
      x2 = t;
      t = y1;
      y1 = y2;
      y2 = t;
    }
    const lx = Math.abs(x1 - x2);
    const ly = Math.abs(y1 - y2);
    const dx = x1 <= x2 ? 1 : -1;
    const dy = y1 <= y2 ? 1 : -1;
    const val = c & 255;
    if (lx > ly) {
      for (let i = x1, j = y1, k = 0; i !== x2; i += dx, k += ly) {
        if (k >= lx) {
          k -= lx;
          j += dy;
        }
        if (i < 0 || i >= W || j < 0 || j >= H) return;
        b[j * W + i] = val;
      }
    } else {
      for (let i = y1, j = x1, k = 0; i !== y2; i += dy, k += lx) {
        if (k >= ly) {
          k -= ly;
          j += dx;
        }
        if (j < 0 || j >= W || i < 0 || i >= H) return;
        b[i * W + j] = val;
      }
    }
  }

  /** 0x4112D0: sine[i mod 320] / 128. */
  private isin(i: number): number {
    while (i < 0) i += 320;
    return this.host.sine[i % 320]! / 128;
  }

  /** ftol(sqrt(Σ (s − 128)² / 1024)) of each channel over samples 1023 … 1 (Spirograph, Fire works, Space warp). */
  private loudness(): [number, number] {
    const s = this.host.stereo;
    let left = 0;
    let right = 0;
    for (let i = 1023; i !== 0; i -= 1) {
      const l = s[2 * i]! - 128;
      const r = s[2 * i + 1]! - 128;
      left += l * l;
      right += r * r;
    }
    return [ftol(Math.sqrt(left >> 10)), ftol(Math.sqrt(right >> 10))];
  }

  // --- the waves -----------------------------------------------------------------------------

  /** Dot HS (0x40CCC0): dots of each channel along the bottom, and their mean shifted by a step every 15 frames. */
  private dotHS(): void {
    const { b, W, H, stereo } = this.host;
    this.dotHsFrame = (this.dotHsFrame + 1) | 0;
    const off = idiv(this.dotHsFrame, 15) % 3;
    for (let i = 0; i < 1024; i += 1) {
      const x = (i * W) >> 10;
      let v = stereo[2 * i]!;
      let y = H - (v >> 2) - 20;
      if (y < 0) y += H;
      b[y * W + (x >> 1)] = this.tc(v);
      v = stereo[2 * i + 1]!;
      y = H - (v >> 2) - 20;
      if (y < 0) y += H;
      b[y * W + ((x + W) >> 1)] = this.tc(v);
      v = (stereo[2 * i + 1]! + stereo[2 * i]!) >> 1;
      y = H - (v >> 2) - 20;
      if (y < 0) y += H;
      b[y * W + ((x + (W >> 1)) >> 1) + off + 2] = this.tc(v);
    }
  }

  /** Dot HL (0x40CEFF): Dot HS twice as tall, the mean one point left. */
  private dotHL(): void {
    const { b, W, H, stereo } = this.host;
    this.dotHlFrame = (this.dotHlFrame + 1) | 0;
    const off = idiv(this.dotHlFrame, 15) % 3;
    for (let i = 0; i < 1024; i += 1) {
      const x = (i * W) >> 10;
      let v = stereo[2 * i]!;
      let y = H - (v >> 1) - 20;
      if (y < 0) y += H;
      b[y * W + (x >> 1)] = this.tc(v);
      v = stereo[2 * i + 1]!;
      y = H - (v >> 1) - 20;
      if (y < 0) y += H;
      b[y * W + ((x + W) >> 1)] = this.tc(v);
      v = (stereo[2 * i + 1]! + stereo[2 * i]!) >> 1;
      y = H - (v >> 1) - 20;
      if (y < 0) y += H;
      b[y * W + ((x + (W >> 1)) >> 1) + off - 1] = this.tc(v);
    }
  }

  /** Line VW (0x40D13B): dots down the middle, the left channel to the left, the right to the right. */
  private lineVW(): void {
    const { b, W, H, stereo } = this.host;
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let v = stereo[2 * i]!;
      b[y * W + (W >> 1) - (v >> 2)] = this.tc(v);
      v = stereo[2 * i + 1]!;
      b[(v >> 2) + y * W + (W >> 1)] = this.tc(v);
    }
  }

  /** Spike S (0x40D25B): spikes up from the bottom, half the level, each in its level's colour. */
  private spikeS(): void {
    const { b, W, H, stereo } = this.host;
    for (let i = 0; i < 1024; i += 1) {
      const x = (i * W) >> 10;
      let v = Math.abs(128 - stereo[2 * i]!) >> 1;
      let px = x >> 1;
      for (let j = 1; j < v; j += 1) {
        let y = H - j;
        if (y < 0) y += H;
        b[y * W + px] = this.tc(v);
      }
      v = Math.abs(128 - stereo[2 * i + 1]!) >> 1;
      px = (x + W) >> 1;
      for (let j = 1; j < v; j += 1) {
        let y = H - j;
        if (y < 0) y += H;
        b[y * W + px] = this.tc(v);
      }
    }
  }

  /** Spike L (0x40D3F3): spikes up from the bottom as tall as the level, left half then right half. */
  private spikeL(): void {
    const { b, W, H, stereo } = this.host;
    for (let c = 0; c < 2; c += 1) {
      for (let i = 0; i < 1024; i += 1) {
        const x = (i * W) >> 10;
        const v = Math.abs(128 - stereo[2 * i + c]!);
        const px = c ? (x + W) >> 1 : x >> 1;
        for (let j = 1; j < v; j += 1) {
          let y = H - j;
          if (y < 0) y += H;
          b[y * W + px] = this.tc(v);
        }
      }
    }
  }

  /** Line HS (0x40D5C6): the waveform as a joined line near the bottom, left half then right half. */
  private lineHS(): void {
    const { W, H, stereo } = this.host;
    let last = 128;
    for (let c = 0; c < 2; c += 1) {
      for (let i = 0; i < 1024; i += 1) {
        const x = (i * W) >> 10;
        const v = stereo[2 * i + c]!;
        this.vwave(H - (v >> 2), H - (last >> 2), c ? (x + W) >> 1 : x >> 1, this.tc(v));
        last = v;
      }
    }
  }

  /**
   * Line HL (0x40D7F6): Line HS twice as tall. `last` starts at 128 but is then kept halved, so
   * the first segment reaches up to H − 128.
   */
  private lineHL(): void {
    const { W, H, stereo } = this.host;
    let last = 128;
    for (let c = 0; c < 2; c += 1) {
      for (let i = 0; i < 1024; i += 1) {
        const x = (i * W) >> 10;
        const v = stereo[2 * i + c]!;
        this.vwave(H - (v >> 1), H - last, c ? (x + W) >> 1 : x >> 1, this.tc(v));
        last = v >> 1;
      }
    }
  }

  /** Dot VL (0x40D91F): dots down the middle at half the level — both channels to the left of it. */
  private dotVL(): void {
    const { b, W, H, stereo } = this.host;
    const half = W >> 1;
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let v = stereo[2 * i]!;
      b[y * W + half - ((v >> 1) % half)] = this.tc(v);
      v = stereo[2 * i + 1]!;
      b[y * W + half - ((v >> 1) % half)] = this.tc(v);
    }
  }

  /** Spike (0x40DA65): hollow spikes, the outline of |level| up from the bottom. */
  private spike(): void {
    const { W, H, stereo } = this.host;
    let last = 0;
    for (let c = 0; c < 2; c += 1) {
      for (let i = 0; i < 1024; i += 1) {
        const x = (i * W) >> 10;
        const v = Math.abs(128 - stereo[2 * i + c]!);
        this.vwave(H - v, H - last, c ? (x + W) >> 1 : x >> 1, this.tc(v));
        last = v;
      }
    }
  }

  /** Walking (0x40DB50): the two channels as joined lines either side of a column that walks right. */
  private walking(): void {
    const { W, H, stereo } = this.host;
    let last1 = 128;
    let last2 = 128;
    this.walkCol = (this.walkCol + 1) % W;
    const col = this.walkCol;
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let v = stereo[2 * i]!;
      this.hwave(col - (v >> 2), col - (last1 >> 2), y, this.tc(v));
      last1 = v;
      v = stereo[2 * i + 1]!;
      this.hwave((v >> 2) + col, col + (last2 >> 2), y, this.tc(v));
      last2 = v;
    }
  }

  /** Falling (0x40DDEC): two rows of colours (|level|) a frame, moving down the screen. */
  private falling(): void {
    const { b, W, H, stereo } = this.host;
    this.fallRow = (this.fallRow + 1) % (H - 2);
    const row = this.fallRow;
    const half = W >> 1;
    for (let i = 0; i < half; i += 1) {
      b[(row + 1) * W + i] = this.tc(Math.abs(128 - stereo[2 * i]!));
      b[row * W + i] = this.tc(Math.abs(128 - stereo[2 * (i + half)]!));
      b[(row + 1) * W + i + half] = this.tc(Math.abs(128 - stereo[2 * i + 1]!));
      b[row * W + i + half] = this.tc(Math.abs(128 - stereo[2 * (i + half) + 1]!));
    }
  }

  /** Lissa (0x40DFC7): left against right, a Lissajous figure of dots. */
  private lissa(): void {
    const { b, W, H, stereo } = this.host;
    const ox = (W >> 1) - (W >> 2);
    const oy = (H >> 1) - (H >> 2);
    for (let i = 0; i < 1024; i += 1) {
      const l = stereo[2 * i]!;
      const r = stereo[2 * i + 1]!;
      b[((l + oy + H) % H) * W + ((r + ox) % W)] = this.tc(l);
    }
  }

  /** Line VS (0x40E0CF, shift 2) and Line VL (0x40E1E9, shift 1): joined lines either side of the middle. */
  private lineV(shift: number): void {
    const { W, H, stereo } = this.host;
    const half = W >> 1;
    let last1 = 128;
    let last2 = 128;
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let v = stereo[2 * i]!;
      this.hwave(half - (v >> shift), half - (last1 >> shift), y, this.tc(v));
      last1 = v;
      v = stereo[2 * i + 1]!;
      this.hwave(half + (v >> shift), half + (last2 >> shift), y, this.tc(v));
      last2 = v;
    }
  }

  /** Line X (0x40E2FF): the left channel left of the middle, the right right of H / 2 (not W / 2). */
  private lineX(): void {
    const { W, H, stereo } = this.host;
    let last = 128;
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      const v = stereo[2 * i]!;
      this.hwave((W >> 1) - (v >> 2), (W >> 1) - (last >> 2), y, this.tc(v));
      last = v;
    }
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      const v = stereo[2 * i + 1]!;
      this.hwave((H >> 1) + (v >> 2), (H >> 1) + (last >> 2), y, this.tc(v));
      last = v;
    }
  }

  /**
   * Lightning1 (0x40E446, ÷16) and Lightning2 (0x40E5E2, ÷32, its second bolt without the
   * `% W`): two white bolts down the screen from W / 3 and 2W / 3, each step the level.
   */
  private lightning(div: number, wrapSecond: boolean): void {
    const { W, H, stereo } = this.host;
    let last = idiv(W, 3);
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let t = idiv(stereo[2 * i]! - 127, div) + last;
      if (t >= W) t = W - 1;
      if (t < 0) last = 0;
      t %= W;
      this.hwave(t, last, y, 255);
      last = t;
    }
    last = idiv(W * 2, 3);
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let t = idiv(stereo[2 * i + 1]! - 127, div) + last;
      if (t >= W) t = W - 1;
      if (t < 0) last = 0;
      if (wrapSecond) t %= W;
      this.hwave(t, last, y, 255);
      last = t;
    }
  }

  /** Dot VS (0x40E771): as Line VW. */
  private dotVS(): void {
    const { b, W, H, stereo } = this.host;
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let v = stereo[2 * i]!;
      b[y * W + (W >> 1) - (v >> 2)] = this.tc(v);
      v = stereo[2 * i + 1]!;
      b[y * W + (W >> 1) + (v >> 2)] = this.tc(v);
    }
  }

  /** FireFlies (0x408F06): two swarms of dots (level against the level 80 samples on) drifting with the sound. */
  private fireflies(): void {
    const { b, W, H, stereo } = this.host;
    const o = this.flies;
    if (!o.init) {
      o.init = true;
      o.x0 = W >> 1;
      o.y0 = H >> 1;
      o.x1 = W >> 1;
      o.y1 = H >> 1;
    }
    o.x0 += (stereo[0]! % 9) - 4;
    o.y0 += (stereo[2]! % 9) - 4;
    o.x1 += (stereo[1]! % 9) - 4;
    o.y1 += (stereo[3]! % 9) - 4;
    if (o.x0 < 0) o.x0 += W;
    if (o.y0 < 0) o.y0 += H;
    if (o.x1 < 0) o.x1 += W;
    if (o.y1 < 0) o.y1 += H;
    o.x0 %= W;
    o.x1 %= W;
    o.y0 %= H;
    o.y1 %= H;
    for (let i = 0; i < 1024; i += 1) {
      const k = (i + 80) & 1023;
      let v = stereo[2 * i]!;
      let u = stereo[2 * k]!;
      b[(((v >> 1) + o.y0) % H) * W + (((u >> 1) + o.x0) % W)] = this.tc(v);
      v = stereo[2 * i + 1]!;
      u = stereo[2 * k + 1]!;
      b[(((v >> 1) + o.y1) % H) * W + (((u >> 1) + o.x1) % W)] = this.tc(v);
    }
  }

  /**
   * Rings of Fire (0x41130C): two rings of dots, radius (sample + 128) × sine / 512, whose
   * centres wander with the sound; the index wraps round the buffer. The + 128 on an unsigned
   * sample is the executable's (Cthugha-L added it to a signed one): radius about 64 at
   * silence, colours 128 … 383.
   */
  private ringsOfFire(): void {
    const { b, W, H, stereo, sine } = this.host;
    let txl = 0;
    let tyl = 0;
    let txr = 0;
    let tyr = 0;
    if (this.ringsFirst || W !== this.ringsW) {
      this.ringsFirst = false;
      this.ringsW = W;
      this.cxl = idiv(W - 256, 2) + 192;
      this.cxr = idiv(W - 256, 2) + 64;
      this.cyl = idiv(H - 256, 2) + 128;
      this.cyr = this.cyl;
    }
    if (H <= 128 || W <= 256) return;
    const size = H * W;
    for (let i = 0; i < 1024; i += 1) {
      if (this.ringAy >= 320) this.ringAy -= 320;
      if (this.ringAx >= 320) this.ringAx -= 320;
      let tmp = stereo[2 * i]! + 128;
      let sx = (sine[this.ringAx]! * tmp) >> 9;
      txl += sx;
      let sy = (sine[this.ringAy]! * tmp) >> 9;
      tyl += sy;
      let at = this.cxl + sx + (this.cyl + sy) * W;
      while (at < 0) at += size;
      while (at >= size) at -= size;
      b[at] = this.tc(tmp);
      tmp = stereo[2 * i + 1]! + 128;
      sx = (sine[this.ringAx]! * tmp) >> 9;
      txr += sx;
      sy = (sine[this.ringAy]! * tmp) >> 9;
      tyr += sy;
      at = this.cxr - sx + (this.cyr - sy) * W;
      while (at < 0) at += size;
      while (at >= size) at -= size;
      b[at] = this.tc(tmp);
      this.ringAx += 1;
      this.ringAy += 1;
    }
    this.cxl -= idiv(txl * 6, W) + 2;
    this.cyl -= idiv(tyl * 6, W) + 2;
    this.cxr += idiv(txr * 6, W) + 2;
    this.cyr += idiv(tyr * 6, W) + 2;
    this.cxl %= W;
    this.cxr %= W;
    this.cyl %= H;
    this.cyr %= H;
  }

  /**
   * Spirograph (0x4116B8): a closed curve of 319 lines, a circle of the loudness plus loops of
   * each channel's loudness, turning a step a frame; the loops change every 0–999 frames.
   */
  private spirograph(): void {
    const { W, H, sine } = this.host;
    this.spiralCol = (this.spiralCol + 1) % 256;
    this.spiralOfs = (this.spiralOfs + 1) % 320;
    if (this.spiralLoopCount <= 0) {
      this.spiralLoopCount = Math.abs(this.host.rand() % 1000);
      this.spiralLoops = Math.abs(this.host.rand() % 8) + 2;
    }
    this.spiralLoopCount -= 1;
    const mx = W < H ? W : H;
    const cx = W >> 1;
    const cy = H >> 1;
    const [la, ra] = this.loudness();
    let a = (la + ra) >> 1;
    if (a < this.spiralLastA - 10) a = this.spiralLastA - 10;
    this.spiralLastA = a;
    const ampl = (a * mx) / 256 / 128;
    const lampl = (la * mx) / 256 / 128;
    const rampl = (ra * mx) / 256 / 128;
    const ofs = this.spiralOfs;
    const loops = this.spiralLoops;
    let ox = sine[(ofs + 120) % 320]! * ampl + (sine[120]! * lampl) / 2;
    let oy = sine[ofs]! * ampl + (sine[0]! * rampl) / 2;
    const colour = this.tc(this.spiralCol);
    for (let i = 1; i < 320; i += 1) {
      const x = sine[(i + ofs + 120) % 320]! * ampl + (sine[(i * loops + 120) % 320]! * lampl) / 2;
      const y = sine[(i + ofs) % 320]! * ampl + (sine[(i * loops) % 320]! * rampl) / 2;
      this.line(ftol(cx + ox), ftol(cy + oy), ftol(cx + x), ftol(cy + y), colour);
      ox = x;
      oy = y;
    }
  }

  /**
   * Fire works (0x411A55): sparks shot up from the bottom when the loudness falls after a rise,
   * as high as the rise, falling back as double lines.
   */
  private fireworks(): void {
    const { W, H } = this.host;
    if (this.pyroFirst) {
      this.pyroFirst = false;
      for (const spark of this.sparks) spark.dur = -1;
      let f = 0;
      this.pyroMaxV = 0;
      while (f < H) {
        this.pyroMaxV += 1;
        f += this.pyroMaxV;
      }
      this.pyroMaxV -= 1;
      this.pyroMaxA = 30;
    }
    const [l, r] = this.loudness();
    let a = (l + r) >> 1;
    if (a < this.pyroLastA - 9) a = this.pyroLastA - 9;
    if (a > this.pyroLastA) this.pyroRise += a - this.pyroLastA;
    let fire = 0;
    if (a < this.pyroLastA) {
      fire = this.pyroRise;
      this.pyroRise = 0;
    }
    this.pyroLastA = a;
    for (const spark of this.sparks) {
      if (spark.dur !== -1) {
        const x1 = spark.xp + spark.xv;
        const y1 = spark.yp + spark.yv;
        this.line(spark.oxp, spark.oyp, x1, y1, this.tc(spark.col));
        this.line(spark.oxp + 1, spark.oyp, x1 + 1, y1, this.tc(spark.col));
        if (x1 < 0 || x1 > W) spark.xv = -spark.xv;
        spark.yv += 1;
        spark.dur += 1;
        spark.oxp = spark.xp;
        spark.oyp = spark.yp;
        spark.xp = x1;
        spark.yp = y1;
        if (spark.yv > 5 || spark.yp < 0) spark.dur = -1;
      } else if (fire !== 0) {
        if (fire * 4 > this.pyroMaxA) this.pyroMaxA = fire * 4;
        if (this.pyroMaxA > 30) this.pyroMaxA -= 1;
        spark.dur = 0;
        spark.xp = this.host.rand() % W;
        spark.oxp = spark.xp;
        spark.yp = H - 4;
        spark.oyp = spark.yp;
        spark.xv = (this.host.rand() % 20) - 10;
        spark.yv = -idiv(fire * this.pyroMaxV, idiv(this.pyroMaxA, 4));
        spark.col = this.host.rand() % 256;
        fire = idiv(fire * 2, 3);
      }
    }
  }

  /**
   * Space warp (0x411FAC): rings of 1–21 lines flying out of the middle, turning, launched when
   * the loudness falls after a rise.
   */
  private spaceWarp(): void {
    const { W, H } = this.host;
    if (this.warpFirst || W !== this.warpW) {
      this.warpFirst = false;
      this.warpW = W;
      for (const ring of this.rings) ring.r = -1;
      this.warpCx = W >> 1;
      this.warpCy = H >> 1;
      this.warpMaxRad = this.warpCx > this.warpCy ? this.warpCx : this.warpCy;
    }
    const [l, r] = this.loudness();
    let a = (l + r) >> 1;
    if (a < this.warpLastA - 9) a = this.warpLastA - 9;
    if (a > this.warpLastA) this.warpRise += a - this.warpLastA;
    let fire = 0;
    if (a < this.warpLastA) {
      fire = this.warpRise;
      this.warpRise = 0;
    }
    this.warpLastA = a;
    const cx = this.warpCx;
    const cy = this.warpCy;
    for (const ring of this.rings) {
      if (ring.r !== -1) {
        const r2 = ring.r + ring.s;
        const t2 = ring.theta + ring.omg;
        const tr = ring.trails;
        for (let j = 0; j < tr; j += 1) {
          const step = idiv(j * 320, tr);
          const x1 = ftol(this.isin(step + ring.theta) * ring.r + cx);
          const y1 = ftol(this.isin(step + ring.theta + 120) * ring.r + cy);
          const x2 = ftol(this.isin(step + t2) * r2 + cx);
          const y2 = ftol(this.isin(step + t2 + 120) * r2 + cy);
          this.line(x1, y1, x2, y2, this.tc(ring.col));
        }
        ring.r += ring.s;
        ring.theta += ring.omg;
        ring.s -= ring.rgrav;
        if (ring.r > this.warpMaxRad || ring.r < 0) ring.r = -1;
      } else if (fire !== 0) {
        if (fire * 4 > this.warpMaxA) this.warpMaxA = fire * 4;
        if (this.warpMaxA > 30) this.warpMaxA -= 1;
        ring.r = 0;
        ring.s = idiv(fire * 4 * 20, this.warpMaxA) + 3;
        ring.trails = idiv(fire * 4 * 20, this.warpMaxA) + 1;
        ring.theta = this.host.rand() % 320;
        ring.omg = idiv(((this.host.rand() % 16) - 8) * fire * 4, this.warpMaxA);
        ring.col = this.host.rand() % 256;
        ring.rgrav = this.host.rand() % 2;
        fire = 0;
      }
    }
  }

  /**
   * Pete (0x40925F; level ÷ W/2) and Zaph Test (0x409FAC; level ÷ 128): each channel's samples
   * along a sine hump as tall as its level, up from the bottom, left half and right half.
   */
  private pete(zaph: boolean): void {
    const { b, W, H, stereo, sine } = this.host;
    let left = 0;
    let right = 0;
    for (let i = 0; i < W; i += 1) {
      left += Math.abs(stereo[2 * i]! - 128);
      right += Math.abs(stereo[2 * i + 1]! - 128);
    }
    if (zaph) {
      left >>= 7;
      right >>= 7;
    } else {
      left = idiv(left, W >> 1);
      right = idiv(right, W >> 1);
    }
    if (left >= H - 1) left = H - 1;
    if (right >= H - 1) right = H - 1;
    for (let i = 0; i < 1024; i += 1) {
      const x = ((i * W) >> 1) >> 10;
      b[(H - (Math.abs(left * sine[x]!) >> 8) - 1) * W + x] = this.tc(stereo[2 * i]!);
    }
    for (let i = 0; i < 1024; i += 1) {
      const x = (((i * W) >> 1) >> 10) + (W >> 1);
      b[(H - (Math.abs(right * sine[x]!) >> 8) - 1) * W + x] = this.tc(stereo[2 * i + 1]!);
    }
  }

  /** Dot VS (0x4094D6): as Line VW, coloured table[curtable][sine[level]] (a negative index for half the levels). */
  private dotVSsine(): void {
    const { b, W, H, stereo, sine } = this.host;
    for (let i = 0; i < 1024; i += 1) {
      const y = (i * H) >> 10;
      let v = stereo[2 * i]!;
      b[y * W + (W >> 1) - (v >> 2)] = this.tc(sine[v]!);
      v = stereo[2 * i + 1]!;
      b[y * W + (W >> 1) + (v >> 2)] = this.tc(sine[v]!);
    }
  }

  /**
   * Zippy 1 (0x4095C8; the steps halved) and Zippy 2 (0x409976): two points walked by the
   * differences of successive samples, x by one, y by the next, a dot at each step; the right
   * channel's y walks the other way.
   */
  private zippy(o: Offsets, halve: boolean): void {
    const { b, W, H, stereo } = this.host;
    const step = (d: number): number => (halve ? idiv(d, 2) : d);
    if (!o.init) {
      o.init = true;
      o.x0 = W >> 1;
      o.y0 = H >> 1;
      o.x1 = W >> 1;
      o.y1 = H >> 1;
    }
    let temp = stereo[0]!;
    o.y0 %= H;
    o.y1 %= H;
    for (let i = 0; i < 1023; i += 1) {
      o.x0 += step(stereo[2 * i]! - temp);
      temp = stereo[2 * i]!;
      if (o.x0 < 0) o.x0 = W - 1;
      o.x0 %= W;
      b[o.y0 * W + o.x0] = this.tc(temp);
      o.y0 += step(stereo[2 * i + 2]! - temp);
      temp = stereo[2 * i + 2]!;
      if (o.y0 < 0) o.y0 = H - 1;
      o.y0 %= H;
      b[o.y0 * W + o.x0] = this.tc(temp);
    }
    temp = stereo[1]!;
    for (let i = 0; i < 1023; i += 1) {
      o.x1 += step(stereo[2 * i + 1]! - temp);
      temp = stereo[2 * i + 1]!;
      if (o.x1 < 0) o.x1 = W - 1;
      o.x1 %= W;
      b[o.y1 * W + o.x1] = this.tc(temp);
      o.y1 -= step(stereo[2 * i + 3]! - temp);
      temp = stereo[2 * i + 3]!;
      if (o.y1 < 0) o.y1 = H - 1;
      o.y1 %= H;
      b[o.y1 * W + o.x1] = this.tc(temp);
    }
  }
}
