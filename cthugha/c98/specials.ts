/**
 * Cthugha98 0.6a's special runs (0x40F2D0, 0x40F6C2, 0x41071B), translated from the executable
 * (Cthugha98.exe, the 2D build) by static analysis: the runs that, instead of a flame, draw 2500
 * particles straight into the buffer, one pixel each. Cthugha98 (c) 1998 Kevin "Zaph" Burfitt,
 * Torps Productions; postcardware, non-commercial use only, with credit. Never committed.
 *
 * The setup (start) is the tail of 0x40F2D0; the frames call swarm (0x40F6C2, variant 0) or
 * fountain (0x41071B, variant 1). Their globals are fields here: the particles (0x4A96F8, 2500
 * records of 0x1C bytes) and the flag that fills them (0x4799CC) are shared by both effects and
 * filled once, by whichever draws first; they carry over from run to run, as does the counter
 * (0x4BACD4). Each call reads the buffer, W, H and the sound from the host, as the code read the
 * globals; host.stereo[2i] is L[i], [2i + 1] R[i], unsigned (128 is silence). "Roughness" below is
 * a channel's mean |s[k] − s[k − 1]| over the frame's 1024 samples.
 *
 * Swarm (variant 0; first fill: random places, speeds −2 … 2, random colours): dot 0 leads,
 * pulled to the middle ((W/2 − x)/256, (H/2 − y)/256) and pushed by the first sample
 * ((L[0] − 127)/2, (R[0] − 127)/2), speed += push / 50. Dot i is pushed by its sample i mod 1024
 * the same way and by the run's 0–3 repellers (base 150–249 × a channel's roughness, over the
 * distance, on both axes alike, within √20000 ≈ 141 px; each repeller rides a sine track or
 * drifts half a pixel a frame on each axis), speed += push / 100 (or / 33), plus gravity 0.5 in
 * some runs. Speeds are scaled by the run's damping (0.96 … 1.01) each frame. One dot a frame, in
 * turn, and every dot whose colour has run out is reborn on dot 0 with dot 0's speed reversed plus
 * a kick of up to ± roughness / 8, colour 200–255 (dot 0 itself only when its colour runs out:
 * in place, speed = push / 25); colours fall by one a frame for each quiet channel (roughness
 * < 10). Dots leaving the screen wrap round or, in some runs, bounce (vertically losing 30 %).
 *
 * Fountain (variant 1; start() forces mode 0, the screen cleared each frame; first fill: every dot
 * on its column, bottom row, random colour): dot i's column is i × 0.256 (three or four to a
 * column). On the bottom row it is kicked up by lift[|a|] = |a| × H / 1440 a frame (|a| / 3 at
 * 480) and gravity 0.5 brings it back; dots stop at the edges (at the top they stay while still
 * rising). Wave mode: a = sample trunc(i × 0.512) mod 1024 − 127, of the left channel for the left
 * half, the right for the right; colour 255 − that channel's roughness. Stereo mode: the dot moves
 * to the column of that sample's balance, |L| / |R| × W/2 when the right is louder, else
 * (2 − |R| / |L|) × W/2 (so a louder left goes right; mono stays in the middle), and
 * a = (|L| + |R|) / 2 (|L| = |L − 127|). Rebirth (one a frame in turn, and when the colour has run
 * out): its own column, bottom row, at rest, colour 200–255. x never moves by its speed here.
 *
 * Integers are C's: `/` truncates, `%` keeps the dividend's sign, bytes keep the low 8 bits. The
 * 2D build only uses DirectDraw, so the x87 keeps Windows' 53-bit precision: expressions are
 * doubles, rounded to float where the code stores to a float (the Float32Array fields round by
 * themselves, the locals use fround). The x87 compares (fcomp; fnstsw; test ah, 1 / 41h / 40h)
 * count NaN as below, at-or-below and equal: lt, le, eq.
 *
 * Outside the buffer: every path puts a dot with finite x, y inside the screen before it is
 * plotted, so the plot (offset ftol(ftol(y) × W + x)) is inside W × H; a non-finite x or y (only
 * after the executable would have hung, below) gives offset 0, as ftol does; an offset outside
 * W × H would be skipped. The reads stay inside: samples 0 … 1023, lift[0 … 128], and the
 * repellers' sine index 0 … 319 (outside sine[640] it would read 0 here).
 *
 * Where the executable would hang: the wrap loops (`while (v < 0) v += W; while (W <= v) v −= W`,
 * also for H and for z by 256) step exactly while |v| < 2^31 (W 640), 2^29 (H 480), 2^32 (256),
 * so the closed form v % m is the same float; beyond that the executable takes millions of
 * rounded steps, and never finishes once a step no longer changes v (|v| ≥ 2^34 for 640), nor
 * for NaN or ±Infinity. Here those get the exact remainder (non-finite values stay as they are).
 * It takes speeds beyond 2^31 px a frame: about 2000 frames at damping 1.01 with neither channel
 * ever quiet (so dot 0 is never reborn; runs last 200–950 frames, but the dots carry over), or a
 * dot within a millionth of a pixel of a repeller.
 */

import type { C98Host } from "./host";

/** 0x9C4: the particles. */
const COUNT = 2500;

const f32 = Math.fround;

/** _ftol (0x413F00): fistp with chop, the low 32 bits of the 64-bit integer. */
function ftol(x: number): number {
  return Math.abs(x) < 9223372036854775808 ? Math.trunc(x) | 0 : 0;
}

/** `fld a; fcomp b; test ah, 1`: C0, a < b or unordered. */
function lt(a: number, b: number): boolean {
  return !(a >= b);
}

/** `test ah, 41h`: C0 | C3, a <= b or unordered. */
function le(a: number, b: number): boolean {
  return !(a > b);
}

/** `test ah, 40h`: C3, a == b or unordered. */
function eq(a: number, b: number): boolean {
  return !(a < b || a > b);
}

/**
 * `while (v < 0) v += m; while (m <= v) v -= m;` on a float, each step stored to float (the
 * particles' wrap; z's second test is !(v < 256), the same for numbers). Every step but the last
 * one up from below 0 is exact while m is a multiple of v's ulp, so the loops end on v % m, or
 * on fround(m + r) from r = v % m < 0 (which may round to m, and then to 0). See the header for
 * the values where the executable never finishes.
 */
function wrapLoop(v: number, m: number): number {
  if (!Number.isFinite(v)) return v;
  if (v < 0) {
    const r = v % m;
    v = r < 0 ? f32(m + r) : 0;
  }
  if (v >= m) v = f32(v % m);
  return v;
}

export class C98Specials {
  private readonly host: C98Host;

  // The particles (0x4A96F8, 0x1C bytes each): x, y, z (+0, +4, +8), their speeds (+0xC, +0x10,
  // +0x14), colour (+0x18). The bytes +0x19 and +0x1A are zeroed with them and never read. z and
  // its speed never reach the picture.
  private readonly x = new Float32Array(COUNT);
  private readonly y = new Float32Array(COUNT);
  private readonly z = new Float32Array(COUNT);
  private readonly vx = new Float32Array(COUNT);
  private readonly vy = new Float32Array(COUNT);
  private readonly vz = new Float32Array(COUNT);
  private readonly col = new Uint8Array(COUNT);
  /** 0x4799CC (−1 in the file, then 2500): the particles have been filled. */
  private filled = false;
  /** 0x4BACD4: the index reborn this frame, 1 … 2499 (0 before the first frame). */
  private counter = 0;

  /** The run's effect ([ebp−18h] of 0x40F2D0). */
  private which = 0;
  /** 0x4BA868: how many repellers (0–3). */
  private n = 0;
  // The repellers: x (0x4BA86C), y (0x4BA878), this frame's force (0x4BA884), base (0x4BA890),
  // x and y movement (0x4BA89C, 0x4BA8A8: 0 a sine track, 1 half a pixel a frame), the channel
  // whose roughness drives it (0x4BA8B4: 0 right, 1 left).
  private readonly rx = new Float32Array(3);
  private readonly ry = new Float32Array(3);
  private readonly force = new Float32Array(3);
  private readonly base = new Float32Array(3);
  private readonly xmode = new Int32Array(3);
  private readonly ymode = new Int32Array(3);
  private readonly chan = new Int32Array(3);
  /** 0x4BA8C0, 0x4BA8C4: gravity (x is always 0; y 0 or 0.5). */
  private gx = 0;
  private gy = 0;
  /** 0x4BA8C8: the speeds' factor a frame, 0.96 … 1.01. */
  private damp = 0;
  /** 0x4BA8CC: swarm, push / 33 (1) or / 100 (0); fountain, stereo (1) or wave (0). */
  private flagA = 0;
  /** 0x4BA8D0: swarm, bounce (1) or wrap (0); the fountain reads it and does nothing with it. */
  private flagB = 0;
  /** 0x4BA8D4: |i / (1440 / H)|, the fountain's kick per sample unit. */
  private readonly lift = new Float32Array(256);

  constructor(host: C98Host) {
    this.host = host;
  }

  /** Which effect this run draws: 0 → 0x40F6C2, 1 → 0x41071B. */
  get variant(): number {
    return this.which;
  }

  /** The particles as the 3Dfx build's points view read them (count 0x4799CC: −1 until filled). */
  get particles(): { count: number; x: Float32Array; y: Float32Array; z: Float32Array; colour: Uint8Array } {
    return { count: this.filled ? COUNT : -1, x: this.x, y: this.y, z: this.z, colour: this.col };
  }

  /**
   * 0x40F2D0 after `count` (and after W, H were set to the screen's size): the variant and its
   * parameters, rand() calls in the original order. Returns the mode the run uses (variant 1
   * forces 0).
   */
  start(mode: number): number {
    const host = this.host;
    const { W, H } = host;
    this.which = host.rand() & 1;
    this.damp = f32((host.rand() % 11) / 200 + f32(0.96));
    this.n = host.rand() & 3;
    this.gx = 0;
    this.gy = 0;
    for (let i = 0; i < this.n; i += 1) {
      this.rx[i] = host.rand() % W;
      this.ry[i] = host.rand() % H;
      this.base[i] = (host.rand() % 100) + 150;
      this.xmode[i] = host.rand() & 1;
      this.ymode[i] = host.rand() & 1;
      this.chan[i] = host.rand() & 1;
    }
    this.flagA = host.rand() & 1;
    this.flagB = host.rand() & 1;
    if (this.which === 0) {
      if (host.rand() % 5 === 0) {
        this.gy = 0.5;
        this.flagB = 1;
      }
    } else {
      this.gy = 0.5;
      mode = 0;
    }
    const step = 1440 / H;
    for (let i = 0; i < 256; i += 1) this.lift[i] = Math.abs(i / step);
    return mode;
  }

  /** One frame of it (called after the sound was read, before the palette update and blit). */
  draw(): void {
    if (this.which === 1) this.fountain();
    else this.swarm();
  }

  /** A short name for a status line. */
  describe(): string {
    if (this.which === 1) return `Special 2 (fountain, ${this.flagA === 1 ? "stereo" : "wave"})`;
    const parts = [this.n === 0 ? "no repellers" : `${this.n} repeller${this.n > 1 ? "s" : ""}`];
    parts.push(this.flagB === 1 ? "bounce" : "wrap");
    if (this.gy !== 0) parts.push("gravity");
    parts.push(`×${this.damp.toFixed(3)}`);
    return `Special 1 (swarm: ${parts.join(", ")})`;
  }

  // --- shared -------------------------------------------------------------------------------

  /** Each channel's sum of |s[k] − s[k − 1]| over k = 1 … 1023, stored as floats, then / 1024. */
  private roughness(): [number, number] {
    const s = this.host.stereo;
    let left = 0;
    let right = 0;
    for (let k = 1; k < 1024; k += 1) {
      left = f32(Math.abs(s[2 * k]! - s[2 * k - 2]!) + left);
      right = f32(Math.abs(s[2 * k + 1]! - s[2 * k - 1]!) + right);
    }
    return [f32(left / 1024), f32(right / 1024)];
  }

  /** The next index to rebirth: 1 … 2499. */
  private tick(): void {
    this.counter = (this.counter + 1) % COUNT;
    if (this.counter === 0) this.counter = 1;
  }

  /** Colours fall by one a frame for each quiet channel (roughness < 10). */
  private fade(i: number, levL: number, levR: number): void {
    const col = this.col;
    if (col[i] !== 0) {
      if (lt(levL, 10)) col[i] = col[i]! - 1;
      if (col[i] !== 0 && lt(levR, 10)) col[i] = col[i]! - 1;
    }
  }

  /** The particle's pixel: buffer[ftol(ftol(y) × W + x)] = colour (skipped outside W × H). */
  private plot(i: number): void {
    const { b, W, H } = this.host;
    const at = ftol(Math.imul(ftol(this.y[i]!), W) + this.x[i]!);
    if (at >= 0 && at < W * H) b[at] = this.col[i]!;
  }

  /** sine[i] (0 outside sine[640]; the repellers' index is always 0 … 319). */
  private sineAt(i: number): number {
    return i >= 0 && i < 640 ? this.host.sine[i]! : 0;
  }

  // --- 0x40F6C2 ------------------------------------------------------------------------------

  private swarm(): void {
    const host = this.host;
    const { W, H, stereo } = host;
    const { x, y, z, vx, vy, vz, col, rx, ry } = this;
    if (!this.filled) {
      this.filled = true;
      for (let k = 0; k < COUNT; k += 1) {
        x[k] = host.rand() % W;
        y[k] = host.rand() % H;
        z[k] = 0;
        vx[k] = (host.rand() % 5) - 2;
        vy[k] = (host.rand() % 5) - 2;
        vz[k] = (-host.rand() % 3) - 1;
        col[k] = host.rand() & 255;
      }
    }
    const [levL, levR] = this.roughness();
    const halfW = (W / 2) | 0;
    const halfH = (H / 2) | 0;

    // The repellers move, and take this frame's force.
    for (let k = 0; k < this.n; k += 1) {
      if (this.xmode[k] === 0) rx[k] = halfW + 2 * this.sineAt(((ftol(Math.abs(ry[k]!)) + k * 10) | 0) % 320);
      else if (this.xmode[k] === 1) rx[k] = rx[k]! + 0.5;
      if (this.ymode[k] === 0) ry[k] = halfH + 2 * this.sineAt(((ftol(Math.abs(rx[k]!)) + k * 10) | 0) % 320);
      else if (this.ymode[k] === 1) ry[k] = ry[k]! + 0.5;
      if (this.chan[k] === 0) this.force[k] = levR * this.base[k]!;
      else if (this.chan[k] === 1) this.force[k] = levL * this.base[k]!;
      if (lt(rx[k]!, 0)) rx[k] = W + rx[k]!;
      else if (le(W, rx[k]!)) rx[k] = rx[k]! - W;
      // Both branches test the bottom edge (the second was surely meant for y < 0).
      if (lt(H, ry[k]!)) ry[k] = ry[k]! - H;
      else if (le(H, ry[k]!)) ry[k] = ry[k]! - H;
    }

    this.tick();
    for (let i = 0; i < COUNT; i += 1) {
      const s = i & 1023;
      let fx = f32((stereo[2 * s]! - 127) / 2);
      let fy = f32((stereo[2 * s + 1]! - 127) / 2);
      if (i === 0) {
        fx = f32(fx + (halfW - x[0]!) / 256);
        fy = f32(fy + (halfH - y[0]!) / 256);
      } else {
        for (let a = 0; a < this.n; a += 1) {
          const dx = rx[a]! - x[i]!;
          const dy = ry[a]! - y[i]!;
          const d2 = f32(dx * dx + dy * dy);
          if (!eq(d2, 0) && lt(d2, 20000)) {
            const f = f32(this.force[a]! / f32(Math.sqrt(d2)));
            fx = le(rx[a]!, x[i]!) ? f32(fx + f) : f32(fx - f);
            fy = le(ry[a]!, y[i]!) ? f32(fy + f) : f32(fy - f);
          }
        }
      }

      x[i] = x[i]! + vx[i]!;
      y[i] = y[i]! + vy[i]!;
      z[i] = z[i]! + vz[i]!;
      vx[i] = this.damp * vx[i]!;
      vy[i] = this.damp * vy[i]!;
      if (i !== 0) {
        if (!eq(this.gx, 0)) vx[i] = this.gx + vx[i]!;
        if (!eq(this.gy, 0)) vy[i] = this.gy + vy[i]!;
      }
      this.fade(i, levL, levR);
      const div = i === 0 ? 50 : this.flagA === 1 ? 33 : 100;
      vx[i] = vx[i]! + fx / div;
      vy[i] = vy[i]! + fy / div;

      if (this.counter === i || col[i] === 0) {
        if (i === 0) {
          x[0] = wrapLoop(x[0]!, W);
          y[0] = wrapLoop(y[0]!, H);
          vx[0] = fx / 25;
          vy[0] = fy / 25;
          vz[0] = (fy - fx) / 25;
          z[0] = 0;
        } else {
          // rep movsd: the whole record of dot 0.
          x[i] = x[0]!;
          y[i] = y[0]!;
          z[i] = z[0]!;
          vx[i] = -vx[0]!;
          vy[i] = -vy[0]!;
          vz[i] = vz[0]!;
          col[i] = col[0]!;
          if (!lt(levL, 1)) {
            const t = 50 - (host.rand() % 101);
            const kick = f32((t * (levL / 2)) / 200);
            vx[i] = f32((host.screenW * kick) / 640) + vx[i]!;
          }
          if (!lt(levR, 1)) {
            const t = 50 - (host.rand() % 101);
            const kick = f32((t * (levR / 2)) / 200);
            vy[i] = f32((host.screenH * kick) / 480) + vy[i]!;
          }
          vz[i] = (levL - levR) * 5;
        }
        col[i] = (host.rand() % 56) + 200;
      } else if (lt(x[i]!, 0) || le(W, x[i]!) || lt(y[i]!, 0) || le(H, y[i]!)) {
        if (this.flagB === 1) {
          if (lt(x[i]!, 0)) {
            x[i] = 0;
            vx[i] = -vx[i]!;
          }
          if (le(W, x[i]!)) {
            x[i] = W - 1;
            vx[i] = -vx[i]!;
          }
          if (lt(y[i]!, 0)) {
            y[i] = 0;
            vy[i] = -vy[i]! * 0.7;
          }
          if (le(H, y[i]!)) {
            y[i] = H - 1;
            vy[i] = -vy[i]! * 0.7;
          }
          if (lt(z[i]!, 0)) {
            z[i] = 0;
            vz[i] = -vz[i]! * 0.7;
          }
          if (!lt(z[i]!, 256)) {
            z[i] = 255;
            vz[i] = -vz[i]! * 0.7;
          }
        } else {
          x[i] = wrapLoop(x[i]!, W);
          y[i] = wrapLoop(y[i]!, H);
          z[i] = wrapLoop(z[i]!, 256);
        }
      }
      this.plot(i);
    }
  }

  // --- 0x41071B ------------------------------------------------------------------------------

  private fountain(): void {
    const host = this.host;
    const { W, H, stereo } = host;
    const { x, y, z, vx, vy, vz, col } = this;
    const spread = f32(W / 2500);
    if (!this.filled) {
      this.filled = true;
      for (let k = 0; k < COUNT; k += 1) {
        x[k] = ftol(k * spread) % W;
        y[k] = H - 1;
        z[k] = host.rand() & 255;
        vx[k] = 0;
        vy[k] = 0;
        vz[k] = 0;
        col[k] = host.rand() & 255;
      }
    }
    const [levL, levR] = this.roughness();
    this.tick();
    for (let i = 0; i < COUNT; i += 1) {
      if (eq(H - 1, y[i]!)) {
        // On the bottom row: the kick, from sample i × 0.512.
        const si = ftol(i * spread * 2) % 1024;
        let a: number;
        let column: number;
        if (this.flagA !== 1) {
          if (i < 1250) {
            a = stereo[2 * si]! - 127;
            col[i] = ftol(255 - levL);
          } else {
            a = stereo[2 * si + 1]! - 127;
            col[i] = ftol(255 - levR);
          }
          column = ftol(i * spread) % 1024;
        } else {
          const l = Math.abs(stereo[2 * si]! - 127);
          const r = Math.abs(stereo[2 * si + 1]! - 127);
          if (r > l) column = r === 0 ? (W / 2) | 0 : ftol(((l / r) * W) / 2);
          else column = l === 0 ? (W / 2) | 0 : ftol(((2 - r / l) * W) / 2);
          if (column < 0) column = 0;
          if (column >= W) column = W - 1;
          a = (l + r) >> 1;
        }
        const lift = this.lift[Math.abs(ftol(a))]!;
        vy[i] = vy[i]! - lift;
        x[i] = column;
        vz[i] = lift / 3 - z[i]! * 0.033;
      }
      y[i] = y[i]! + vy[i]!;
      z[i] = z[i]! + vz[i]!;
      if (!eq(this.gy, 0)) vy[i] = this.gy + vy[i]!;
      this.fade(i, levL, levR);

      if (this.counter === i || col[i] === 0) {
        vx[i] = 0;
        vy[i] = 0;
        x[i] = ftol(i * spread) % W;
        y[i] = H - 1;
        col[i] = (host.rand() % 56) + 200;
      } else if (lt(x[i]!, 0) || le(W, x[i]!) || lt(y[i]!, 0) || le(H, y[i]!)) {
        if (lt(y[i]!, 0)) y[i] = 0;
        if (le(H, y[i]!)) y[i] = H - 1;
        if (lt(x[i]!, 0)) x[i] = 0;
        if (le(W, x[i]!)) x[i] = W - 1;
        if (lt(z[i]!, 0)) z[i] = 0;
        if (!lt(z[i]!, 256)) z[i] = 254;
      }
      this.plot(i);
    }
  }
}
