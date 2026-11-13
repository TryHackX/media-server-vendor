/*
 * GeissFluid — AVS Render APE by Ryan Geiss, 2001.
 *
 * APE id:  "GeissFluid"   (effect list name "Render / Fluid", file fluid.ape)
 * Binary:  fluid.ape sha256 d97cbe7ea3d3464346dcbfab618b35ca2c768e40f3fd2d3121534d3298d25262
 *          (73,728 bytes, 07.03.2001, MSVC 6, static multithreaded CRT; packs jayfatboy/JC7, undefined/undefined4)
 * Port by static reading of the binary (dumpbin /disasm + own PE parsing); nothing was run.
 * Notes with addresses and pseudo-code: scratch/avs-reference/apes/geissfluid.md.
 *
 * Config: 4 bytes, a little-endian dword the plug-in calls its colour (default 0x000000FF; all six presets
 * store exactly that). It is only shown on a hidden, disabled dialog button and is never read by the
 * simulation or the drawing.
 * The one real setting lives in the registry: HKEY_CURRENT_USER\SOFTWARE\fluid_ape, REG_DWORD
 * "log_volume_scaling" (the "Reactivity to sound" slider, 0..1000, "mellow".."hyperactive"); when the key
 * or value is missing the constructor keeps its default 500. The port uses 500:
 * sound gain = float(pow(2, 500 * 0.004f + 4.5f)) = 90.50967407 (0x42B504F4).
 *
 * Behaviour (fluid object at +0xC of the effect):
 *   - A 40 x 30 grid of cells {pressure P (1.0), velocity U on the left face, V on the top face, flags 0}
 *     wrapping in both directions, 32768 particles {x, y, age, life} in grid units, and 12 "emitters" with
 *     random frequencies/phases; all drawn from the plug-in's own rand() after srand(time(NULL)).
 *   - Per frame, 3 passes of: a Gauss-Seidel style sweep (row by row: P moves along U and V by dt, and the
 *     velocities of the row above are set to (P[neighbour] - P[cell]) * 0.9 * 5), then the velocities of row 0
 *     from row ny-2 (the plug-in's last-row loop starts its cell index at 0, so row 0 is redone against
 *     row 28 and row 29's velocities are never solved), then each emitter k sums gain*bin*0.00014 over the
 *     spectrum bins [floor(250k/12)+3, floor(250(k+1)/12)+3) read as SIGNED chars, takes
 *     (sum*0.048 - 0.25)*3.2 (0.048 = 12/250, about the mean over its 20-21 bins),
 *     clamped at 0 and squared, and blends that strength along an angle t*0.05+phases into U (3 rows, 2
 *     columns) and V (2 rows, 5 columns) at a position wandering with sums of sines (both coordinates scaled
 *     by ny, so emitters stay in columns 3..27 of 40).
 *   - dt = (seconds since construction measured at the previous frame / frames so far) / 3 (0.111 on the
 *     very first frame); t = random offset (rand()%617*100) + those seconds. clock() is the static CRT's
 *     millisecond clock.
 *   - Drawing: every byte of the frame (all four, MMX psubusb) minus 3, in blocks of 16 pixels; then the
 *     first min(w*h/28, 32767) particles move by bilinear-interpolated (U, V) * dt * 200, respawn at a random
 *     cell when they leave (0, nx-1) x (0, ny-1), and are plotted as one pixel: s = clamp(|v|*26, 0.25, 1),
 *     B = s*s*128, G = s*200, R = sqrt(s)*255 (truncated), replacing bytes 0..2, keeping byte 3. render
 *     returns 0 (in place).
 *   - Arithmetic: the plug-in switches the x87 to 24-bit precision with round-to-nearest every frame
 *     (and never restores it), so every operation of the frame is rounded to float here (Math.fround after
 *     each step, in the binary's order). fsin/fcos are not affected by the precision control. (int) casts
 *     are _ftol (truncation). The constructor runs before that switch (53-bit), as modelled.
 *
 * Not reproduced / approximate:
 *   - The seed is time(NULL) and the motion depends on the real frame rate, so no two runs of the original
 *     match either; the port seeds ctx.makeRand(floor(ctx.now()/1000)) at the first frame and measures
 *     clock() from the first frame any GeissFluid rendered (the DLL's load time).
 *   - The static CRT keeps rand() and the x87 control word per thread; AVS may create the effect on another
 *     thread than the one rendering it (and its transition pre-render thread renders one frame). The port
 *     uses one generator per effect and assumes the default control word at construction (the gain would be
 *     0x42B504F3 if a fluid had already run on the constructing thread).
 *   - The read of a pressure one row before the grid (row 1's sweep, value overwritten before use) is skipped.
 *   - Math.sin/cos (double) instead of fsin/fcos (extended): can differ only where the product is within
 *     2^-53 of a float rounding boundary.
 *   - The emitters' "odd" flag (byte +0x30) and the particles' age/life are kept but have no effect: age is
 *     never advanced, cell flags are always 0.
 */

export interface ApeContext {
  readonly w: number;
  readonly h: number;
  readonly isBeat: boolean;
  /** AVS's char visdata[2][2][576]: index (kind * 2 + channel) * 576 + i, kind 0 spectrum, 1 waveform. */
  readonly visdata: Int8Array;
  readonly visdataUnsigned: Uint8Array;
  /** MSVC rand() (0..32767) of the engine's shared generator (vis_avs's CRT). */
  rand(): number;
  /** A private MSVC rand() for a plug-in linked with its own static CRT (seed as srand). */
  makeRand(seed?: number): () => number;
  readonly registers: Float64Array;
  lineBlendMode: number;
  globalBuffer(index: number, create: boolean): Int32Array | null;
  /** GetTickCount()/timeGetTime() in ms. */
  now(): number;
}
export interface ApeEffect {
  render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number;
  destroy?(): void;
}

const f32 = Math.fround;
const bitsF = (bits: number): number => new Float32Array(new Uint32Array([bits]).buffer)[0]!;

// float constants of .rdata (0x1000C140..0x1000C1E0)
const K_0_001 = bitsF(0x3a83126f);
const K_0_01 = bitsF(0x3c23d70a);
const K_0_15 = bitsF(0x3e19999a);
const K_0_05 = bitsF(0x3d4ccccd);
const K_6_28 = bitsF(0x40c8f5c3);
const K_0_06 = bitsF(0x3d75c28f);
const K_0_04 = bitsF(0x3d23d70a);
const K_0_00014 = bitsF(0x3912ccf7);
const K_0_048 = bitsF(0x3d449ba5); // one ulp below float(0.048)
const K_3_2 = bitsF(0x404ccccd);
const K_0_2 = bitsF(0x3e4ccccd);
const K_0_333 = bitsF(0x3eaa7efa);
const K_0_9 = bitsF(0x3f666666);
const K_0_004 = bitsF(0x3b83126f);

export const NX = 40;
export const NY = 30;
export const ITERATIONS = 3;
export const PARTICLES = 0x8000;
export const EMITTERS = 12;
/** HKCU\SOFTWARE\fluid_ape\log_volume_scaling when absent. */
export const DEFAULT_LOG_VOLUME_SCALING = 500;

/** The constructor's gain: pow(2.0, v * 0.004f + 4.5f) at 53-bit precision, stored as float. */
export function volumeScale(logVolumeScaling: number): number {
  return f32(Math.pow(2, logVolumeScaling * K_0_004 + 4.5));
}

/** Correctly rounded float of int * float (x87 at 24-bit precision), also for |int| >= 2^24. */
export function mulIntF32(n: number, f: number): number {
  if (Math.abs(n) < 0x1000000) return f32(n * f);
  const hi = Math.trunc(n / 65536) * 65536;
  const a = hi * f; // both products are exact in double
  const b = (n - hi) * f;
  const s = a + b;
  const bb = s - a;
  const err = a - (s - bb) + (b - bb);
  const r = f32(s);
  if (err === 0 || r === s) return r;
  const other = f32(2 * s - r);
  if (2 * s - r !== other || Math.abs(s - r) !== Math.abs(other - s)) return r;
  // s lies exactly halfway between two floats: the exact value decides
  return err > 0 ? Math.max(r, other) : Math.min(r, other);
}

/** The module's clock() origin: the first time any GeissFluid rendered (stands in for the DLL load). */
let clockOrigin: number | null = null;
/** For tests: forget the clock() origin. */
export function resetClockOrigin(): void {
  clockOrigin = null;
}

export class Fluid {
  readonly P = new Float32Array(NX * NY);
  readonly U = new Float32Array(NX * NY);
  readonly V = new Float32Array(NX * NY);
  readonly px = new Float32Array(PARTICLES);
  readonly py = new Float32Array(PARTICLES);
  readonly page = new Float32Array(PARTICLES);
  readonly plife = new Float32Array(PARTICLES);
  /** 12 x {a0, a1, a2, a3, p0, p1, s0, s1, p2, p3} (object +0x80004, stride 0x34). */
  readonly em = new Float32Array(EMITTERS * 10);
  readonly emFlag = new Uint8Array(EMITTERS);
  readonly damp = K_0_9;
  readonly gain: number;
  offset = 0;
  initClock = 0;
  lastClock = 0; // zero-filled allocation: the first frame measures from clock 0
  frames = 0;
  particleCount = 0;
  /** The last frame's time step and emitter clock (for inspection). */
  dt = 0;
  t = 0;
  private readonly rnd: () => number;

  constructor(rnd: () => number, initClock: number, logVolumeScaling = DEFAULT_LOG_VOLUME_SCALING) {
    this.rnd = rnd;
    this.initClock = initClock;
    this.gain = volumeScale(logVolumeScaling);
    this.reset();
  }

  /** 100017F0 (after srand): random time offset, still fluid, particles, emitters (53-bit precision). */
  reset(): void {
    const r = this.rnd;
    this.offset = (r() % 617) * 100;
    this.P.fill(1);
    this.U.fill(0);
    this.V.fill(0);
    for (let i = 0; i < PARTICLES; i++) {
      this.px[i] = f32((r() % ((NX - 2) * 100)) * K_0_01 + 1);
      this.py[i] = f32((r() % ((NY - 2) * 100)) * K_0_01 + 1);
      this.page[i] = f32((r() % 1000) * K_0_001 * 15);
      this.plife[i] = 15;
    }
    for (let k = 0; k < EMITTERS; k++) {
      const e = k * 10;
      for (let j = 0; j < 4; j++) this.em[e + j] = f32((r() % 1000) * K_0_001 * K_0_15 + K_0_05);
      this.em[e + 4] = f32((r() % 1000) * K_0_001 * K_6_28);
      this.em[e + 5] = f32((r() % 1000) * K_0_001 * K_6_28);
      this.em[e + 6] = f32((r() % 1000) * K_0_001 * K_0_06 + K_0_04);
      this.em[e + 7] = f32((r() % 1000) * K_0_001 * K_0_06 + K_0_04);
      this.em[e + 8] = f32((r() % 1000) * K_0_001 * K_6_28);
      this.em[e + 9] = f32((r() % 1000) * K_0_001 * K_6_28);
      this.emFlag[k] = r() % 2;
    }
  }

  /** One pass of the solver (sweep, row-0 velocities, emitters). */
  private pass(dt: number, t: number, spec: Float32Array): void {
    const { P, U, V, damp } = this;
    for (let j = 0; j < NY; j++) {
      const up = j === 0 ? NY - 1 : j - 1;
      let left = j * NX + NX - 1;
      for (let i = 0; i < NX; i++) {
        const c = j * NX + i;
        const u = up * NX + i;
        P[u] = f32(P[u]! - f32(dt * V[c]!));
        P[c] = f32(f32(dt * V[c]!) + P[c]!);
        P[left] = f32(P[left]! - f32(dt * U[c]!));
        P[c] = f32(f32(dt * U[c]!) + P[c]!);
        if (j !== 0) {
          const a = c - NX;
          // for j == 1 the plug-in reads P one row before the grid; row 0 is redone below before any use
          if (j >= 2) V[a] = f32(f32(f32(P[a - NX]! - P[a]!) * damp) * 5);
          U[a] = f32(f32(f32(P[left - NX]! - P[a]!) * damp) * 5);
        }
        left = c;
      }
    }
    // "last row" loop: row index NY-1 for the up neighbour, cell index starting at 0
    {
      const up = NY - 2;
      let left = NX - 1;
      for (let i = 0; i < NX; i++) {
        V[i] = f32(f32(f32(P[up * NX + i]! - P[i]!) * damp) * 5);
        U[i] = f32(f32(f32(P[left]! - P[i]!) * damp) * 5);
        left = i;
      }
    }
    const nyF = NY;
    for (let k = 0; k < EMITTERS; k++) {
      const lo = Math.trunc((250 * k) / 12);
      const hi = Math.trunc((250 * (k + 1)) / 12);
      let acc = 0;
      for (let s = lo; s < hi; s++) acc = f32(acc + f32(f32(this.gain * spec[s + 3]!) * K_0_00014));
      acc = f32(acc * K_0_048);
      acc = f32(acc - 0.25);
      acc = f32(acc * K_3_2);
      if (acc < 0) acc = 0;
      const strength = f32(acc * acc);
      const e = k * 10;
      const em = this.em;
      const theta = f32(f32(f32(t * K_0_05) + em[e + 8]!) + em[e + 9]!);
      const fx = f32(Math.cos(theta) * strength);
      const fy = f32(Math.sin(theta) * strength);
      const sA = Math.sin(f32(f32(t * em[e + 1]!) + em[e + 5]!));
      const sB = Math.sin(f32(f32(t * em[e + 0]!) + em[e + 4]!));
      const cx = f32(f32(f32(f32(sA + sB) * K_0_2) + 0.5) * nyF);
      const sC = Math.sin(f32(f32(t * em[e + 3]!) + em[e + 7]!));
      const sD = Math.sin(f32(f32(t * em[e + 2]!) + em[e + 6]!));
      const ry = f32(f32(f32(f32(sC + sD) * K_0_2) + 0.5) * nyF);
      const col = Math.trunc(cx);
      const row = Math.trunc(ry);
      const fcx = f32(cx - col);
      const fry = f32(ry - row);
      {
        const b = f32(fcx * fx);
        const om = f32(1 - fcx);
        const a = f32(om * fx);
        const n = Math.trunc(NY / 8);
        for (let q = 0; q < n; q++) {
          const c0 = (row + q) * NX + col;
          U[c0] = f32(f32(om * U[c0]!) + b);
          U[c0 + 1] = f32(f32(fcx * U[c0 + 1]!) + a);
        }
      }
      {
        const b = f32(fry * fy);
        const om = f32(1 - fry);
        const a = f32(om * fy);
        const n = Math.trunc(NX / 8);
        for (let q = 0; q < n; q++) {
          const i0 = row * NX + col + q;
          V[i0] = f32(f32(om * V[i0]!) + b);
          const i1 = (row + 1) * NX + col + q;
          V[i1] = f32(f32(fry * V[i1]!) + a);
        }
      }
    }
  }

  /** 10001B30: simulate and draw one frame into a 32-bit framebuffer (pitch = w*4). clockNow = clock(). */
  render(fb: Int32Array, w: number, h: number, spec: Float32Array, clockNow: number): void {
    const L1C = mulIntF32((this.lastClock - this.initClock) | 0, K_0_001);
    const t = f32(this.offset + L1C);
    // from here the x87 runs at 24-bit precision
    const area = Math.imul(w, h);
    this.particleCount = Math.min(Math.trunc(area / 28), 0x7fff);
    this.lastClock = clockNow;
    const dt = this.frames > 0 ? f32(f32(L1C / this.frames) / ITERATIONS) : f32(K_0_333 / ITERATIONS);
    this.dt = dt;
    this.t = t;
    for (let it = 0; it < ITERATIONS; it++) this.pass(dt, t, spec);
    // fade: psubusb 3 on every byte, 64 bytes per step
    const bytes = Math.imul(h, w * 4);
    const blocks = Math.trunc(bytes / 8) >>> 3;
    const pixels = Math.min(blocks * 16, fb.length);
    for (let i = 0; i < pixels; i++) {
      const v = fb[i]!;
      fb[i] =
        Math.max(0, (v & 0xff) - 3) |
        (Math.max(0, ((v >>> 8) & 0xff) - 3) << 8) |
        (Math.max(0, ((v >>> 16) & 0xff) - 3) << 16) |
        (Math.max(0, ((v >>> 24) & 0xff) - 3) << 24);
    }
    const { U, V, px, py, page, plife } = this;
    const hF = f32(h);
    const wF = f32(w);
    const r = this.rnd;
    for (let p = 0; p < this.particleCount; p++) {
      let x = px[p]!;
      let y = py[p]!;
      const ix = Math.trunc(x);
      const iy = Math.trunc(y);
      const fxp = f32(x - ix);
      const fyp = f32(y - iy);
      const omx = f32(1 - fxp);
      const omy = f32(1 - fyp);
      const c00 = iy * NX + ix;
      const c10 = c00 + NX;
      let vx = f32(f32(omy * U[c00 + 1]!) * fxp);
      vx = f32(vx + f32(f32(omx * U[c10]!) * fyp));
      vx = f32(vx + f32(f32(omy * U[c00]!) * omx));
      vx = f32(vx + f32(f32(fyp * U[c10 + 1]!) * fxp));
      let vy = f32(f32(omy * V[c00 + 1]!) * fxp);
      vy = f32(vy + f32(f32(omx * V[c10]!) * fyp));
      vy = f32(vy + f32(f32(omy * V[c00]!) * omx));
      vy = f32(vy + f32(f32(fyp * V[c10 + 1]!) * fxp));
      x = f32(f32(f32(vx * dt) * 200) + x);
      y = f32(f32(f32(vy * dt) * 200) + y);
      // x87 compares: anything not strictly inside (or NaN) respawns; so does age > life (ordered only)
      if (!(x > 0) || !(NX - 1 > x) || !(y > 0) || !(NY - 1 > y) || page[p]! > plife[p]!) {
        x = f32(f32((r() % ((NX - 2) * 100)) * K_0_01) + 1);
        y = f32(f32((r() % ((NY - 2) * 100)) * K_0_01) + 1);
        page[p] = 0;
        plife[p] = f32(f32(f32((r() % 1000) * K_0_001) * 6) + 4);
      }
      px[p] = x;
      py[p] = y;
      const row = Math.trunc(f32(f32(y / NY) * hF));
      const col = Math.trunc(f32(f32(x / NX) * wF));
      let s = f32(f32(Math.sqrt(f32(f32(vy * vy) + f32(vx * vx)))) * 26);
      if (!(s >= 0.25)) s = 0.25;
      else if (s > 1) s = 1;
      const blue = Math.trunc(f32(f32(s * s) * 128)) & 0xff;
      const green = Math.trunc(f32(s * 200)) & 0xff;
      const red = Math.trunc(f32(f32(Math.sqrt(s)) * 255)) & 0xff;
      const o = row * w + col;
      if (o >= 0 && o < fb.length) fb[o] = (fb[o]! & 0xff000000) | (red << 16) | (green << 8) | blue;
    }
    this.frames++;
  }
}

export class GeissFluid implements ApeEffect {
  /** The 4-byte config: the plug-in's (unused) colour. */
  readonly color: number;
  fluid: Fluid | null = null;
  private readonly spec = new Float32Array(256);

  constructor(config: Uint8Array) {
    // load_config takes the dword only when len >= 4
    this.color = config.length >= 4 ? (config[0]! | (config[1]! << 8) | (config[2]! << 16) | (config[3]! << 24)) >>> 0 : 0xff;
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    const now = ctx.now();
    if (clockOrigin === null) clockOrigin = now;
    const clock = Math.floor(now - clockOrigin) | 0;
    if (!this.fluid) {
      // the constructor's init(40, 30, 3, 0.9f) + reset: srand(time(NULL))
      this.fluid = new Fluid(ctx.makeRand(Math.floor(now / 1000) >>> 0), clock);
    }
    // the effect's render: float copies of the 256 first spectrum bytes, read as signed chars
    const vis = ctx.visdata;
    for (let i = 0; i < 256; i++) this.spec[i] = vis[i]!;
    const w = ctx.w | 0;
    const h = ctx.h | 0;
    if (w > 0 && h > 0) this.fluid.render(framebuffer, w, h, this.spec, clock);
    return 0;
  }
}

export const ape = {
  id: "GeissFluid",
  sha256: ["d97cbe7ea3d3464346dcbfab618b35ca2c768e40f3fd2d3121534d3298d25262"],
  create(config: Uint8Array): ApeEffect {
    return new GeissFluid(config);
  },
};
