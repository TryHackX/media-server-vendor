/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; based on Cthugha by Kevin "Zaph" Burfitt and
 * Cthugha-L by Harald Deischinger; free for personal use (vis_sh.txt); never committed.
 *
 * The twenty waves of Vis_sh.dll (records at 10025298), translated from 1000CAA0 … 1000EAB0 with
 * their helpers (vline 1000EF20, hline 1000EFA0, line 1000F090, the peak detector 1000F210).
 *
 * A wave gets the buffer and Winamp's data: 576 bytes of each channel, the waveform (signed
 * bytes, read as `byte ^ 128`) or the spectrum (bytes, `^ 0`). `mem` mirrors the module struct:
 * spectrum at 0, waveform at 1152, then the DLL's own .data, because Pete2, Aaron and Objects
 * read past the 1152 bytes they were given (by up to 63 bytes at 640 wide) and saw it.
 * Colours go through the colour tables (Init, 100C7648; the plug-in always used table 2, which
 * is the identity, but LineHor reads 128 entries further on and Spike past the 256).
 */

import { ftol } from "./tabs";
import { MsRandom } from "./random";

/** Records of the wave table: short and long names. */
export const WAVE_NAMES: readonly (readonly [string, string])[] = [
  ["DotHor", "Dots Horizontal"], ["DotVert", "Dots Vertical"], ["LineHor", "Lines Horizontal"],
  ["LineVert", "Lines Vertical"], ["Spike", "Spikes"], ["SpikeH", "Spikes Hollow"], ["Walking", "Walking"],
  ["Falling", "Falling"], ["Lissa", "Lissa"], ["Light", "Lightning"], ["Pete0", "FireFlies"],
  ["Pete2", "Dot VS sine"], ["Aaron", "Rings of Fire"], ["Pyro", "Fire works"], ["Spiral", "Spirograph"],
  ["Warp", "Space warp"], ["Corner", "Corner"], ["Laser", "Laser"], ["Objects", "Rotating objects"],
  ["School", "School of fish"]
];

export const OBJECTS_WAVE = 18;

/** A division by zero inside a wave: Render's __except caught it and the frame went on. */
export class WaveFault extends Error {}

/** Init's ten colour tables (100C7648), d = |128 − k|; table 6 takes 256 rand()s. */
export function colourTables(random: MsRandom): Int32Array {
  const t = new Int32Array(2560);
  for (let k = 0; k < 256; k += 1) {
    const b = 128 - k;
    const d = Math.abs(b);
    t[k] = 2 * d;
    t[256 + k] = 255 - 2 * d;
    t[512 + k] = k;
    t[768 + k] = b + 127;
    t[1024 + k] = d + 127;
    t[1280 + k] = 382 - d;
    t[1536 + k] = random.rand() & 255;
    t[1792 + k] = d < 64 ? 255 : d * 4;
    t[2048 + k] = d;
    t[2304 + k] = 255 - d;
  }
  return t;
}

interface Particle { vx: number; vy: number; x: number; y: number; state: number; colour: number }
interface Ring { r: number; dr: number; angle: number; dangle: number; n: number; colour: number; decel: number }
interface Fish { vx: number; vy: number; x: number; y: number; colour: number }

export class Waves {
  w = 0;
  h = 0;
  /** 100CB554: 128 for the waveform, 0 for the spectrum. */
  centre = 128;
  /** 100C6410: WaveScale (H key). */
  scale = 1;
  /** 100C6C38: the colour table, 2 for the whole life of the plug-in. */
  table = 2;
  buf: Uint8Array = new Uint8Array(0);
  /** Set by Objects when it has nothing to draw (it switches the wave to 0). */
  wave = 0;
  /** The letter being spelled (1000C740's segments), or null. */
  object: Int32Array | null = null;

  /** Init's sine tables: 100C6C48 (w entries), 100CAAC8 (640), 100C9EF0 (360 degrees). */
  private sineW = new Int32Array(0);
  private readonly sine640 = new Int32Array(640);
  private readonly sineDeg = new Float64Array(360);

  // Statics of the waves (their addresses in Vis_sh.dll).
  private lineHorPrev = 0; // 100CE368
  private walking = 128; // 10025C98
  private falling = 0; // 100CE36C
  private fireflies = [160, 100, 160, 100]; // 10025C9C…CA8
  private aaronFirst = true; // 10025CB0
  private aaron = [-1, -1, -1, -1]; // cx1, cx2, cy1, cy2: 10025CB4…CC0
  private aaronA = 40; // 10025CAC
  private aaronB = 0; // 100CE370
  private pyroInit = false; // 100CE374
  private gravity = 0; // 100CDD54
  private readonly particles: Particle[] = Array.from({ length: 420 }, () => ({ vx: 0, vy: 0, x: 0, y: 0, state: 0, colour: 0 }));
  private spiralColour = 0; // 100CE380
  private spiralPhase = 0; // 100CE378
  private spiralTimer = 0; // 100CE384
  private spiralMult = 0; // 100CE124
  private spiralAmp = 0; // 100CE37C
  private warpFirst = true; // 10025CC4
  private warpX = 0; // 100CE128
  private warpY = 0; // 100CB5EC
  private warpMax = 0; // 100CE12C
  private readonly warpRings: Ring[] = Array.from({ length: 20 }, () => ({ r: 0, dr: 0, angle: 0, dangle: 0, n: 0, colour: 0, decel: 0 }));
  private corner = { prev: 0, accum: 0, total: 0, x: 0, y: 0 }; // 100CE388…398
  private laser1 = 0; // 100CE39C
  private laser2 = 0; // 100CE3A0
  private angle = 0; // 100CE3A8
  private schoolInit = false; // 100CE3B4
  private schoolSpeed = 0; // 100CE3B0
  private schoolHeading = 45; // 10025CC8
  private schoolRespawn = 0; // 100CE3BC
  private schoolNext = 0; // 100CE3B8
  private readonly fish: Fish[] = Array.from({ length: 30 }, () => ({ vx: 0, vy: 0, x: 0, y: 0, colour: 0 }));
  /** 1000F210's statics: last level, its rise so far, the sum of peaks. */
  private peakPrev = 0;
  private peakRise = 0;
  private peakTotal = 0;

  constructor(
    private readonly random: MsRandom,
    private readonly colours: Int32Array,
    private readonly mem: Uint8Array
  ) {
    for (let i = 0; i < 640; i += 1) this.sine640[i] = ftol(Math.sin(i * 0.03927) * 128);
    for (let i = 0; i < 360; i += 1) this.sineDeg[i] = Math.sin(i * 0.017453292519943295);
  }

  /** Init after the resolution is known: the w-long sine table. */
  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.sineW = new Int32Array(w);
    for (let i = 0; i < w; i += 1) this.sineW[i] = ftol(Math.sin((i / w) * 6.283185307179586) * 128);
  }

  private colour(index: number): number {
    const at = this.table * 256 + index;
    return at >= 0 && at < 2560 ? this.colours[at]! : 0;
  }

  private byte(at: number): number {
    return at >= 0 && at < this.mem.length ? this.mem[at]! : 0;
  }

  // --- helpers ------------------------------------------------------------------------------

  /** 1000F050 → 1000F030. */
  private put(x: number, y: number, c: number): void {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.buf[y * this.w + x] = c;
  }

  /** 1000EF20: a column from y a to y b, clamped; pixel 0 is never written. */
  private vline(a: number, b: number, x: number, c: number): void {
    const { w, h } = this;
    let lo = a <= b ? a : b;
    let hi = a <= b ? b : a;
    if (lo < 0) lo = 0;
    if (lo >= h) lo = h - 1;
    if (hi < 0) hi = 0;
    if (hi >= h) hi = h - 1;
    let p = lo * w + x;
    const end = w * h;
    for (let n = hi - lo + 1; lo <= hi && n > 0; n -= 1, p += w) if (p > 0 && p < end) this.buf[p] = c;
  }

  /** 1000EFA0: a row from x a to x b, both moved a screen over while both are off one side. */
  private hline(a: number, b: number, y: number, c: number): void {
    const { w, h } = this;
    let lo = a <= b ? a : b;
    let hi = a <= b ? b : a;
    if (lo < 0) {
      while (hi < 0) {
        lo += w;
        hi += w;
        if (lo >= 0) break;
      }
    }
    if (lo >= w) {
      while (hi >= w) {
        lo -= w;
        hi -= w;
        if (lo < w) break;
      }
    }
    if (lo < 0) lo = 0;
    if (lo >= w) lo = w - 1;
    if (hi < 0) hi = 0;
    if (hi >= w) hi = w - 1;
    let p = y * w + lo;
    const end = w * h;
    for (let n = hi - lo + 1; lo <= hi && n > 0; n -= 1, p += 1) if (p > 0 && p < end) this.buf[p] = c;
  }

  /** 1000F090: a stepped line, ends clamped to 0…w and 0…h, the last point not drawn. */
  private line(x1: number, y1: number, x2: number, y2: number, c: number): void {
    const { w, h } = this;
    x1 = x1 < 0 ? 0 : x1 > w ? w : x1;
    x2 = x2 < 0 ? 0 : x2 > w ? w : x2;
    y1 = y1 < 0 ? 0 : y1 > h ? h : y1;
    y2 = y2 < 0 ? 0 : y2 > h ? h : y2;
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    const sx = x1 <= x2 ? 1 : -1;
    const sy = y1 <= y2 ? 1 : -1;
    const end = w * h;
    let err = 0;
    if (dx > dy) {
      let x = x1;
      let y = y1;
      if (x1 === x2) return;
      do {
        if (err >= dx) {
          err -= dx;
          y += sy;
        }
        const p = y * w + x;
        if (p > 0 && p < end) this.buf[p] = c;
        x += sx;
        err += dy;
      } while (x !== x2);
    } else {
      let x = x1;
      let y = y1;
      if (y1 === y2) return;
      do {
        if (err >= dy) {
          err -= dy;
          x += sx;
        }
        const p = y * w + x;
        if (p > 0 && p < end) this.buf[p] = c;
        err += dx;
        y += sy;
      } while (y !== y2);
    }
  }

  /** The sum of |s[k] − s[k+1]| over a channel's 575 pairs (raw bytes). */
  private roughness(at: number): number {
    let sum = 0;
    for (let k = 0; k < 575; k += 1) sum += Math.abs(this.byte(at + k) - this.byte(at + k + 1));
    return sum;
  }

  /** 1000F210: the level and, when it starts to fall, how far it rose (shared statics). */
  private peak(d: number): { peak: number; level: number } {
    let level = Math.trunc((Math.trunc(this.roughness(d) / 288) + Math.trunc(this.roughness(d + 576) / 288)) / 2);
    if (level < this.peakPrev - 9) level = this.peakPrev - 9;
    if (level > this.peakPrev) this.peakRise += level - this.peakPrev;
    let peak = 0;
    if (level < this.peakPrev) {
      peak = this.peakRise;
      this.peakRise = 0;
    }
    this.peakTotal += peak;
    this.peakPrev = level;
    return { peak, level };
  }

  private sind(a: number): number {
    let i = a % 360;
    if (i < 0) i += 360;
    return this.sineDeg[i]!;
  }

  // --- the waves ----------------------------------------------------------------------------

  draw(wave: number, buf: Uint8Array, d: number): void {
    this.buf = buf;
    this.wave = wave;
    switch (wave) {
      case 0: return this.dotHor(d);
      case 1: return this.dotVert(d);
      case 2: return this.lineHor(d);
      case 3: return this.lineVert(d);
      case 4: return this.spike(d, false);
      case 5: return this.spike(d, true);
      case 6: return this.walk(d);
      case 7: return this.fall(d);
      case 8: return this.lissa(d);
      case 9: return this.light(d);
      case 10: return this.fireFlies(d);
      case 11: return this.dotVsSine(d);
      case 12: return this.ringsOfFire(d);
      case 13: return this.fireworks(d);
      case 14: return this.spirograph(d);
      case 15: return this.warp(d);
      case 16: return this.cornerWave(d);
      case 17: return this.laser(d);
      case 18: return this.objects(d);
      case 19: return this.school(d);
      default:
    }
  }

  private dotHor(d: number): void {
    const half = this.w >> 1;
    for (let i = 0; i < 576; i += 1) {
      let v = this.byte(d + i) ^ this.centre;
      this.put(i >> 1, half - (v >> this.scale), this.colour(v));
      v = this.byte(d + 576 + i) ^ this.centre;
      this.put((i + 576) >> 1, half - (v >> this.scale), this.colour(v));
    }
  }

  private dotVert(d: number): void {
    const half = this.w >> 1;
    for (let i = 0; i < this.h - 1; i += 1) {
      let v = this.byte(d + i) ^ this.centre;
      this.put(half - (v >> this.scale), i, this.colour(v));
      v = this.byte(d + 576 + i) ^ this.centre;
      this.put((v >> this.scale) + half, i, this.colour(v));
    }
  }

  /** 1000CC10: both channels side by side from x = 32, joined by columns; centred on y = w/2. */
  private lineHor(d: number): void {
    const half = this.w >> 1;
    for (let ch = 0; ch < 2; ch += 1) {
      for (let i = 0; i < 576; i += 1) {
        const v = this.byte(d + ch * 576 + i) ^ this.centre;
        const x = ((ch ? i + 576 : i) >> 1) + 32;
        this.vline(half - (v >> this.scale), half - (this.lineHorPrev >> this.scale), x, this.colour(v + 128));
        this.lineHorPrev = v;
      }
    }
  }

  private lineVert(d: number): void {
    const half = this.w >> 1;
    let prev0 = 128;
    let prev1 = 128;
    for (let i = 0; i < this.h - 1; i += 1) {
      const v0 = this.byte(d + i) ^ this.centre;
      this.hline(half - (v0 >> this.scale), half - (prev0 >> this.scale), i, this.colour(v0));
      prev0 = v0;
      const v1 = this.byte(d + 576 + i) ^ this.centre;
      this.hline((v1 >> this.scale) + half, (prev1 >> this.scale) + half, i, this.colour(v1));
      prev1 = v1;
    }
  }

  /** 1000CDA0 / 1000CEC0: spikes up from the bottom, 2v >> 2·scale tall. */
  private spike(d: number, hollow: boolean): void {
    const { h } = this;
    for (let i = 0; i < 576; i += 1) {
      for (let ch = 0; ch < 2; ch += 1) {
        let len = ((this.byte(d + ch * 576 + i) ^ this.centre) * 2) >> (2 * this.scale);
        if (len >= h - 1) len = h - 2;
        const x = ((ch ? i + 576 : i) >> 1) + 32;
        for (let k = 0; k < len; k += 1) this.put(x, h - 1 - k, this.colour(hollow ? len : k));
      }
    }
  }

  private walk(d: number): void {
    this.walking = (this.walking + 1) % this.w;
    const off = this.walking;
    let prev0 = 128;
    let prev1 = 128;
    for (let i = 0; i < this.h - 1; i += 1) {
      const v0 = this.byte(d + i) ^ this.centre;
      this.hline(off - (v0 >> this.scale), off - (prev0 >> this.scale), i, this.colour(v0));
      prev0 = v0;
      const v1 = this.byte(d + 576 + i) ^ this.centre;
      this.hline((v1 >> this.scale) + off, (prev1 >> this.scale) + off, i, this.colour(v1));
      prev1 = v1;
    }
  }

  private fall(d: number): void {
    this.falling = (this.falling + 1) % (this.h - 1);
    const row = this.falling;
    const half = this.w >> 1;
    for (let i = 0; i < half; i += 1) {
      this.put(i, row + 1, this.colour(this.byte(d + i) ^ this.centre));
      this.put(half + i, row + 1, this.colour(this.byte(d + 576 + i) ^ this.centre));
      this.put(i, row, this.colour(this.byte(d + 160 + i) ^ this.centre));
      this.put(half + i, row, this.colour(this.byte(d + 736 + i) ^ this.centre));
    }
  }

  private lissa(d: number): void {
    for (let i = 0; i < 576; i += 1) {
      const v0 = this.byte(d + i) ^ this.centre;
      const v1 = this.byte(d + 576 + i) ^ this.centre;
      this.put((v1 + 32) % 576, (v0 + 172) % (this.h - 1), this.colour(v0));
    }
  }

  /** 1000D280: two lightning paths from x = 100 and x = 200, in colour 255. */
  private light(d: number): void {
    const { w } = this;
    for (let ch = 0; ch < 2; ch += 1) {
      let x = ch ? 200 : 100;
      for (let i = 0; i < this.h - 1; i += 1) {
        let nx = (((this.byte(d + ch * 576 + i) ^ this.centre) - 127) >> 4) + x;
        if (nx >= w) nx = w - 1;
        if (nx < 0) x = 0;
        nx %= w;
        this.hline(nx, x, i, 255);
        x = nx;
      }
    }
  }

  /** 1000D350 "FireFlies": two swarms, each a scatter of (right/4, left/4), wandering. */
  private fireFlies(d: number): void {
    const { h } = this;
    const c = this.centre;
    const f = this.fireflies;
    f[0] = f[0]! + ((this.byte(d) ^ c) % 9) - 4;
    let y1 = f[1]! + ((this.byte(d + 576) ^ c) % 9) - 4;
    f[2] = f[2]! + ((this.byte(d + 1) ^ c) % 9) - 4;
    f[3] = f[3]! + ((this.byte(d + 577) ^ c) % 9) - 4;
    if (f[0]! < 0) f[0] = f[0]! + 576 * Math.floor((575 - f[0]!) / 576);
    while (y1 < 0) y1 += h - 1;
    if (f[2]! < 0) f[2] = f[2]! + 576 * Math.floor((575 - f[2]!) / 576);
    while (f[3]! < 0) f[3] = f[3]! + h - 1;
    f[0] = f[0]! % 576;
    f[2] = f[2]! % 576;
    f[1] = y1 % h;
    f[3] = f[3]! % h;
    for (let k = 0; k < 576; k += 1) {
      const v = this.byte(d + k) ^ c;
      this.put((((c >> 2) ^ (this.byte(d + 576 + k) >> 2)) + f[0]!) % 576, ((v >> 2) + f[1]!) % (h - 1), this.colour(v));
      this.put((((c >> 2) ^ (this.byte(d + 576 + ((k + 80) % 576)) >> 2)) + f[2]!) % 576, ((v >> 2) + f[3]!) % (h - 1), this.colour(v));
    }
  }

  /** 1000D580 "Dot VS sine": one sine arch per channel, as tall as the sound is rough. */
  private dotVsSine(d: number): void {
    const { w, h } = this;
    const half = w >> 1;
    let a0 = Math.trunc((2 * this.roughness(d)) / half) + 100;
    let a1 = Math.trunc((2 * this.roughness(d + 576)) / half) + 100;
    if (a0 >= h - 1) a0 = h - 1;
    if (a1 >= h - 1) a1 = h - 1;
    for (let x = 0; x < half; x += 1) {
      this.put(x, h - 1 - (Math.abs(a0 * this.sineW[x]!) >> 8), this.colour(this.byte(d + x) ^ this.centre));
    }
    for (let x = half; x < w; x += 1) {
      this.put(x, h - 1 - (Math.abs(a1 * this.sineW[x]!) >> 8), this.colour(this.byte(d + 576 + x) ^ this.centre));
    }
  }

  /** 1000D720 "Rings of Fire": two rings of radius v/4 drifting with the sound. */
  private ringsOfFire(d: number): void {
    const { w, h } = this;
    const c = this.centre;
    const r = this.aaron;
    if (this.aaronFirst) {
      this.aaronFirst = false;
      const t = Math.trunc((w - 256) / 2);
      r[0] = t + 192;
      r[1] = t + 64;
      const t2 = Math.trunc((h - 257) / 2);
      r[2] = t2 + 128;
      r[3] = t2 + 128;
    }
    let sumA = 0;
    let sumB = 0;
    let sumC = 0;
    let sumD = 0;
    for (let k = 0; k < w; k += 1) {
      if (this.aaronB >= 320) this.aaronB -= 320;
      if (this.aaronA >= 320) this.aaronA -= 320;
      const sa = this.sine640[this.aaronA]!;
      const sb = this.sine640[this.aaronB]!;
      const v0 = this.byte(d + k) ^ c;
      const ax = (sa * v0) >> 9;
      const ay = (sb * v0) >> 9;
      sumA += ax;
      sumB += ay;
      this.put(ax + r[0]!, ay + r[2]!, this.colour(v0));
      const v1 = this.byte(d + 576 + k) ^ c;
      const bx = (sa * v1) >> 9;
      const by = (sb * v1) >> 9;
      sumC += bx;
      sumD += by;
      this.put(r[1]! - bx, r[3]! - by, this.colour(v1));
      this.aaronA += 1;
      this.aaronB += 1;
    }
    r[0] = (Math.trunc((3 * sumA) / w) + r[0]! + 1) % w;
    r[1] = (Math.trunc((3 * sumC) / w) + r[1]! + 1) % w;
    r[2] = (Math.trunc((3 * sumB) / w) + r[2]! + 1) % h;
    r[3] = (Math.trunc((3 * sumD) / w) + r[3]! + 1) % h;
    if (r[0]! < 0) r[0] = r[0]! + w;
    if (r[1]! < 0) r[1] = r[1]! + w;
    if (r[2]! < 0) r[2] = r[2]! + h;
    if (r[3]! < 0) r[3] = r[3]! + h;
  }

  /** 1000D9C0 "Fire works": 20 rockets (every 21st particle) and their sparks. */
  private fireworks(d: number): void {
    const { w, h } = this;
    const random = this.random;
    if (!this.pyroInit) {
      this.pyroInit = true;
      for (const p of this.particles) p.state = -1;
      this.gravity = ftol(Math.floor(Math.sqrt(2 * h))) - 1;
    }
    let { peak, level } = this.peak(d);
    for (let j = 0; j < 420; j += 1) {
      const rocket = j % 21 === 0;
      const p = this.particles[j]!;
      if (p.state !== -1) {
        const nx = p.x + p.vx;
        const ny = p.y + p.vy;
        this.line(p.x, p.y, nx, ny, this.colour(p.colour));
        if (rocket) this.line(p.x + 1, p.y, nx + 1, ny, this.colour(p.colour));
        if (nx < 0 || nx > w) p.vx = -p.vx;
        if (rocket || p.state % 6 === 0) p.vy += 1;
        p.x = nx;
        p.y = ny;
        p.state += 1;
        if (rocket && p.vy > 5) {
          p.state = -1;
          continue;
        }
        const ripe = peak >= Math.trunc(level / 2) && p.vy >= -5 && rocket;
        if (!ripe && ny >= 0 && p.state !== -1) continue;
        p.state = -1;
        if (!rocket) continue;
        for (let k = 1; k <= 19; k += 1) {
          const q = this.particles[j + k]!;
          q.x = p.x;
          q.y = p.y;
          const a = random.rand() % 360;
          if (level === 0) throw new WaveFault("Fire works: division by zero");
          const reach = Math.trunc((peak * 4) / level) + 4;
          const r = random.rand() % reach;
          const rad = a * 0.017453292519943295;
          q.vx = ftol(Math.cos(rad) * r);
          q.vy = ftol(Math.sin(rad) * r - 2);
          q.state = -21;
          q.colour = random.rand() & 255;
        }
      } else if (peak > 10 && rocket) {
        p.state = 0;
        p.x = random.rand() % w;
        p.y = h - 4;
        p.vx = (random.rand() % 20) - 10;
        if (level === 0) throw new WaveFault("Fire works: division by zero");
        p.vy = -Math.trunc((this.gravity * peak) / level);
        p.colour = random.rand() & 255;
        peak = Math.trunc((peak * 3) / 4);
      }
    }
  }

  /** 1000DCC0 "Spirograph": an epicycle of 320 segments, the outer circle sized by the sound. */
  private spirograph(d: number): void {
    const { w, h } = this;
    const random = this.random;
    const S = this.sine640;
    this.spiralColour = (this.spiralColour + 1) & 255;
    this.spiralPhase = (this.spiralPhase + 1) % 320;
    if (this.spiralTimer <= 0) {
      this.spiralTimer = random.rand() % 1000;
      this.spiralMult = (random.rand() & 7) + 2;
    }
    this.spiralTimer -= 1;
    const m = w < h ? w : h;
    const cx = Math.trunc(w / 2);
    const cy = Math.trunc(h / 2);
    const s0 = Math.trunc(this.roughness(d) / 288);
    const s1 = Math.trunc(this.roughness(d + 576) / 288);
    let amp = Math.trunc((s0 + s1) / 2);
    if (amp < this.spiralAmp - 10) amp = this.spiralAmp - 10;
    this.spiralAmp = amp;
    const C1 = 3.0517578125e-5;
    const C2 = -0.5;
    const A = amp * m * C1;
    const B = s0 * m * C1;
    const D = s1 * m * C1;
    const ph = this.spiralPhase;
    const mult = this.spiralMult;
    let px = S[(ph + 120) % 320]! * A - S[120]! * B * C2;
    let py = S[ph]! * A - S[0]! * D * C2;
    const colour = this.colour(this.spiralColour);
    for (let i = 1; i < 320; i += 1) {
      const x = S[(ph + i + 120) % 320]! * A - S[(mult * i + 120) % 320]! * B * C2;
      const y = S[(ph + i) % 320]! * A - S[(mult * i) % 320]! * D * C2;
      this.line(ftol(px + cx), ftol(py + cy), ftol(x + cx), ftol(y + cy), colour);
      px = x;
      py = y;
    }
  }

  /** 1000DFE0 "Space warp": up to 20 polygons widening from the middle, born on peaks. */
  private warp(d: number): void {
    const random = this.random;
    if (this.warpFirst) {
      this.warpFirst = false;
      for (const ring of this.warpRings) ring.r = -1;
      this.warpX = Math.trunc(this.w / 2);
      this.warpY = Math.trunc(this.h / 2);
      this.warpMax = this.warpX > this.warpY ? this.warpX : this.warpY;
    }
    let { peak, level } = this.peak(d);
    for (const ring of this.warpRings) {
      if (ring.r !== -1) {
        const r2 = ring.r + ring.dr;
        const a2 = ring.angle + ring.dangle;
        if (ring.n > 0) {
          for (let k = 0, acc = 0; k < ring.n; k += 1, acc += 360) {
            const t = Math.trunc(acc / ring.n);
            const x1 = ftol(this.sind(t + ring.angle) * ring.r) + this.warpX;
            const y1 = ftol(this.sind(t + ring.angle + 90) * ring.r) + this.warpY;
            const x2 = ftol(this.sind(t + a2) * r2) + this.warpX;
            const y2 = ftol(this.sind(t + a2 + 90) * r2) + this.warpY;
            this.line(x1, y1, x2, y2, this.colour(ring.colour));
          }
        }
        ring.r += ring.dr;
        ring.angle += ring.dangle;
        ring.dr -= ring.decel;
        if (ring.r > this.warpMax || ring.r < 0) ring.r = -1;
      } else if (peak !== 0) {
        if (peak * 4 > level) level = peak * 4;
        if (level > 30) level -= 1;
        ring.r = 0;
        ring.dr = Math.trunc((peak * 20) / level) + 3;
        ring.n = Math.trunc((peak * 40) / level) + 1;
        ring.angle = random.rand() % 320;
        const turn = Math.trunc((((random.rand() % 14) - 7) * peak) / level);
        ring.dangle = (random.rand() & 3) + turn - 2;
        ring.colour = random.rand() & 255;
        ring.decel = random.rand() & 1;
        peak = 0;
      }
    }
  }

  /** 1000E2A0 "Corner": on a peak, a cross's corner from the edge to a wandering point. */
  private cornerWave(d: number): void {
    const { w, h } = this;
    const random = this.random;
    const s = this.corner;
    let level = Math.trunc((Math.trunc(this.roughness(d + 576) / 288) + Math.trunc(this.roughness(d) / 288)) / 2);
    if (level < s.prev - 9) level = s.prev - 9;
    if (level > s.prev) s.accum += level - s.prev;
    let peak = 0;
    if (level < s.prev) {
      peak = s.accum;
      s.accum = 0;
    }
    s.prev = level;
    s.total += peak;
    if (!peak) return;
    s.x = (((random.rand() % peak) + s.x) % (w - 16)) + 8;
    s.y = (((random.rand() % peak) + s.y) % (h - 16)) + 8;
    const n = (peak & ~3) < 32 ? peak >> 2 : 8;
    const near = (random.rand() & 1) !== 0;
    for (let k = 0; k < n; k += 1) {
      const c = 255 >> k;
      for (let x = near ? 0 : s.x; x < (near ? s.x : w); x += 1) {
        this.put(x, s.y + k, c);
        this.put(x, s.y - k, c);
      }
      for (let y = near ? 0 : s.y; y < (near ? s.y : h); y += 1) {
        this.put(s.x - k, y, c);
        this.put(s.x + k, y, c);
      }
    }
  }

  /** 1000E580 "Laser": w/10 beams from the middle to wandering points on the top and bottom. */
  private laser(d: number): void {
    const { w, h } = this;
    const c = this.colour(255);
    const cx = Math.trunc(w / 2);
    const cy = Math.trunc(h / 2);
    for (let k = 0; k < Math.trunc(w / 10); k += 1) {
      this.line(cx, cy, this.laser1, k, c);
      this.laser1 = (Math.abs(this.byte(d + k) - this.byte(d + k + 1)) + this.laser1) % w;
      this.line(cx, cy, this.laser2, h - k, c);
      this.laser2 = (Math.abs(this.byte(d + 576 + k) - this.byte(d + 577 + k)) + this.laser2) % w;
    }
  }

  /**
   * 1000E6B0 "Rotating objects": the letter in hand turning about the upright, each segment's
   * ends pushed nearer or farther by a slice of each channel; three strokes thick.
   */
  private objects(d: number): void {
    const obj = this.object;
    if (!obj) {
      this.wave = 0;
      return;
    }
    const { w, h } = this;
    this.angle -= 0.06981317007977318;
    let maxX = 0;
    let maxY = 0;
    let maxZ = 0;
    const count = Math.trunc(obj.length / 6);
    for (let s = 0; s < count; s += 1) {
      for (let e = 0; e < 2; e += 1) {
        const at = s * 6 + e * 3;
        if (obj[at]! > maxX) maxX = obj[at]!;
        if (obj[at + 1]! > maxY) maxY = obj[at + 1]!;
        if (obj[at + 2]! > maxZ) maxZ = obj[at + 2]!;
      }
    }
    let biggest = maxX > maxY ? maxX : maxY;
    if (biggest <= maxZ) biggest = maxZ;
    const M = biggest + 1;
    const small = h < w ? h : w;
    const scale = (small * 0.9) / M;
    const offX = Math.trunc(w / 2) - Math.trunc(maxX / 2);
    const offY = Math.trunc(h / 2) - Math.trunc(maxY / 2);
    const cxO = maxX * 0.5;
    const cyO = maxY * 0.5;
    const czO = maxZ * 0.5;
    const sn = Math.sin(this.angle);
    const cs = Math.cos(this.angle);
    if (count <= 0) return;
    const C5 = 0.020833333333333332;
    const colour = this.colour(255);
    const c = this.centre;
    let dp = d + 576;
    for (let s = 0; s < count; s += 1) {
      const n = Math.trunc(w / count);
      let s0 = 0;
      let s1 = 0;
      for (let j = 0; j < n; j += 1) {
        s0 += Math.abs(Math.trunc((this.byte(dp - 576 + j) ^ c) / 4) + 192);
        s1 += Math.abs(Math.trunc((this.byte(dp + j) ^ c) / 4) + 192);
      }
      const at = s * 6;
      const x1c = obj[at]! - cxO;
      const y1c = obj[at + 1]! - cyO;
      const z1c = obj[at + 2]! - czO;
      const f0 = (s0 / n) * scale * C5;
      const z1r = z1c * cs - x1c * sn;
      const x1r = x1c * cs + z1c * sn;
      const sx1 = ftol((x1r * f0) / (z1r + M) + offX);
      const sy1 = ftol((f0 * y1c) / (z1r + M) + offY);
      const x2c = obj[at + 3]! - cxO;
      const y2c = obj[at + 4]! - cyO;
      const z2c = obj[at + 5]! - czO;
      const f1 = (s1 / n) * scale * C5;
      const z2r = z2c * cs - x2c * sn;
      const x2r = x2c * cs + z2c * sn;
      const sx2 = ftol((x2r * f1) / (z2r + M) + offX);
      const sy2 = ftol((f1 * y2c) / (z2r + M) + offY);
      this.line(sx1, sy1, sx2, sy2, colour);
      this.line(sx1 + 1, sy1 + 1, sx2 + 1, sy2 + 1, colour);
      this.line(sx1 - 1, sy1 - 1, sx2 - 1, sy2 - 1, colour);
      dp += count;
    }
  }

  /** 1000EAB0 "School of fish": 30 boids following a leader that turns on the peaks. */
  private school(d: number): void {
    const { w, h } = this;
    const random = this.random;
    const { peak, level } = this.peak(d);
    if (peak >= level - 1) this.schoolRespawn += 1;
    if (this.schoolRespawn >= 2) {
      const f = this.fish[this.schoolNext]!;
      this.schoolRespawn = 0;
      f.vx = 0;
      f.vy = 0;
      f.x = random.rand() % w;
      f.y = random.rand() % h;
      f.colour = random.rand() & 255;
      this.schoolNext = (this.schoolNext + 1) % 30;
    }
    if (!this.schoolInit) {
      this.schoolInit = true;
      for (const f of this.fish) {
        f.vx = 0;
        f.vy = 0;
        f.x = random.rand() % w;
        f.y = random.rand() % h;
        f.colour = random.rand() & 255;
      }
    }
    this.schoolHeading += (random.rand() % 7) - 2;
    this.schoolSpeed = ftol(this.schoolSpeed * 0.5);
    if (peak > Math.trunc(level / 4)) {
      const r = random.rand();
      this.schoolSpeed = ftol(((w * 0.0125) * peak) / level + this.schoolSpeed);
      this.schoolHeading = r % 360;
    }
    const heading = this.schoolHeading * 0.017453292519943295;
    const leadX = Math.cos(heading) * this.schoolSpeed;
    const leadY = Math.sin(heading) * this.schoolSpeed;
    const halfW = Math.trunc(w / 2);
    const halfH = Math.trunc(h / 2);
    for (let i = 0; i < 30; i += 1) {
      const f = this.fish[i]!;
      let nx = ftol(f.x + f.vx);
      if (nx < 0) {
        nx = w;
        f.x = w;
      } else if (nx > w) {
        nx = 0;
        f.x = 0;
      }
      let ny = ftol(f.y + f.vy);
      if (ny < 0) {
        ny = h;
        f.y = h;
      } else if (ny > h) {
        ny = 0;
        f.y = 0;
      }
      const c = this.colour(f.colour);
      this.line(f.x, f.y, nx, ny, c);
      this.line(f.x + 1, f.y, nx + 1, ny, c);
      f.x = nx;
      f.y = ny;
      let near = 0;
      let sdx = 0;
      let sdy = 0;
      for (let j = 0; j < 30; j += 1) {
        if (j === i) continue;
        const o = this.fish[j]!;
        let dx = o.x - nx;
        if (dx > halfW) dx -= w;
        else if (dx < -halfW) dx += w;
        let dy = o.y - ny;
        if (dy > halfH) dy -= h;
        else if (dy < -halfH) dy += h;
        const d2 = dx * dx + dy * dy;
        if (d2 < 40000) {
          near += 1;
          sdx += dx;
          sdy += dy;
          f.vx -= (2 * dx) / d2;
          f.vy -= (2 * dy) / d2;
        }
      }
      f.vx -= (sdx / (near + 1)) * -0.01;
      f.vy -= (sdy / (near + 1)) * -0.01;
      f.vx = (f.vx - ((random.rand() % 22) - 10) * -0.1 + leadX) * 0.98;
      f.vy = (f.vy - ((random.rand() % 22) - 10) * -0.1 + leadY) * 0.98;
    }
  }
}
