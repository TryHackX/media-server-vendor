/**
 * Cthugha-L 1.4's displays (src/display.cc, src/CthughaDisplay.cc): how the buffer reaches the
 * screen. Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald
 * Deischinger. Non-commercial use only, with credit (COPYING-cthugha-L.txt).
 *
 * The screen is twice the buffer each way. The flat displays draw the buffer — upright, turned,
 * split or as a kaleidoscope — into its top left quarter, which is then mirrored into the other
 * three: Cthugha's fourfold symmetry. The 3-D displays (heightfield, bending plane, rotating
 * plate) draw the buffer as a turning sheet over the whole screen, in the upper half of the
 * palette (value | 128) on black.
 */

import type { Context } from "./context";

export interface ScreenEntry {
  readonly name: string;
  readonly desc: string;
  /** 1: drawn into a quarter and mirrored; 2: drawn over the whole screen. */
  readonly size: 1 | 2;
  readonly inUse: boolean;
}

export const SCREENS: readonly ScreenEntry[] = [
  { name: "Up", desc: "Up Display", size: 1, inUse: true },
  { name: "Down", desc: "Upside Down", size: 1, inUse: true },
  { name: "2hor", desc: "Hor. Split out", size: 1, inUse: true },
  { name: "r2hor", desc: "Hor. Split in", size: 1, inUse: true },
  { name: "4hor", desc: "Kaleidoscope", size: 1, inUse: true },
  { name: "2verd", desc: "90deg rot. mirror", size: 1, inUse: true },
  { name: "r2verd", desc: "90deg rot. mirror II", size: 1, inUse: true },
  { name: "4kal", desc: "90deg Kaleidoscope", size: 1, inUse: true },
  { name: "hfield", desc: "Heightfield", size: 2, inUse: true },
  { name: "roll", desc: "Roll around x-axis", size: 1, inUse: true },
  { name: "zick", desc: "Zick Zack", size: 1, inUse: false },
  { name: "bent", desc: "A bending plane", size: 2, inUse: true },
  { name: "plate", desc: "A rotating plate", size: 2, inUse: true }
];

const SC = 1 << 16;

/** The displays, with what they kept in static variables. */
export class Displays {
  private readonly perm: Int32Array;
  private readonly heightOffsetX = new Int32Array(256);
  private readonly heightOffsetY = new Int32Array(256);
  private readonly rot = [0, 0, 0];
  private s1x = 0; private s1y = 0; private s2x = 0; private s2y = 0;
  private px = 0; private py = 0;
  private readonly height: Int32Array;
  private bentT = 0; private bentH = 0; private bentStp = 0;
  private rollTheta = 0;
  private readonly zicks: Int32Array;
  private zickD = 0;

  constructor(private readonly ctx: Context) {
    this.perm = new Int32Array(ctx.H);
    this.height = new Int32Array(ctx.W + 1);
    this.zicks = new Int32Array(ctx.H + 1);
  }

  /**
   * Draw the buffer shown (the passive one) with display `index`; false when this display does
   * not suit the buffer's shape (the C code then moved on to the next one).
   */
  draw(index: number): boolean {
    switch (index) {
      case 0: return this.up();
      case 1: return this.down();
      case 2: return this.split(true);
      case 3: return this.split(false);
      case 4: return this.kaleidoscope();
      case 5: return this.rotMirror();
      case 6: return this.rotMirror2();
      case 7: return this.kal90();
      case 8: return this.hfield();
      case 9: return this.roll();
      case 10: return this.zick();
      case 11: return this.bent();
      case 12: return this.plate();
      default: return this.up();
    }
  }

  /** Mirror the top left quarter into the rest (mirrorHorizontally, mirrorVertically). */
  mirror(): void {
    const { W, H, screen } = this.ctx;
    const stride = 2 * W;
    for (let y = 0; y < H; y += 1) {
      const row = y * stride;
      for (let x = 0; x < W; x += 1) screen[row + stride - 1 - x] = screen[row + x]!;
    }
    for (let y = 0; y < H; y += 1) screen.copyWithin((2 * H - 1 - y) * stride, y * stride, (y + 1) * stride);
  }

  /** screen_perm(): buffer lines `perm` into the top left quarter. */
  private permLines(): void {
    const { W, H, BASE, passive, screen } = this.ctx;
    const stride = 2 * W;
    for (let i = 0; i < H; i += 1) {
      const from = BASE + this.perm[i]! * W;
      screen.set(passive.subarray(from, from + W), i * stride);
    }
  }

  private up(): boolean {
    for (let i = 0; i < this.ctx.H; i += 1) this.perm[i] = i;
    this.permLines();
    return true;
  }

  private down(): boolean {
    const H = this.ctx.H;
    for (let i = 0; i < H; i += 1) this.perm[i] = H - i - 1;
    this.permLines();
    return true;
  }

  /** screen_2hor (out) and screen_r2hor (in): the lower half of the buffer, twice. */
  private split(out: boolean): boolean {
    const H = this.ctx.H;
    const half = H >> 1;
    for (let i = 0; i < half; i += 1) {
      if (out) {
        this.perm[i] = half + i;
        this.perm[i + half] = H - i - 1;
      } else {
        this.perm[i] = H - i - 1;
        this.perm[i + half] = half + i;
      }
    }
    if (H & 1) this.perm[H - 1] = H - 1;
    this.permLines();
    return true;
  }

  /** screen_4hor: the bottom half of the buffer's left half, mirrored both ways. */
  private kaleidoscope(): boolean {
    const { W, H, BASE, passive, screen } = this.ctx;
    const stride = 2 * W;
    const halfW = W >> 1;
    const halfH = H >> 1;
    let tmp = BASE + ((W * H) >> 1);
    let scrn = 0;
    for (let y = halfH; y !== 0; y -= 1) {
      for (let x = 0; x < halfW; x += 1) screen[scrn + x] = passive[tmp + x]!;
      scrn += halfW;
      tmp += halfW;
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp]!;
        scrn += 1;
        tmp -= 1;
      }
      tmp += W;
      scrn += stride - W;
    }
    tmp = BASE + W * H - W;
    scrn = stride * halfH;
    for (let y = halfH; y !== 0; y -= 1) {
      for (let x = 0; x < halfW; x += 1) screen[scrn + x] = passive[tmp + x]!;
      scrn += halfW;
      tmp += halfW;
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp]!;
        scrn += 1;
        tmp -= 1;
      }
      tmp -= W;
      scrn += stride - W;
    }
    return true;
  }

  /** screen_2verd: the buffer turned by 90 degrees and mirrored. */
  private rotMirror(): boolean {
    const { W, H, BASE, passive, screen } = this.ctx;
    if (!((W >> 1) <= H)) return false;
    const stride = 2 * W;
    const halfW = W >> 1;
    let tmp = BASE;
    let scrn = 0;
    for (let y = H; y !== 0; y -= 1) {
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn += 1;
        tmp += W;
      }
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn += 1;
        tmp -= W;
      }
      tmp += 1;
      scrn += stride - W;
    }
    return true;
  }

  /** screen_r2verd: the same, drawn from the bottom right. */
  private rotMirror2(): boolean {
    const { W, H, BASE, passive, screen } = this.ctx;
    if (!((W >> 1) <= H)) return false;
    const stride = 2 * W;
    const halfW = W >> 1;
    let tmp = BASE;
    let scrn = stride * (H - 1) + (W - 1);
    for (let y = H; y !== 0; y -= 1) {
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn -= 1;
        tmp += W;
      }
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn -= 1;
        tmp -= W;
      }
      tmp += 1;
      scrn -= stride - W;
    }
    return true;
  }

  /** screen_4kal: the turned buffer in the upper half and, turned round, in the lower. */
  private kal90(): boolean {
    const { W, H, BASE, passive, screen } = this.ctx;
    if (!((W >> 1) <= H)) return false;
    const stride = 2 * W;
    const halfW = W >> 1;
    const halfH = H >> 1;
    let tmp = BASE;
    let scrn = 0;
    for (let y = halfH; y !== 0; y -= 1) {
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn += 1;
        tmp += W;
      }
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn += 1;
        tmp -= W;
      }
      tmp += 1;
      scrn += stride - W;
    }
    tmp = BASE;
    scrn = stride * (H - 1) + W - 1;
    for (let y = halfH; y !== 0; y -= 1) {
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn -= 1;
        tmp += W;
      }
      for (let x = halfW; x !== 0; x -= 1) {
        screen[scrn] = passive[tmp] ?? 0;
        scrn -= 1;
        tmp -= W;
      }
      tmp += 1;
      scrn -= stride - W;
    }
    return true;
  }

  /** prepare_3d(): turn the sheet a little and clear the screen. */
  private prepare3d(maxZ: number): void {
    const { W, H } = this.ctx;
    const x = Math.trunc(W / 2) ** 2;
    const y = Math.trunc(H / 2) ** 2;
    const z = ((W / 640) * maxZ) ** 2;
    const l = Math.sqrt(x + y + z);
    const scale = Math.min(W, H) / l;
    const rot = this.rot;
    rot[0] = rot[0]! + 0.006;
    rot[1] = rot[1]! + 0.010;
    rot[2] = rot[2]! + 0.004;
    const points = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [0, 0, 1]] as const;
    const ro = points.map((p) => rotate(p, rot));
    const r3 = ro[3]!;
    for (let i = 0; i < 256; i += 1) {
      this.heightOffsetX[i] = Math.trunc(r3[0] * i * (W / 640) * SC);
      this.heightOffsetY[i] = Math.trunc(r3[1] * i * (W / 640) * SC);
    }
    const r0 = ro[0]!;
    const r1 = ro[1]!;
    const r2 = ro[2]!;
    this.s1x = Math.trunc((r1[0] - r0[0]) * scale * SC / 2);
    this.s1y = Math.trunc((r1[1] - r0[1]) * scale * SC / 2);
    this.s2x = Math.trunc((r2[0] - r1[0]) * scale * SC / 2);
    this.s2y = Math.trunc((r2[1] - r1[1]) * scale * SC / 2);
    this.px = Math.trunc(-W / 2) * this.s1x - Math.trunc(H / 2) * this.s2x;
    this.py = Math.trunc(-W / 2) * this.s1y - Math.trunc(H / 2) * this.s2y;
    this.ctx.screen.fill(0);
  }

  /** Draw the sheet, each pixel lifted by `lift(src, column)` (an index into the height offsets). */
  private sheet(lift: (value: number, column: number) => number): void {
    const { W, H, BASE, passive, screen } = this.ctx;
    const stride = 2 * W;
    const dst = W + stride * H;
    let src = BASE;
    for (let i = H; i !== 0; i -= 1) {
      const tx = this.px;
      const ty = this.py;
      for (let j = W; j !== 0; j -= 1) {
        const value = passive[src]!;
        const h = lift(value, j);
        const at = dst + ((this.py + this.heightOffsetY[h]!) >> 16) * stride + ((this.px + this.heightOffsetX[h]!) >> 16);
        if (at >= 0 && at < screen.length) screen[at] = value | 128;
        src += 1;
        this.px += this.s1x;
        this.py += this.s1y;
      }
      this.px = tx + this.s2x;
      this.py = ty + this.s2y;
    }
  }

  /** hfield: the buffer's value is the height. */
  private hfield(): boolean {
    this.prepare3d(256);
    this.sheet((value) => value);
    return true;
  }

  /** bent: the height is a sine wave along the x axis, swinging with the amplitude. */
  private bent(): boolean {
    const { W } = this.ctx;
    this.prepare3d(256);
    this.bentH = this.bentH * 0.95 + Math.min(2 * this.ctx.analysis.amplitude, 120) * 0.05;
    for (let i = W; i !== 0; i -= 1) {
      this.height[i] = Math.trunc(this.bentH * Math.sin(this.bentT) * Math.sin((i / W) * 3 * Math.PI)) + 128;
    }
    this.bentStp = this.bentStp * 0.95 + Math.max(this.ctx.fps * 2, 1) * 0.05;
    this.bentT += 4 / this.bentStp;
    const height = this.height;
    this.sheet((_value, column) => height[column]! & 255);
    return true;
  }

  /** plate: height constant to 0. */
  private plate(): boolean {
    this.prepare3d(1);
    this.sheet(() => 0);
    return true;
  }

  /**
   * Map the buffer on a cylinder (around the x axis), and roll it. The buffer is mapped two
   * times on the cylinder, so that no discontinuities arise.
   */
  private roll(): boolean {
    const H = this.ctx.H;
    const half = Math.trunc(H / 2);
    for (let i = 0; i < H; i += 1) {
      const p = i - half;
      const phi = Math.acos(Math.max(-1, Math.min(1, p / half)));
      let b = Math.trunc(((this.rollTheta + phi) / Math.PI) * H);
      b %= 2 * H;
      if (b < 0) b += 2 * H;
      if (b >= H) b = 2 * H - b - 1;
      this.perm[i] = b;
    }
    this.rollTheta += Math.PI / 40;
    if (this.rollTheta > 2 * Math.PI) this.rollTheta -= 2 * Math.PI;
    this.permLines();
    return true;
  }

  /** "this is not looking good" — not in use, as in Cthugha-L. */
  private zick(): boolean {
    const { W, H, BASE, passive, screen } = this.ctx;
    const stride = 2 * W;
    const proc = this.ctx.sound.proc;
    let src = BASE;
    let scrn = 0;
    for (let i = H; i !== 0; i -= 1) {
      this.zicks[i] = Math.trunc((proc[2 * i]! + 10 * this.zicks[i]!) / 11);
      this.zickD = Math.trunc((this.zickD + this.zicks[i]!) / 2);
      const d = Math.max(-W, Math.min(W, this.zickD));
      if (d >= 0) {
        screen.fill(0, scrn, scrn + d);
        screen.set(passive.subarray(src, src + W - d), scrn + d);
      } else {
        screen.set(passive.subarray(src - d, src + W), scrn);
        screen.fill(0, scrn + W + d, scrn + W);
      }
      src += W;
      scrn += stride;
    }
    return true;
  }
}

/** rotate(): a vector around the x, y and z axes, in that order. */
function rotate(p: readonly [number, number, number], rot: readonly number[]): [number, number, number] {
  const [a, b, c] = [rot[0]!, rot[1]!, rot[2]!];
  const t1 = [p[0], p[1] * Math.cos(a) + p[2] * Math.sin(a), -p[1] * Math.sin(a) + p[2] * Math.cos(a)] as const;
  const t2 = [t1[0] * Math.cos(b) + t1[2] * Math.sin(b), t1[1], -t1[0] * Math.sin(b) + t1[2] * Math.cos(b)] as const;
  return [t2[0] * Math.cos(c) + t2[1] * Math.sin(c), -t2[0] * Math.sin(c) + t2[1] * Math.cos(c), t2[2]];
}
