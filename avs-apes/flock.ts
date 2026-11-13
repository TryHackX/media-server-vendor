/*
 * APE "Flock Off" — flock.ape by Joshua Gerrish (Alife pack 1.07), "Render APE / Flock Off",
 * PE timestamp 3 Aug 2001, VC6 with the shared MSVCRT.DLL (rand/srand/time/_ftol/pow imported).
 * Binary sha256 38f77ed91de35ae104e5479a339af27b1ba059eec4f01843e3f794c832d3e5a0.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/flock.md.
 *
 * Config (load_config 0x100025B0; save_config 0x10002710 always writes 28 bytes), seven LE int32,
 * each read only when 4 more bytes remain:
 *   +0  enabled      default 1      render does nothing (no drawing, no motion) when 0
 *   +4  colour       default 0xFF   0x00RRGGBB, written as stored (high byte included)
 *   +8  birds        default 8      number of birds (the array holds 400; no clamp in the binary)
 *   +12 max speed    default 4      kept as a double
 *   +16 vision       default 30     neighbour radius, kept as a double
 *   +20 space        default 5      personal space (int)
 *   +24 on beat      no default (the constructor leaves it uninitialised; port: 0)
 *                    1 = "Scatter": personal space + 6 on beat frames; any other value: nothing
 *                    (the dialog offers "Change Velocity"/"Change Direction" as 2, which render
 *                    never tests).
 *
 * Birds live in a 400 x 400 world (per-bird limits +0x48/+0x4C = 400) with double position and
 * velocity (z exists but stays 0). The constructor (0x10001380), i.e. before load_config,
 * calls srand(time(0)) and initialises the default 8 birds — and only those — with 4 rand() each:
 * y = rand() % 400, x = rand() % 400, vx = rand() * (8 * (1/32767)) - 4, vy likewise, then the
 * velocity is limited to the default speed 4. Birds 8..399 stay at (0,0,0) with zero velocity, so
 * a preset with more than 8 birds starts the extra ones at the corner, all identical.
 *
 * render (0x100015D0), into framebuffer, returns 0:
 *   1. draw every bird at its current position: centre px = _ftol(w*x*0.0025),
 *      cy = -_ftol(h*y*-0.0025); rows cy-3 .. cy+3 (skipped outside 0..h-1), half widths
 *      trunc(sqrt(12.25-(k-3.5)^2)+0.99) clamped to >= 1 = 1,3,4,4,4,4,3; each row fills
 *      x in [max(0,px-hw), min(w,px+hw)) with the colour (replace; no line blend mode — the
 *      plug-in has no AVS_APE_SetExtInfo export).
 *   2. then update the birds in order, in place (later birds see the new state of earlier ones):
 *      neighbours j (including already-moved ones) are those not bit-identical to bird i (all six
 *      doubles) with 2-D distance sqrt(dy^2+dx^2) <= vision; for each: if distance <= space,
 *      separation += pos_i - pos_j; alignment sum += vel_j; cohesion sum += pos_j; n++.
 *      With n > 0: vel += separation; vel += (sum_vel*(1/n) - vel)*0.125;
 *      vel += (sum_pos*(1/n) - pos)*0.01; if |vel| > max speed: vel = vel*(1/|vel|)*max speed.
 *      Always: pos += vel; per axis x, y: if pos >= 400 pos -= 400 else if pos <= 0 pos += 400.
 *   All arithmetic is double (x87, default 53-bit precision): JS doubles reproduce it exactly.
 *
 * Not recovered / approximations:
 *   - The seed: srand(time(0)) on MSVCRT.DLL's generator, which vis_avs (built /MD) shares. The
 *     port draws the 32 start values from a private generator ctx.makeRand(floor(ctx.now()/1000))
 *     on the first render (the start layout depends only on that seed, as in the original); the
 *     original's side effect of reseeding the shared generator is not reproduced.
 *   - pow(d, 2.0) (MSVCRT _CIpow) is taken as d*d; the distance is only compared with the vision
 *     and space thresholds, so a last-bit difference could matter only exactly at a threshold.
 *   - Bird counts above 400 overflow the array in the original; the port clamps to 400.
 *   - AVS's pre-init render (isBeat = 0x80000000) counts as a beat in the original.
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

export interface FlockConfig {
  enabled: number;
  color: number;
  birds: number;
  maxSpeed: number; // double
  vision: number;   // double
  space: number;    // int
  onBeat: number;   // 1 = scatter
}

export const FLOCK_DEFAULTS: Readonly<FlockConfig> = {
  enabled: 1, color: 0xff, birds: 8, maxSpeed: 4, vision: 30, space: 5, onBeat: 0,
};

function readI32(b: Uint8Array, p: number): number {
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) | 0;
}

/** load_config 0x100025B0. */
export function parseFlockConfig(config: Uint8Array): FlockConfig {
  const c: FlockConfig = { ...FLOCK_DEFAULTS };
  const len = config.length;
  let pos = 0;
  const next = (): number | null => {
    if (len - pos < 4) return null;
    const v = readI32(config, pos);
    pos += 4;
    return v;
  };
  let v: number | null;
  if ((v = next()) !== null) c.enabled = v;
  if ((v = next()) !== null) c.color = v;
  if ((v = next()) !== null) c.birds = v;
  if ((v = next()) !== null) c.maxSpeed = v;
  if ((v = next()) !== null) c.vision = v;
  if ((v = next()) !== null) c.space = v;
  if ((v = next()) !== null) c.onBeat = v;
  return c;
}

/** Number of birds the arrays hold (0xA2A8-byte object: 400 birds of 0x68 bytes). */
export const MAX_BIRDS = 400;
/** World size: the per-bird limits at +0x48/+0x4C. */
export const WORLD = 400;
/** 1/32767 (qword 0x100030C0). */
const INV_RAND_MAX = 1 / 32767;

// Bird layout in the Float64Array, 6 doubles each: vx, vy, vz, x, y, z (offsets +0..+0x28).
const VX = 0, VY = 1, VZ = 2, PX = 3, PY = 4, PZ = 5;

/** 0x100010C0: limit the length of the velocity to `max` (reciprocal multiply, then scale). */
export function limitSpeed(b: Float64Array, o: number, max: number): void {
  const x = b[o + VX]!, y = b[o + VY]!, z = b[o + VZ]!;
  const len = Math.sqrt((x * x + y * y) + z * z);
  if (!(len > max)) return;
  let nx = 0, ny = 0, nz = 0;
  if (len !== 0) {
    const inv = 1.0 / len;
    nx = x * inv; ny = y * inv; nz = z * inv;
  }
  b[o + VX] = nx * max;
  b[o + VY] = ny * max;
  b[o + VZ] = nz * max;
}

/** Constructor 0x10001380 bird set-up: 8 birds, 4 rand() each, speed limited to the default 4. */
export function initBirds(rand: () => number): Float64Array {
  const b = new Float64Array(MAX_BIRDS * 6);
  for (let i = 0; i < FLOCK_DEFAULTS.birds; i++) {
    const o = i * 6;
    const y = rand() % WORLD;
    const x = rand() % WORLD;
    // 0x100011D0 copies the vector and clamps x, y to <= 400 (never needed for % 400)
    b[o + PX] = x; b[o + PY] = y; b[o + PZ] = 0;
    const k = (4.0 + 4.0) * INV_RAND_MAX; // bird +0x50 (4.0) doubled
    b[o + VX] = rand() * k - 4.0;
    b[o + VY] = rand() * k - 4.0;
    b[o + VZ] = 0;
    limitSpeed(b, o, FLOCK_DEFAULTS.maxSpeed);
  }
  return b;
}

/** 0x100012D0: 2-D distance; pow(d, 2.0) taken as d*d. */
function dist(b: Float64Array, i: number, j: number): number {
  const dy = b[j + PY]! - b[i + PY]!;
  const dx = b[j + PX]! - b[i + PX]!;
  return Math.sqrt(dy * dy + dx * dx);
}

/** 0x10001310: neighbour test (not bit-identical, distance <= radius). */
export function isNeighbour(b: Float64Array, i: number, j: number, radius: number): boolean {
  if (b[i + VX] === b[j + VX] && b[i + VY] === b[j + VY] && b[i + VZ] === b[j + VZ]
    && b[i + PX] === b[j + PX] && b[i + PY] === b[j + PY] && b[i + PZ] === b[j + PZ]) return false;
  return dist(b, i, j) <= radius;
}

/** 0x10001220: move and wrap x and y. */
function move(b: Float64Array, o: number): void {
  b[o + PX] = b[o + PX]! + b[o + VX]!;
  b[o + PY] = b[o + PY]! + b[o + VY]!;
  b[o + PZ] = b[o + PZ]! + b[o + VZ]!;
  for (const k of [PX, PY]) {
    const v = b[o + k]!;
    if (WORLD <= v) b[o + k] = v - WORLD;
    else if (v <= 0) b[o + k] = WORLD + v;
  }
}

/** The update half of render: every bird in order, in place. */
export function stepBirds(b: Float64Array, count: number, maxSpeed: number, vision: number, space: number): void {
  for (let i = 0; i < count; i++) {
    const o = i * 6;
    let ax = 0, ay = 0, az = 0;   // separation
    let bx = 0, by = 0, bz = 0;   // velocity sum
    let cx = 0, cy = 0, cz = 0;   // position sum
    let n = 0;
    for (let j = 0; j < count; j++) {
      const q = j * 6;
      if (!isNeighbour(b, o, q, vision)) continue;
      const d = dist(b, o, q);
      if (!(space < d)) {
        ax = (b[o + PX]! - b[q + PX]!) + ax;
        ay = (b[o + PY]! - b[q + PY]!) + ay;
        az = (b[o + PZ]! - b[q + PZ]!) + az;
      }
      bx = bx + b[q + VX]!; by = by + b[q + VY]!; bz = bz + b[q + VZ]!;
      n++;
      cx = cx + b[q + PX]!; cy = cy + b[q + PY]!; cz = cz + b[q + PZ]!;
    }
    if (n !== 0) {
      const inv = 1.0 / n;
      const avx = inv * bx, avy = inv * by, avz = inv * bz;
      const alx = (avx - b[o + VX]!) * 0.125, aly = (avy - b[o + VY]!) * 0.125, alz = (avz - b[o + VZ]!) * 0.125;
      const apx = inv * cx, apy = inv * cy, apz = inv * cz;
      const cox = (apx - b[o + PX]!) * 0.01, coy = (apy - b[o + PY]!) * 0.01, coz = (apz - b[o + PZ]!) * 0.01;
      b[o + VX] = ax + b[o + VX]!; b[o + VY] = ay + b[o + VY]!; b[o + VZ] = az + b[o + VZ]!;
      b[o + VX] = alx + b[o + VX]!; b[o + VY] = aly + b[o + VY]!; b[o + VZ] = alz + b[o + VZ]!;
      b[o + VX] = cox + b[o + VX]!; b[o + VY] = coy + b[o + VY]!; b[o + VZ] = coz + b[o + VZ]!;
      limitSpeed(b, o, maxSpeed);
    }
    move(b, o);
  }
}

/** CRT _ftol: truncate, low 32 bits. */
function ftol(v: number): number {
  if (v !== v || Math.abs(v) >= 9223372036854775808) return 0;
  const t = Math.trunc(v);
  if (Math.abs(t) < 2147483648) return t | 0;
  return Number(BigInt.asIntN(32, BigInt(t)));
}

/** Half widths of the 7 rows of a bird: trunc(sqrt(12.25-(k-3.5)^2)+0.99), at least 1. */
export const ROW_HALF_WIDTH: readonly number[] = Array.from({ length: 7 }, (_, k) => {
  const d = k - 3.5;
  return Math.max(1, ftol(Math.sqrt(12.25 - d * d) + 0.99));
});

/** The drawing half of render for one bird. */
export function drawBird(fb: Int32Array, w: number, h: number, x: number, y: number, color: number): void {
  const px = ftol((w * x) * 0.0025);
  const y0 = (-3 - ftol((h * y) * -0.0025)) | 0;
  for (let k = 0; k < 7; k++) {
    const row = y0 + k;
    if (row < 0 || row >= h) continue;
    const hw = ROW_HALF_WIDTH[k]!;
    let xe = (px + hw) | 0;
    if (xe > w) xe = w;
    let xs = (px - hw) | 0;
    if (xs < 0) xs = 0;
    const base = row * w;
    for (let x2 = xs; x2 < xe; x2++) fb[base + x2] = color;
  }
}

export class FlockOff implements ApeEffect {
  readonly config: FlockConfig;
  birds: Float64Array | null = null;

  constructor(config: Uint8Array) {
    this.config = parseFlockConfig(config);
  }

  /** The constructor's srand(time(0)) + set-up, done on the first render (needs the context). */
  init(ctx: ApeContext): void {
    this.birds = initBirds(ctx.makeRand(Math.floor(ctx.now() / 1000)));
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    if (!this.birds) this.init(ctx);
    const b = this.birds as Float64Array;
    const c = this.config;
    if (!c.enabled) return 0;
    const count = Math.min(c.birds, MAX_BIRDS);
    const w = ctx.w, h = ctx.h;
    for (let i = 0; i < count; i++) drawBird(framebuffer, w, h, b[i * 6 + PX]!, b[i * 6 + PY]!, c.color | 0);
    let space = c.space;
    if (c.onBeat !== 0 && ctx.isBeat && c.onBeat === 1) space = (c.space + 6) | 0;
    stepBirds(b, count, c.maxSpeed, c.vision, space);
    return 0;
  }
}

export const ape = {
  id: "Flock Off",
  sha256: ["38f77ed91de35ae104e5479a339af27b1ba059eec4f01843e3f794c832d3e5a0"],
  create(config: Uint8Array): ApeEffect {
    return new FlockOff(config);
  },
};
