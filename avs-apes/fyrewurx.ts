/*
 * APE "FunkyFX FyrewurX v1" — fyrewurx.ape (FunkyFX, PE timestamp 28 Nov 1999; get_desc "Render APE / FyrewurX").
 * Binary sha256 116cfa32499b2024474b82399823e1e5af2312e0830ac21b9472eb520723cdf6 (45 056 bytes, from the VISBOT pack
 * ishan/Rocky_AVS_II, Rocky_Avs_II_for_Winamp_2/fyrewurx.ape). Port by static reading of the binary (dumpbin
 * /disasm, Python; nothing was run or loaded). Notes with addresses: scratch/avs-reference/apes/fyrewurx.md.
 *
 * Config (load_config 0x10001150; save_config 0x100011C0 writes 8 bytes), little-endian int32:
 *   +0 enabled (default 1) — read when len >= 4
 *   +4 colour 0x00RRGGBB in the framebuffer's order (default 0x285080) — read when 4 more bytes remain.
 *   All 1 129 instances in the collection's 522 presets store 8 bytes.
 *
 * The object (operator new(0x18), constructor 0x10001000) owns three parts, each with its own state:
 *   - an analyser (0x2E0C bytes, 0x10002510): per bin i < 576 and channel, a peak of the spectrum byte b
 *     through LOG_TAB[b] · WEIGHT[i] >> 8 (at most 0xFF00), falling by 0.4 a millisecond; the previous
 *     frame's peaks are kept beside them;
 *   - a particle list (0x10001DD0): 1 000 nodes, new ones in front;
 *   - an emitter (0x10001610, fixed arguments: bins 0…100, gain 100, size 3, count 100, speed 18,
 *     life 1 000 ± 250 ms). Its constructor draws one rand().
 *
 * render (0x10001210), returns 0 (in place):
 *   if (!enabled) return 0;
 *   emitter colour = the config colour;
 *   analyser.update(visdata);                 // 0x10002610: prev = cur, decay, new peaks
 *   particles.update(0.99f, 1);               // 0x10001F20: move, jitter ±½ px, age, free the dead
 *   if (isBeat) emitter.emit(analyser, w, h); // 0x10001750: at most one burst per 100 ms of credit
 *   particles.draw(w, h, framebuffer);        // 0x100020E0: size × size blocks, added with saturation
 *
 *   A burst (0x10001BA0): level L = gain · max(0, (Σcur − 3584 · (max − min)) / Σprev) / 128 for each
 *   channel over the bins; nothing below L₀ + L₁ = 0.5; otherwise at (rand() % w, rand() % h)
 *   min(300, max(1, (int)(100 · (L₀ + L₁)))) particles, each with angle rand() & 2047 of a 2048-step
 *   circle (sin/cos · 128, truncated, with π as 3.1412789f), speed rand() % 360 in 1/256 px a second and
 *   life 1 000 + rand() % 500 − 250 ms. The block fades as 255 − age · 255 / life.
 *   update() is called with damping 0.99f, and the plug-in only damps below 0.99f, so nothing is damped.
 *
 * Random generator: rand() at 0x100027E8 is the statically linked C runtime's (seed variable 0x10008070,
 * initial value 1; no srand, no other writer), not vis_avs's. It is a static of the DLL, which AVS loads
 * once: every FyrewurX shares one sequence, never reset, so the port keeps it at module level.
 * Draws: one per instance created, two per live particle per frame (jitter), two per burst and three
 * per particle of a burst.
 *
 * Time is timeGetTime() (ms, the system's uptime). The page's clock starts near 0, so the port adds a
 * fixed uptime of 2^24 ms: the emitter's first call then finds its 2 s of credit, as in Winamp.
 *
 * Size: the plug-in counts in the frame's pixels (3 × 3 blocks, at most ~180 px a second). Like the
 * engine's own pixel-based effects it runs in the size of AVS's window (about 480 lines: at up to 480
 * lines that is the frame itself, bit-exact) and is drawn scaled up above that, nearest pixel.
 *
 * Not recovered: nothing in the drawing path. The MMX drawing path (0x10002390, chosen by a flag at
 * 0x10008828 that nothing sets) computes the same saturated sums; the unused emitter modes (1 and 2+,
 * a spectrum-tracking emitter, 0x10001793…0x10001A4E) are not ported, since mode is always 0.
 * x87 notes: every product the plug-in takes through _ftol is exact in double precision (checked), and
 * no table value lies within 10⁻⁶ of an integer, so Math.sin/cos/log/sqrt give the binary's tables.
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
  /** The same frame for a plug-in whose render() only adds to pixels, per channel with saturation
   *  (top byte untouched): each write as plot(y * w + x, 0xRRGGBB) instead of a change to the frame,
   *  so the host can blend them additively without a copy of the frame. Same state as render(). */
  additive?(ctx: ApeContext, plot: (offset: number, rgb: number) => void): void;
  destroy?(): void;
}

const f32 = Math.fround;

// ---------------------------------------------------------------------------------------------------
// The DLL's C runtime rand() (0x100027E8): holdrand · 0x343FD + 0x269EC3, bits 16…30.

let holdrand = 1;

export function fyrewurxRand(): number {
  holdrand = (Math.imul(holdrand, 0x343fd) + 0x269ec3) | 0;
  return (holdrand >> 16) & 0x7fff;
}

/** Back to a freshly loaded DLL (seed 1), or to a given seed (tests). */
export function resetFyrewurxRand(seed = 1): void {
  holdrand = seed | 0;
}

// ---------------------------------------------------------------------------------------------------
// Constants and tables.

const PI_F = f32(3.1412789821624756);   // 0x1000711C (0x40490AB7)
const STEP_F = f32(0.00048828125);      // 0x10007118, 1 / 2048
const LEVEL_SCALE = 0.0078125;          // 0x1000712C, 1 / 128
const DAMPING = f32(0.99);              // pushed by render (0x3F7D70A4)
const DAMP_BELOW = f32(0.99);           // 0x10007138
const MS_TO_S = f32(0.001);             // 0x1000713C
/** timeGetTime() is the system's uptime; the page clock starts near 0. */
export const FYREWURX_UPTIME = 1 << 24;

/** Emitter constructor arguments (0x1000104E…0x10001089) after its clamps. */
const BIN_MIN = 0;                      // [+4]
const BIN_MAX = 100;                    // [+8], at most 575
const GAIN = 100;                       // [+0Ch], at most 255
const SIZE = 3;                         // [+10h]
const COUNT = 100;                      // [+14h]
const SPEED = 18;                       // [+18h], 1…29
const LIFE = 1000;                      // [+2Ch]
const LIFE_SPREAD: number = 500;              // [+30h], 0 → 1
const CAPACITY = 1000;                  // particle list constructor argument
const BIN_COUNT = 576;

/** sin and cos · 128 of 2048 steps round a circle (emitter constructor 0x10001610; tables at
 *  0x1000882C and 0x1000A82C): the angle is (2k) · 3.1412789f · (1/2048), each product exact. */
export const SIN_TAB = new Int32Array(2048);
export const COS_TAB = new Int32Array(2048);
for (let k = 0; k < 2048; k += 1) {
  const angle = 2 * k * PI_F * STEP_F;
  SIN_TAB[k] = Math.trunc(Math.sin(angle) * 128);
  COS_TAB[k] = Math.trunc(Math.cos(angle) * 128);
}

/** Analyser constructor 0x10002570: byte (int)(i · ln(1 + i)) — its low byte, as stored (+0x2D00). */
export const LOG_TAB = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) LOG_TAB[i] = Math.trunc(i * Math.log(1 + i)) & 255;

/** (int)(sqrt(i) · ((100 + 1) << 8)) per bin (+0x2400). */
export const WEIGHT = new Int32Array(BIN_COUNT);
for (let i = 0; i < BIN_COUNT; i += 1) WEIGHT[i] = Math.trunc(Math.sqrt(i) * ((100 + 1) << 8));

// ---------------------------------------------------------------------------------------------------
// Config.

export interface FyrewurxConfig {
  enabled: number;
  color: number;
}

/** Constructor 0x10001000. */
export const FYREWURX_DEFAULTS: Readonly<FyrewurxConfig> = { enabled: 1, color: 0x285080 };

export function parseFyrewurxConfig(config: Uint8Array): FyrewurxConfig {
  const out: FyrewurxConfig = { ...FYREWURX_DEFAULTS };
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  let pos = 0;
  if (config.byteLength >= 4) {
    out.enabled = view.getInt32(0, true);
    pos = 4;
  }
  if (config.byteLength - pos >= 4) out.color = view.getInt32(pos, true);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Analyser (0x2E0C bytes): peaks of the spectrum.

export class FyrewurxAnalyser {
  /** +0x0000: the peaks, [channel][bin] (channel 0 at +0, 1 at +0x900). */
  readonly cur = new Int32Array(2 * BIN_COUNT);
  /** +0x1200: the peaks before this frame. */
  readonly prev = new Int32Array(2 * BIN_COUNT);
  /** +0x2E08: time of the last decay step. */
  last = 0;
  /** +0x2E04: decay rate (· 40 / 1000 a millisecond). */
  readonly rate: number = 10;

  /** 0x10002610 with the time timeGetTime() gives. */
  update(visdata: Uint8Array, time: number): void {
    this.prev.set(this.cur); // 0x10002630
    this.decay(time);        // 0x100026D0
    this.peaks(visdata);     // 0x10002660
  }

  /** 0x100026D0: everything falls by elapsed · rate · 40 / 1000; the remainder carries over. */
  decay(time: number): void {
    const t = time >>> 0;
    if (this.last === 0) this.last = t;
    const rate = this.rate;
    if (rate === 0) return;
    const scaled = Math.imul(Math.imul((t - this.last) | 0, rate), 40) >>> 0;
    const step = Math.floor(scaled / 1000);
    const cur = this.cur;
    for (let i = 0; i < cur.length; i += 1) {
      const value = cur[i]! >>> 0;
      cur[i] = value >= step ? value - step : 0;
    }
    this.last = (this.last + Math.floor((Math.imul(step, 1000) >>> 0) / ((Math.imul(rate, 40)) >>> 0))) >>> 0;
  }

  /** 0x10002660: visdata[0][ch][i] (the spectrum, unsigned) through the tables, kept if higher. */
  peaks(visdata: Uint8Array): void {
    const cur = this.cur;
    for (let i = 0; i < BIN_COUNT; i += 1) {
      const weight = WEIGHT[i]!;
      for (let ch = 0; ch < 2; ch += 1) {
        let value = (LOG_TAB[visdata[ch * BIN_COUNT + i]!]! * weight) >>> 8;
        if (value > 0xff00) value = 0xff00;
        const at = ch * BIN_COUNT + i;
        if (value > (cur[at]! >>> 0)) cur[at] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Particle list (0x10 bytes: last time, count, active list, free list; nodes of 0x30 bytes).

export class FyrewurxParticles {
  // Node fields (+0Ch x, +10h y in 1/256 px; +14h vx, +18h vy; +1Ch ax, +20h ay; +8 size; +24h…26h
  // colour bytes; +28h age, +2Ch life in ms), by node number.
  readonly x = new Int32Array(CAPACITY);
  readonly y = new Int32Array(CAPACITY);
  readonly vx = new Int32Array(CAPACITY);
  readonly vy = new Int32Array(CAPACITY);
  readonly ax = new Int32Array(CAPACITY);
  readonly ay = new Int32Array(CAPACITY);
  readonly size = new Int32Array(CAPACITY);
  readonly red = new Uint8Array(CAPACITY);
  readonly green = new Uint8Array(CAPACITY);
  readonly blue = new Uint8Array(CAPACITY);
  readonly age = new Uint32Array(CAPACITY);
  readonly life = new Uint32Array(CAPACITY);
  /** The active list as node numbers from its tail (0) to its head (count − 1): new nodes go in
   *  front of the list (0x10001EE0), so they are appended here. */
  readonly order = new Int32Array(CAPACITY);
  count = 0;
  private readonly freeList = new Int32Array(CAPACITY);
  private free = CAPACITY;
  /** +0: time of the last update. */
  last = 0;
  private readonly survivors = new Int32Array(CAPACITY);

  constructor() {
    for (let n = 0; n < CAPACITY; n += 1) this.freeList[n] = n;
  }

  /** 0x10001EE0: a node from the free list in front of the active list (age 0, life 1000), or −1. */
  alloc(): number {
    if (this.free === 0) return -1;
    const node = this.freeList[--this.free]!;
    this.age[node] = 0;
    this.life[node] = 1000;
    this.order[this.count++] = node;
    return node;
  }

  /** 0x10001F20(damping, jitter) at timeGetTime() `time`. */
  update(time: number, damping: number, jitter: number, rand: () => number): void {
    const t = time >>> 0;
    if (this.last === 0) this.last = t;
    const dt = (t - this.last) >>> 0;
    const seconds = f32(dt * MS_TO_S);
    const damp = damping < DAMP_BELOW;
    this.last = t;
    const { x, y, vx, vy, ax, ay, age, life, order } = this;
    let kept = 0;
    // From the head of the list (the newest) to its tail.
    for (let k = this.count - 1; k >= 0; k -= 1) {
      const p = order[k]!;
      const oldVx = vx[p]!;
      x[p] = (x[p]! + (Math.trunc(oldVx * seconds) | 0)) | 0;
      const oldVy = vy[p]!;
      y[p] = (y[p]! + (Math.trunc(oldVy * seconds) | 0)) | 0;
      vx[p] = (oldVx + (Math.trunc(ax[p]! * seconds) | 0)) | 0;
      vy[p] = (oldVy + (Math.trunc(ay[p]! * seconds) | 0)) | 0;
      if (damp) {
        vx[p] = Math.trunc(vx[p]! * damping) | 0;
        vy[p] = Math.trunc(vy[p]! * damping) | 0;
      }
      if (jitter !== 0) {
        // ((rand() % 3) + 0x1FFFFFF) << 7: −128, 0 or +128.
        x[p] = (x[p]! + (((rand() % 3) + 0x1ffffff) << 7)) | 0;
        y[p] = (y[p]! + (((rand() % 3) + 0x1ffffff) << 7)) | 0;
      }
      const older = (age[p]! + dt) >>> 0;
      age[p] = older;
      if (older >= life[p]!) {
        this.freeList[this.free++] = p; // back to the front of the free list
      } else {
        this.survivors[kept++] = p;
      }
    }
    // Survivors were collected head first; the order array runs tail first.
    for (let k = 0; k < kept; k += 1) order[k] = this.survivors[kept - 1 - k]!;
    this.count = kept;
  }

  /** 0x100020E0 on a w × h frame: each live node's block, in list order, as (x0, y0, x1, y1, 0xRRGGBB). */
  draw(w: number, h: number, sink: (x0: number, y0: number, x1: number, y1: number, rgb: number) => void): void {
    const { x, y, size, red, green, blue, age, life, order } = this;
    for (let k = this.count - 1; k >= 0; k -= 1) {
      const p = order[k]!;
      const px = x[p]! >>> 8;
      const py = y[p]! >>> 8;
      const span = life[p]!;
      if (span === 0) continue; // the plug-in would loop on such a node; life is always at least 1
      let fade = Math.floor((Math.imul(age[p]!, 255) >>> 0) / span);
      if (fade > 255) fade = 255;
      const level = 255 - fade;
      if (px >= w || py >= h || level === 0) continue;
      const r = (red[p]! * level) >>> 8;
      const g = (green[p]! * level) >>> 8;
      const b = (blue[p]! * level) >>> 8;
      let x2 = (size[p]! + px) >>> 0;
      if (x2 >= w) x2 = w - 1;
      let y2 = (size[p]! + py) >>> 0;
      if (y2 >= h) y2 = h - 1;
      if (y2 === py || x2 === px) continue;
      sink(px, py, x2, y2, (r << 16) | (g << 8) | b);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Emitter (0x44 bytes, mode 0).

export class FyrewurxEmitter {
  red = 0x28;     // +1Ch, from the colour every frame
  green = 0x50;   // +20h
  blue = 0x80;    // +24h
  /** +34h: the 100 ms limiter's time. */
  last = 0;
  /** +38h: a start angle the unused modes turn (drawn at construction). */
  readonly angle: number;

  constructor(rand: () => number) {
    this.angle = rand() & 2047;
  }

  /** 0x10001AA0: the two channels' levels over bins BIN_MIN…BIN_MAX. */
  levels(analyser: FyrewurxAnalyser): [number, number] {
    const threshold = Math.imul(BIN_MAX - BIN_MIN, 7 * 512);
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let i = BIN_MIN; i <= BIN_MAX; i += 1) {
      s2 = (s2 + analyser.prev[i]!) | 0;
      s3 = (s3 + analyser.prev[BIN_COUNT + i]!) | 0;
      s0 = (s0 + analyser.cur[i]!) | 0;
      s1 = (s1 + analyser.cur[BIN_COUNT + i]!) | 0;
    }
    if (s2 === 0) s2 = 1;
    if (s3 === 0) s3 = 1;
    let left = ((s0 - threshold) | 0) / s2;
    if (left < 0) left = 0;
    let right = ((s1 - threshold) | 0) / s3;
    if (right < 0) right = 0;
    return [f32(GAIN * left * LEVEL_SCALE), f32(GAIN * right * LEVEL_SCALE)];
  }

  /** 0x10001750 (mode 0) at timeGetTime() `time` on a w × h frame: a burst if 100 ms of credit is left. */
  emit(time: number, analyser: FyrewurxAnalyser, particles: FyrewurxParticles, w: number, h: number, rand: () => number): void {
    const t = time >>> 0;
    if (((t - this.last) >>> 0) > 2000) this.last = (t - 2000) >>> 0;
    if (((t - this.last) >>> 0) < 100) return;
    if (this.burst(analyser, particles, w, h, rand)) this.last = (this.last + 100) >>> 0;
  }

  /** 0x10001BA0(analyser, w, h, 0, 1, 0): returns 0 when too quiet. */
  burst(analyser: FyrewurxAnalyser, particles: FyrewurxParticles, w: number, h: number, rand: () => number): number {
    const [left, right] = this.levels(analyser);
    const sum = left + right;          // compared before it is stored as a float
    if (sum < 0.5) return 0;
    const stored = f32(sum);
    const x0 = (rand() % w) << 8;
    const y0 = (rand() % h) << 8;
    let count = Math.trunc(COUNT * stored) | 0;
    if (count === 0) count = 1;
    else if (count > 300) count = 300;
    const fastest = SPEED * 20;
    for (let i = 0; i < count; i += 1) {
      const p = particles.alloc();
      if (p < 0) break;
      const a = rand() & 2047;
      const speed = rand() % fastest; // mode 0
      particles.x[p] = x0;
      particles.y[p] = y0;
      particles.vx[p] = Math.imul(SIN_TAB[a]!, speed);
      particles.vy[p] = Math.imul(COS_TAB[a]!, speed);
      particles.ax[p] = 0;
      particles.ay[p] = 0; // 250 · 0
      particles.size[p] = SIZE;
      particles.red[p] = this.red;
      particles.green[p] = this.green;
      particles.blue[p] = this.blue;
      particles.age[p] = 0;
      let life = LIFE;
      if (LIFE_SPREAD !== 0) life += (rand() % LIFE_SPREAD) - (LIFE_SPREAD >> 1);
      if (life <= 0) life = 1;
      particles.life[p] = life;
    }
    return 1;
  }
}

// ---------------------------------------------------------------------------------------------------
// The plug-in.

/** The size of AVS's window a w × h frame stands for (about 480 lines; the engine's rule). */
export function fyrewurxWindow(w: number, h: number): { vw: number; vh: number } {
  if (h <= 480) return { vw: w, vh: h };
  const scale = h / 480;
  return { vw: Math.max(1, Math.round(w / scale)), vh: Math.max(1, Math.round(h / scale)) };
}

/** First frame pixel of window column/row v (nearest pixel: frame pixel X shows ⌊X · vw / w⌋). */
function frameStart(v: number, frame: number, window: number): number {
  return Math.floor((v * frame + window - 1) / window);
}

export class Fyrewurx {
  readonly config: FyrewurxConfig;
  readonly analyser = new FyrewurxAnalyser();
  readonly particles = new FyrewurxParticles();
  readonly emitter: FyrewurxEmitter;

  constructor(config: FyrewurxConfig, rand: () => number = fyrewurxRand) {
    this.config = config;
    this.emitter = new FyrewurxEmitter(rand);
  }

  /** render() 0x10001210 up to the drawing; false when disabled. `time` is timeGetTime(). */
  step(ctx: Pick<ApeContext, "w" | "h" | "isBeat" | "visdataUnsigned">, time: number, rand: () => number = fyrewurxRand): boolean {
    if (this.config.enabled === 0) return false;
    const color = this.config.color;
    this.emitter.red = (color >>> 16) & 255;
    this.emitter.green = (color >>> 8) & 255;
    this.emitter.blue = color & 255;
    const { vw, vh } = fyrewurxWindow(ctx.w, ctx.h);
    this.analyser.update(ctx.visdataUnsigned, time);
    this.particles.update(time, DAMPING, 1, rand);
    if (ctx.isBeat) this.emitter.emit(time, this.analyser, this.particles, vw, vh, rand);
    return true;
  }

  /** The blocks of this frame on the w × h frame (scaled from AVS's window above 480 lines). */
  blocks(w: number, h: number, sink: (x0: number, y0: number, x1: number, y1: number, rgb: number) => void): void {
    const { vw, vh } = fyrewurxWindow(w, h);
    if (vw === w && vh === h) {
      this.particles.draw(w, h, sink);
      return;
    }
    this.particles.draw(vw, vh, (x0, y0, x1, y1, rgb) => {
      sink(frameStart(x0, w, vw), frameStart(y0, h, vh), frameStart(x1, w, vw), frameStart(y1, h, vh), rgb);
    });
  }
}

/** The drawing loop's arithmetic (0x100021E8…0x10002228): each channel byte + c, at most 255. */
export function addBlock(fb: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number, rgb: number): void {
  const r = (rgb >>> 16) & 255;
  const g = (rgb >>> 8) & 255;
  const b = rgb & 255;
  for (let row = y0; row < y1; row += 1) {
    let o = row * w + x0;
    for (let column = x0; column < x1; column += 1, o += 1) {
      const p = fb[o]!;
      const nb = Math.min(255, (p & 255) + b);
      const ng = Math.min(255, ((p >>> 8) & 255) + g);
      const nr = Math.min(255, ((p >>> 16) & 255) + r);
      fb[o] = (p & 0xff000000) | (nr << 16) | (ng << 8) | nb;
    }
  }
}

function now(ctx: ApeContext): number {
  return (FYREWURX_UPTIME + Math.floor(ctx.now())) >>> 0;
}

export const ape = {
  id: "FunkyFX FyrewurX v1",
  sha256: ["116cfa32499b2024474b82399823e1e5af2312e0830ac21b9472eb520723cdf6"],
  create(config: Uint8Array): ApeEffect {
    const plugin = new Fyrewurx(parseFyrewurxConfig(config));
    return {
      render(ctx: ApeContext, framebuffer: Int32Array): number {
        if (!plugin.step(ctx, now(ctx))) return 0;
        const w = ctx.w;
        plugin.blocks(w, ctx.h, (x0, y0, x1, y1, rgb) => addBlock(framebuffer, w, x0, y0, x1, y1, rgb));
        return 0;
      },
      additive(ctx: ApeContext, plot: (offset: number, rgb: number) => void): void {
        if (!plugin.step(ctx, now(ctx))) return;
        const w = ctx.w;
        plugin.blocks(w, ctx.h, (x0, y0, x1, y1, rgb) => {
          for (let row = y0; row < y1; row += 1) {
            const base = row * w;
            for (let column = x0; column < x1; column += 1) plot(base + column, rgb);
          }
        });
      }
    };
  }
};
