/*
 * APE "Tentacles 3D" — amoeba3d.ape by Steven Wittens (UnConeD), "Render / Tentacles 3D"
 * (PE timestamp 30 Mar 2002).
 * Binary sha256 a53bac33a7dbcfd20daa83895ebdd8bda0ada787beefcca429e596bfe643d93a.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/amoeba3d.md.
 *
 * Config (load_config 0x10007930; save_config 0x10007980 always writes 72 bytes): when len <= 72 the
 * bytes are memcpy'd over the defaults, otherwise ignored; then count is clamped to 1..16.
 *   +0..+63  colors[16]  int32 0x00RRGGBB      default colors[0] = 0x007FFF, the rest 0
 *   +64      count       "Cycle through N colours (1-16)"   default 1
 *   +68      onBeat      "OnBeat Change" (any non-zero = on) default 0
 *
 * What it draws (render 0x10002CE0, always returns 0, draws over the framebuffer):
 * six tubes ("tentacles") of 30 segments with a 4-point (square) cross-section, rooted at
 * (0,0,23) in front of the camera and pointing initially along ±x, ±y, ±z. Every frame each tube's
 * direction history is shifted outward and a new root direction (the axis rotated by three
 * music-driven angles) is pushed in, so the tubes wriggle. Vertices are lit by two moving point
 * lights (diffuse + a sharp specular highlight; beats send a bright pulse along the tubes), the
 * colour cycles through the configured colours, and the triangles are rasterised with Gouraud
 * shading, a 16-bit 1/z buffer and a one-pixel near-black (0x010101) outline wherever a span
 * borders pixels not yet covered this frame. Projection: x' = x*F/z, y' = y*F/z with
 * F = zoom*min(w/2, h/2), zoom = 1.2 on every second beat, relaxing back to 1.
 * The whole pipeline is ported operation by operation (see the notes): integer fixed-point
 * rasteriser (8.8 edges, idiv truncation, 32-bit wrap via Math.imul), x87 maths in IEEE double
 * with the binary's operation order, the binary's bugs kept (the left-clip of a span shifts the
 * already-scaled values again and uses dz for blue; the off-screen test compares world, not
 * screen, coordinates; on-beat colour pick uses rand()*n/65536).
 *
 * Randomness: the constructor calls srand(GetTickCount()) and draws 12 rand() values (initial
 * angles, light phases, spin directions); beats draw more from the same static-CRT generator.
 * The port seeds ctx.makeRand(ctx.now()) on the first render and draws everything from it
 * (equivalent to the effect being created on the rendering thread; with the plug-in's per-thread
 * CRT state, creation on another thread would give the render thread its own sequence).
 *
 * Approximation: Math.sin/cos replace x87 fsin/fcos (can differ in the last bit; matters only
 * when a truncated value sits exactly on an integer). Assumes the default 53-bit FPU precision.
 * AVS's line blend mode is not used (no AVS_APE_SetExtInfo export); isBeat is used as a boolean.
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

export interface Tentacles3DConfig {
  colors: number[];   // 16 entries
  count: number;      // 1..16
  onBeat: number;
}

/** load_config (0x10007930) over the constructor's defaults (0x10001300). */
export function parseTentacles3DConfig(config: Uint8Array): Tentacles3DConfig {
  const raw = new Uint8Array(72);
  const dv = new DataView(raw.buffer);
  dv.setInt32(0, 0x7fff, true);
  dv.setInt32(64, 1, true);
  if (config.length <= 72) raw.set(config);
  const colors: number[] = [];
  for (let i = 0; i < 16; i++) colors.push(dv.getInt32(4 * i, true));
  let count = dv.getInt32(64, true);
  if (!(count < 16)) count = 16;
  if (!(count > 1)) count = 1;
  return { colors, count, onBeat: dv.getInt32(68, true) };
}

const NT = 6;            // tentacles
const NS = 30;           // segments per tentacle
const NV = 744;          // vertices: per tentacle 4 root copies + 30 rings of 4
const NF = 1440;         // faces: per tentacle 30 * 4 * 2
const OUTLINE = 0x010101;

/** float → int as the CRT helper 0x10007FD8 does it (chop to int64, low 32 bits). */
function ftol(v: number): number { return v | 0; }
/** idiv: truncating 32-bit division. */
function idiv(a: number, b: number): number { return (a / b) | 0; }

/** Per-channel (c*a>>8) + (d*(255-a)>>8) (method 0x10006830's colour mix, same as Amoeba's). */
export function mixColor(c: number, d: number, alpha: number): number {
  const a = alpha & 0xff;
  const ia = (255 - a) & 0xff;
  const s = ((((c & 0xff00ff) * a) & 0xff00ffff) | (((c & 0xff00) * a) & 0xff0000)) >>> 8;
  const t = ((((d & 0xff00ff) * ia) & 0xff00ffff) | (((d & 0xff00) * ia) & 0xff0000)) >>> 8;
  return (s + t) | 0;
}

/**
 * 0x10002B80 with mode 0: spectrum level around `center` (fraction of 576 bins) with `width`.
 * width == 0 picks one bin; otherwise bins [trunc((2c-w)*288), trunc((w+2c)*288)) clamped, each
 * bin (L+R)>>1, averaged with truncation.
 */
export function bandLevel(vis: Uint8Array, center: number, width: number): number {
  if (width === 0) {
    let i = ftol(center * 576.0);
    if (!(i > 0)) i = 0;
    if (!(i < 575)) i = 575;
    return (vis[i + 576]! + vis[i]!) >> 1;
  }
  const twoC = center * 2.0;
  let start = ftol((twoC - width) * 288.0);
  if (!(start > 0)) start = 0;
  if (!(start < 575)) start = 575;
  let end = ftol((width + twoC) * 288.0);
  if (!(end > start + 1)) end = start + 1;
  if (!(end < 576)) end = 576;
  let sum = 0;
  for (let i = start; i < end; i++) sum += (vis[i + 576]! + vis[i]!) >> 1;
  return idiv(sum, end - start);
}

/** 0x100034F0: rotate about y by b, then about x by a, then about z by c (in place order). */
export function rotateVec(x: number, y: number, z: number, a: number, b: number, c: number): [number, number, number] {
  const cb = Math.cos(b), sb = Math.sin(b);
  const x1 = x * cb - z * sb;
  const z1 = cb * z + sb * x;
  const ca = Math.cos(a), sa = Math.sin(a);
  const y1 = y * ca - z1 * sa;
  const z2 = ca * z1 + sa * y;
  const cc = Math.cos(c), sc = Math.sin(c);
  const y2 = y1 * cc - x1 * sc;
  const x2 = sc * y1 + cc * x1;
  return [x2, y2, z2];
}

/** Face topology built by 0x100039D0 (identical every frame): per tentacle t, segment j, corner k. */
export function buildFaces(): Int32Array {
  const f = new Int32Array(NF * 3);
  let n = 0;
  for (let t = 0; t < NT; t++) {
    for (let j = 0; j < NS; j++) {
      const base = 124 * t + 4 * j;
      for (let k = 0; k < 4; k++) {
        const k1 = (k + 1) % 4;
        f[n++] = base + k; f[n++] = base + k1; f[n++] = base + 4 + k;
        f[n++] = base + 4 + k1; f[n++] = base + 4 + k; f[n++] = base + k1;
      }
    }
  }
  return f;
}

const AXES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** A vertex as the rasteriser sees it (position, the stored "normal", colour). */
interface RVert { x: number; y: number; z: number; nx: number; ny: number; nz: number; col: number; }

export class Tentacles3D implements ApeEffect {
  readonly cfg: Tentacles3DConfig;
  rand: (() => number) | null = null;
  // object fields (offsets of the original object in the names)
  whKey = 0;                  // 0x50
  time = 0;                   // 0x54
  lvlBass = 0; lvlMid = 0; lvlHigh = 0;    // 0x58 0x5C 0x60
  velBass = 0; velMid = 0; velHigh = 0;    // 0x64 0x68 0x6C
  zbuf: Uint16Array = new Uint16Array(0);  // 0x70
  beats = 0;                  // 0x8C
  spinX = 0; spinY = 0; spinZ = 0;         // 0x90 0x98 0xA0 (smoothed)
  dirX = 0; dirY = 0; dirZ = 0;            // 0xA8 0xB0 0xB8 (±1 targets)
  zoom = 1.0;                 // 0xC0
  angA = 0; angB = 0; angC = 0;            // 0xC8 0xD0 0xD8
  colorPos = 0;               // 0xE0
  l1x = 0; l1y = 0; l1z = 0;               // 0xE8 0xF0 0xF8 (light 1 phases)
  l2x = 0; l2y = 0; l2z = 0;               // 0x120 0x128 0x130 (light 2 phases)
  // tentacle direction history (0x84): 180 entries
  ent = new Float64Array(NT * NS * 3);
  entBeat = new Int32Array(NT * NS);
  // vertices (0x74)
  vx = new Float64Array(NV); vy = new Float64Array(NV); vz = new Float64Array(NV);
  vnx = new Float64Array(NV); vny = new Float64Array(NV); vnz = new Float64Array(NV);
  vcount = new Int32Array(NV);
  vbeat = new Int32Array(NV);
  vcol = new Int32Array(NV);
  readonly faces = buildFaces();

  constructor(config: Uint8Array) {
    this.cfg = parseTentacles3DConfig(config);
  }

  /** The constructor's random draws (0x10001300), done on the first render with the context's generator. */
  private initRandom(ctx: ApeContext): void {
    const r = ctx.makeRand(ctx.now() >>> 0);
    this.rand = r;
    this.angA = r() * 100; this.angB = r() * 100; this.angC = r() * 100;
    this.l1x = r() * 100; this.l1y = r() * 100; this.l1z = r() * 100;
    this.l2x = r() * 100; this.l2y = r() * 100;
    this.zoom = 1.0; this.colorPos = 0;
    this.l2z = r() * 100;
    this.dirX = (r() & 1) * 2 - 1;
    this.dirY = (r() & 1) * 2 - 1;
    this.dirZ = (r() & 1) * 2 - 1;
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    if (!this.rand) this.initRandom(ctx);
    const rand = this.rand as () => number;
    const { w, h } = ctx;
    const n = this.cfg.count;

    this.time = (this.time + ftol(this.zoom * 10.0 + 1.0)) | 0;
    this.colorPos = this.colorPos + 0.015;
    if (!(n > this.colorPos)) this.colorPos = 0;
    this.spinX = this.spinX * 0.7 + this.dirX * 0.3;
    this.spinY = this.spinY * 0.7 + this.dirY * 0.3;
    this.spinZ = this.spinZ * 0.7 + this.dirZ * 0.3;
    if (ctx.isBeat) {
      this.beats = (this.beats + 1) | 0;
      if (this.cfg.onBeat) this.colorPos = Math.imul(rand(), n) * 1.52587890625e-5;
      if (!(n > this.colorPos)) this.colorPos = 0;
      if (this.beats % 2 !== 0) {
        this.dirX = (rand() & 1) * 2 - 1;
        this.dirY = (rand() & 1) * 2 - 1;
        const r = rand();
        this.zoom = 1.2;
        this.dirZ = (r & 1) * 2 - 1;
        this.l1x = (rand() % 100) * 0.2 + this.l1x;
        this.l1y = (rand() % 100) * 0.2 + this.l1y;
        this.l1z = (rand() % 100) * 0.2 + this.l1z;
        this.l2x = (rand() % 100) * 0.2 + this.l2x;
        this.l2y = (rand() % 100) * 0.2 + this.l2y;
        this.l2z = (rand() % 100) * 0.2 + this.l2z;
      }
    }
    this.zoom = this.zoom * 0.9 + 0.1;

    const key = ((h << 16) + w) | 0;
    if (this.whKey !== key || this.zbuf.length !== 2 * w * h + 2) {
      this.whKey = key;
      this.zbuf = new Uint16Array(2 * w * h + 2);
    } else {
      this.zbuf.fill(0);
    }

    const vis = ctx.visdataUnsigned;
    const a = bandLevel(vis, 0.0, 0.007);
    this.lvlBass = idiv(2 * a + this.lvlBass, 2);
    this.velBass = idiv(this.lvlBass - a + this.velBass, 2);
    const c = bandLevel(vis, 0.07, 0.07);
    this.lvlMid = idiv(2 * c + this.lvlMid, 2);
    this.velMid = idiv(2 * (this.lvlMid - c) + this.velMid, 2);
    const e = bandLevel(vis, 0.2, 0.3);
    this.lvlHigh = idiv(2 * e + this.lvlHigh, 2);
    this.velHigh = idiv(3 * (this.lvlHigh - e) + this.velHigh, 2);

    const T = this.time;
    let s = (Math.sin(T * 0.001) * 0.5 + 0.5) * 0.0361 + (this.velBass > 0 ? this.velBass : 0) * 0.000305
      + this.lvlBass * 0.0002;
    if (!(0.15 > s)) s = 0.15;
    this.angA = s * this.spinX + this.angA;
    s = (Math.sin(T * 0.00171) * 0.5 + 0.5) * 0.032 + (this.velMid > 0 ? this.velMid : 0) * 0.0002;
    if (!(0.15 > s)) s = 0.15;
    this.angB = s * this.spinY + this.angB;
    s = (Math.sin(T * 0.001213) * 0.5 + 0.5) * 0.033 + (this.velHigh > 0 ? this.velHigh : 0) * 0.0002;
    if (!(0.15 > s)) s = 0.15;
    this.angC = s * this.spinZ + this.angC;

    let q = Math.sin(T * 0.012);
    const wobA = Math.sin(T * 0.00271) * 0.021 + Math.sqrt(Math.abs(q)) * this.velBass * (q < 0 ? -1.0 : 1.0) * 0.00075;
    q = Math.sin(T * 0.00412);
    const wobB = Math.sin(T * 0.00418) * 0.0223 + Math.sqrt(Math.abs(q)) * this.velMid * (q < 0 ? -1.0 : 1.0) * 0.00075;
    q = Math.sin(T * 0.00614);
    const wobC = Math.sin(T * 0.003211) * 0.0189 + Math.sqrt(Math.abs(q)) * this.velHigh * (q < 0 ? -1.0 : 1.0) * 0.00075;
    this.l1x = this.l1x + wobA;
    this.l1y = this.l1y + wobB;
    this.l1z = this.l1z + wobC;
    this.l2x = this.l2x + wobB;
    this.l2y = wobC + this.l2y;
    this.l2z = this.l2z + wobA;

    this.updateEntries(ctx.isBeat);
    this.buildVertices();
    this.light();

    const f = this.faces;
    const p0: RVert = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, col: 0 };
    const p1: RVert = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, col: 0 };
    const p2: RVert = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, col: 0 };
    for (let k = 0; k < NF; k++) {
      this.loadVert(p0, f[3 * k]!);
      this.loadVert(p1, f[3 * k + 1]!);
      this.loadVert(p2, f[3 * k + 2]!);
      rasterTriangle(framebuffer, this.zbuf, w, h, this.zoom, p0, p1, p2);
    }
    return 0;
  }

  private loadVert(p: RVert, i: number): void {
    p.x = this.vx[i]!; p.y = this.vy[i]!; p.z = this.vz[i]!;
    p.nx = this.vnx[i]!; p.ny = this.vny[i]!; p.nz = this.vnz[i]!;
    p.col = this.vcol[i]!;
  }

  /** 0x100035A0: beat smoothing of tentacle 0 only, then shift every history and push new roots. */
  updateEntries(isBeat: boolean): void {
    const eb = this.entBeat, en = this.ent;
    for (let pass = 0; pass < 5; pass++) {
      for (let k = NS - 1; k >= 1; k--) eb[k] = idiv(eb[k - 1]! + eb[k]!, 2);
    }
    const beatVal = isBeat ? 255 : 0;
    for (let t = 0; t < NT; t++) {
      const b = NS * t;
      for (let k = NS - 1; k >= 1; k--) {
        en[3 * (b + k)] = en[3 * (b + k - 1)]!;
        en[3 * (b + k) + 1] = en[3 * (b + k - 1) + 1]!;
        en[3 * (b + k) + 2] = en[3 * (b + k - 1) + 2]!;
        eb[b + k] = eb[b + k - 1]!;
      }
      const ax = AXES[t]!;
      const r = rotateVec(ax[0], ax[1], ax[2], this.angA, this.angB, this.angC);
      en[3 * b] = r[0]; en[3 * b + 1] = r[1]; en[3 * b + 2] = r[2];
      eb[b] = beatVal;
    }
  }

  /** 0x100039D0: the tube vertices (topology is the constant buildFaces()). */
  buildVertices(): void {
    const en = this.ent;
    let vc = 0;
    for (let t = 0; t < NT; t++) {
      let Ax = 0, Ay = 0, Az = 0;
      for (let qq = 0; qq < 4; qq++) {
        this.vx[vc] = 0; this.vy[vc] = 0; this.vz[vc] = 23.0; this.vbeat[vc] = 0;
        vc++;
      }
      for (let j = 0; j < NS; j++) {
        const ei = NS * t + j;
        Ax = en[3 * ei]! + Ax;
        Ay = en[3 * ei + 1]! + Ay;
        Az = en[3 * ei + 2]! + Az;
        const scl = j * this.zoom * 0.7241379310344828;
        const len = Math.sqrt(Az * Az + Ay * Ay + Ax * Ax);
        const sB = len < 0.05 ? 1.0 : scl / len;
        const Bx = 0.0 + sB * Ax;
        const By = 0.0 + sB * Ay;
        const Bz = 23.0 + sB * Az;
        // U = (A.z, 0, -A.x) (not normalised); V = U x A, normalised
        const Ux = Az, Uy = 0.0, Uz = -Ax;
        let Vx = -(-Ax * Ay);
        let Vy = -Ax * Ax - Az * Az;
        let Vz = Az * Ay;
        const lv = Math.sqrt(Vy * Vy + Vz * Vz + Vx * Vx);
        const iv = lv < 0.05 ? 1.0 : 1.0 / lv;
        Vx = Vx * iv; Vy = Vy * iv; Vz = Vz * iv;
        const radius = j * -0.034482758620689655 + 1.0;
        for (let k = 0; k < 4; k++) {
          // the ring parametrisation at t = k/4 gives exactly U, V, -U, -V
          let Wx: number, Wy: number, Wz: number;
          if (k === 0) { Wx = Ux; Wy = Uy; Wz = Uz; }
          else if (k === 1) { Wx = Vx; Wy = Vy; Wz = Vz; }
          else if (k === 2) { Wx = -Ux; Wy = -Uy; Wz = -Uz; }
          else { Wx = -Vx; Wy = -Vy; Wz = -Vz; }
          const m = Math.sqrt(Wy * Wy + Wz * Wz + Wx * Wx);
          const r = m < 0.05 ? 1.0 : radius / m * 1.7;
          this.vx[vc] = Wx * r + Bx;
          this.vy[vc] = Wy * r + By;
          this.vz[vc] = Wz * r + Bz;
          this.vbeat[vc] = this.entBeat[ei]!;
          vc++;
        }
      }
    }
  }

  /** The base colour of this frame (cycling through the configured colours). */
  baseColor(): number {
    const n = this.cfg.count;
    const colors = this.cfg.colors;
    if (n > 1) {
      const fl = Math.floor(this.colorPos);
      const c1 = colors[ftol(fl)]!;
      const c2 = colors[ftol(Math.ceil(this.colorPos)) % n]!;
      const fr = ftol((this.colorPos - fl) * 255.0) & 0xff;
      return mixColor(c2, c1, fr);
    }
    return colors[0]!;
  }

  /** 0x10006830: face normals → vertex normals, two point lights, per-vertex colour. */
  light(): void {
    const color = this.baseColor();
    const { vx, vy, vz, vnx, vny, vnz, vcount, vbeat, vcol } = this;
    vnx.fill(0); vny.fill(0); vnz.fill(0); vcount.fill(0);
    const f = this.faces;
    for (let k = 0; k < NF; k++) {
      const i0 = f[3 * k]!, i1 = f[3 * k + 1]!, i2 = f[3 * k + 2]!;
      const ax = vx[i0]! - vx[i1]!, ay = vy[i0]! - vy[i1]!, az = vz[i0]! - vz[i1]!;
      const bx = vx[i2]! - vx[i1]!, by = vy[i2]! - vy[i1]!, bz = vz[i2]! - vz[i1]!;
      let nx = bz * ay - by * az;
      let ny = bx * az - bz * ax;
      let nz = by * ax - bx * ay;
      const len = Math.sqrt(nz * nz + ny * ny + nx * nx);
      const inv = len < 0.05 ? 1.0 : 1.0 / len;
      nx = nx * inv; ny = ny * inv; nz = nz * inv;
      for (const v of [i0, i1, i2]) {
        vcount[v]!++;
        vnx[v] = vnx[v]! + nx; vny[v] = vny[v]! + ny; vnz[v] = vnz[v]! + nz;
      }
    }
    const L1x = Math.sin(this.l1x * 0.03) * 13.0;
    const L1y = Math.sin(this.l1y * 0.03) * 13.0;
    const L1z = Math.sin(this.l1z * 0.03) * 13.0 + 27.5;
    const L2x = Math.sin(this.l2x * 0.03) * 15.0;
    const L2y = Math.sin(this.l2y * 0.03) * 15.0;
    const L2z = Math.sin(this.l2z * 0.03) * 15.0 + 27.5;
    const cG = color & 0xff00, cB = color & 0xff, cRB = color & 0xff00ff;
    for (let i = 0; i < NV; i++) {
      const cnt = vcount[i]!;
      let Nx = vnx[i]! / cnt, Ny = vny[i]! / cnt, Nz = vnz[i]! / cnt;
      let len = Math.sqrt(Ny * Ny + Nz * Nz + Nx * Nx);
      let inv = len < 0.05 ? 1.0 : 1.0 / len;
      Nx = inv * Nx; Ny = inv * Ny; Nz = inv * Nz;
      const Px = vx[i]!, Py = vy[i]!, Pz = vz[i]!;
      let D1x = Px - L1x, D1y = Py - L1y, D1z = Pz - L1z;
      len = Math.sqrt(D1y * D1y + D1z * D1z + D1x * D1x);
      inv = len < 0.05 ? 1.0 : 1.0 / len;
      D1x = D1x * inv; D1y = D1y * inv; D1z = D1z * inv;
      let D2x = Px - L2x, D2y = Py - L2y, D2z = Pz - L2z;
      len = Math.sqrt(D2y * D2y + D2z * D2z + D2x * D2x);
      inv = len < 0.05 ? 1.0 : 1.0 / len;
      D2x = D2x * inv; D2y = D2y * inv; D2z = D2z * inv;
      const s2 = D2y * Ny + D2z * Nz + D2x * Nx;
      const s1 = D1y * Ny + D1z * Nz + D1x * Nx;
      const diff = s1 > s2 ? s1 : s2;
      let Vx = Px, Vy = Py, Vz = Pz;
      len = Math.sqrt(Vy * Vy + Vz * Vz + Vx * Vx);
      inv = len < 0.05 ? 1.0 : 1.0 / len;
      Vx = Vx * inv; Vy = Vy * inv; Vz = Vz * inv;
      const d = (Vy * Ny + Vz * Nz + Vx * Nx) * -2.0;
      Nx = Nx * d; Ny = Ny * d; Nz = Nz * d;
      let Rx = Vx + Nx, Ry = Vy + Ny, Rz = Vz + Nz;
      len = Math.sqrt(Ry * Ry + Rz * Rz + Rx * Rx);
      inv = len < 0.05 ? 1.0 : 1.0 / len;
      Rx = Rx * inv; Ry = Ry * inv; Rz = Rz * inv;
      const r1 = Ry * D1y + Rz * D1z + Rx * D1x;
      const r2 = Ry * D2y + Rz * D2z + Rx * D2x;
      const spec = r2 < r1 ? r1 : r2;
      vnx[i] = Nx; vny[i] = Ny; vnz[i] = Nz;   // the rasteriser's cull test reads this scaled normal
      let v = spec * 759.0 - 607.1999999999999;
      if (!(0 < v)) v = 0.0;
      v = v + vbeat[i]!;
      if (!(254.0 > v)) v = 254.0;
      if (!(0 < v)) v = 0.0;
      const sp = ftol(v) & 0xff;
      let dv = diff * 253.0;
      if (!(254.0 > dv)) dv = 254.0;
      if (!(64.0 < dv)) dv = 64.0;
      const df = ftol(dv) & 0xff;
      vcol[i] = shade(df, sp, cG, cB, cRB);
    }
  }
}

/** The per-vertex colour of 0x10006830: per channel min(((c*df>>8)*255>>8) + (sp*255>>8), 255). */
export function shade(df: number, sp: number, cG: number, cB: number, cRB: number): number {
  const sp255 = (sp << 8) - sp;                       // sp*255
  // green: ((g*df & 0xFF0000) >> 8) * 255, & 0xFF0000 >> 16, + (sp*255 << 8 & 0xFF0000) >> 16
  let g = (Math.imul(df, cG) & 0xff0000) >>> 8;
  g = ((Math.imul(g, 255) & 0xff0000) >>> 16) + (((sp255 << 8) & 0xff0000) >>> 16);
  if (g >= 0xff) g = 0xff;
  // blue: ((b*df & 0xFF00) >> 8) * 255, & 0xFF00 >> 8, + (sp*255 & 0xFF00) >> 8
  let b = (Math.imul(df, cB) & 0xff00) >>> 8;
  b = ((Math.imul(b, 255) & 0xff00) >>> 8) + ((sp255 & 0xff00) >>> 8);
  if (b >= 0xff) b = 0xff;
  // red: ((rb*df & 0xFF00FFFF) >> 8) * 255 >> 24, + sp*0xFF00FF >> 24
  let r = (Math.imul(df, cRB) & 0xff00ffff) >>> 8;
  r = (Math.imul(r, 255) >>> 24) + (Math.imul(sp, 0xff00ff) >>> 24);
  if (r >= 0xff) r = 0xff;
  return (r << 16) | (g << 8) | b;
}

/**
 * The triangle rasteriser (virtual method 0x100016C0). v0..v2 are world-space vertices (z ahead),
 * nx..nz the scaled normals used by the cull test, col the vertex colour.
 */
export function rasterTriangle(fb: Int32Array, zb: Uint16Array, w: number, h: number, zoom: number,
                               v0: RVert, v1: RVert, v2: RVert): void {
  const hw = idiv(w, 2), hh = idiv(h, 2);
  const m = hw < hh ? hw : hh;
  if (1.0 > v0.z || 1.0 > v1.z || 1.0 > v2.z) return;
  const Sx = v2.x + v1.x + v0.x, Sy = v2.y + v1.y + v0.y, Sz = v2.z + v1.z + v0.z;
  const Nx = v2.nx + v1.nx + v0.nx, Ny = v2.ny + v1.ny + v0.ny, Nz = v2.nz + v1.nz + v0.nz;
  if (Ny * Sy + Nz * Sz + Nx * Sx > 15.0) return;
  // projected copies
  let P0x: number, P0y: number, P0z = v0.z, P1x: number, P1y: number, P1z = v1.z, P2x: number, P2y: number, P2z = v2.z;
  let C0 = v0.col, C1 = v1.col, C2 = v2.col;
  if (1.0 < P0z) {
    const iz = 1.0 / P0z; P0z = iz;
    const F = zoom * m;
    P0x = iz * F * v0.x; P0y = F * v0.y * iz;
  } else { P0x = -w; P0y = -h; }
  if (1.0 < P1z) {
    const iz = 1.0 / P1z; P1z = iz;
    const F = zoom * m;
    P1x = iz * F * v1.x; P1y = F * v1.y * iz;
  } else { P1x = -w; P1y = -h; }
  if (1.0 < P2z) {
    const iz = 1.0 / P2z; P2z = iz;
    const F = zoom * m;
    P2x = iz * v2.x * F; P2y = v2.y * iz * F;
  } else { P2x = -w; P2y = -h; }
  // off-screen rejection — the binary tests the unprojected world coordinates here
  const t1 = -3 * hw, t2 = 3 * hw, t3 = -3 * hh, t4 = 3 * hh;
  if (t1 > v0.x || !(t2 > v0.x) || t3 > v0.y || !(t4 > v0.y)) return;
  if (!(v1.x >= t1) || !(v1.x < t2) || !(v1.y >= t3) || !(v1.y < t4)) return;
  if (!(v2.x >= t1) || !(v2.x < t2) || !(v2.y >= t3) || !(v2.y < t4)) return;
  // sort by y (three conditional swaps of the whole vertex)
  let tx: number, ty: number, tz: number, tc: number;
  if (P1y < P0y || P1y !== P1y || P0y !== P0y) { tx = P0x; ty = P0y; tz = P0z; tc = C0; P0x = P1x; P0y = P1y; P0z = P1z; C0 = C1; P1x = tx; P1y = ty; P1z = tz; C1 = tc; }
  if (P2y < P1y || P2y !== P2y || P1y !== P1y) { tx = P1x; ty = P1y; tz = P1z; tc = C1; P1x = P2x; P1y = P2y; P1z = P2z; C1 = C2; P2x = tx; P2y = ty; P2z = tz; C2 = tc; }
  if (P1y < P0y || P1y !== P1y || P0y !== P0y) { tx = P0x; ty = P0y; tz = P0z; tc = C0; P0x = P1x; P0y = P1y; P0z = P1z; C0 = C1; P1x = tx; P1y = ty; P1z = tz; C1 = tc; }
  if (!(hh > P0y)) return;
  if (-hh > P2y) return;
  const X0 = (ftol(P0x) + hw) | 0, X1 = (ftol(P1x) + hw) | 0, X2 = (ftol(P2x) + hw) | 0;
  const Y0 = (ftol(P0y) + hh) | 0, Y1 = (ftol(P1y) + hh) | 0, Y2 = (ftol(P2y) + hh) | 0;
  if (Y2 === Y0) return;
  const Z0 = ftol(P0z * 65536.0) & 0xffff, Z1 = ftol(P1z * 65536.0) & 0xffff, Z2 = ftol(P2z * 65536.0) & 0xffff;
  const R0 = (C0 >> 16) & 0xff, G0 = (C0 >> 8) & 0xff, B0 = C0 & 0xff;
  const R1 = (C1 >> 16) & 0xff, G1 = (C1 >> 8) & 0xff, B1 = C1 & 0xff;
  const R2 = (C2 >> 16) & 0xff, G2 = (C2 >> 8) & 0xff, B2 = C2 & 0xff;

  // edge A (short) and B (long) accumulators, 8 fraction bits
  let xA = X0 << 8, xB = X0 << 8, zA = Z0 << 8, zB = Z0 << 8;
  let rA = R0 << 8, rB = R0 << 8, gA = G0 << 8, gB = G0 << 8, bA = B0 << 8, bB = B0 << 8;
  let dxA = 0, dxB = 0, dzA = 0, dzB = 0, drA = 0, drB = 0, dgA = 0, dgB = 0, dbA = 0, dbB = 0;
  const step = (): void => {
    xA = (xA + dxA) | 0; xB = (xB + dxB) | 0; zA = (zA + dzA) | 0; zB = (zB + dzB) | 0;
    rA = (rA + drA) | 0; rB = (rB + drB) | 0; gA = (gA + dgA) | 0; gB = (gB + dgB) | 0;
    bA = (bA + dbA) | 0; bB = (bB + dbB) | 0;
  };
  const span = (y: number): void => {
    let left8 = xB < xA ? xB : xA;
    const right8 = ((xB > xA ? xB : xA) + 1) | 0;
    const width = (right8 - left8) | 0;
    let zl: number, rl: number, gl: number, bl: number, dz: number, dr: number, dg: number, db: number;
    if (xA === left8) {
      zl = zA; dz = idiv((zB - zA) << 8, width);
      rl = rA; dr = idiv((rB - rA) << 8, width);
      gl = gA; dg = idiv((gB - gA) << 8, width);
      bl = bA; db = idiv((bB - bA) << 8, width);
    } else {
      zl = zB; dz = idiv((zA - zB) << 8, width);
      rl = rB; dr = idiv((rA - rB) << 8, width);
      gl = gB; dg = idiv((gA - gB) << 8, width);
      bl = bB; db = idiv((bA - bB) << 8, width);
    }
    if (left8 < 0) {
      const tz = Math.imul(dz, left8);
      zl = (zl - tz) >> 8;
      rl = (rl - Math.imul(dr, left8)) >> 8;
      gl = (gl - Math.imul(dg, left8)) >> 8;
      bl = (bl - tz) >> 8;                    // the binary subtracts dz*left from blue too
      left8 = 0;
    }
    const left = left8 >> 8;
    let right = right8 >> 8;
    if (!(right < w - 2)) right = w - 2;
    if (right <= 0) return;
    if (w - 1 <= left) return;
    const row = Math.imul(y, w);
    if (left > 0) {
      const i = row + left;
      if (zb[i - 1] === 0 && left - 1 >= 0 && left - 1 < w && y >= 0 && y < h) fb[i - 1] = OUTLINE;
    }
    {
      const i = row + right;
      if (zb[i + 1] === 0 && right + 1 >= 0 && right + 1 < w && y >= 0 && y < h) fb[i + 1] = OUTLINE;
    }
    if (right < left) return;
    for (let x = left; x <= right; x++) {
      const i = row + x;
      if (y > 0 && zb[i - w] === 0 && x >= 0 && x < w && y - 1 >= 0 && y - 1 < h) fb[i - w] = OUTLINE;
      if (y < h - 2 && zb[i + w] === 0 && x >= 0 && x < w && y + 1 >= 0 && y + 1 < h) fb[i + w] = OUTLINE;
      const z = zl >> 8;
      if (zb[i]! < z) {
        zb[i] = z;
        if (x >= 0 && x < w && y >= 0 && y < h) {
          let r = rl >> 8; if (!(r > 0)) r = 0; if (!(r < 255)) r = 255;
          let g = gl >> 8; if (!(g > 0)) g = 0; if (!(g < 255)) g = 255;
          let b = bl >> 8; if (!(b > 0)) b = 0; if (!(b < 255)) b = 255;
          fb[i] = (r << 16) | (g << 8) | b | OUTLINE;
        }
      }
      zl = (zl + dz) | 0; rl = (rl + dr) | 0; gl = (gl + dg) | 0; bl = (bl + db) | 0;
    }
  };

  // top half: y = Y0 .. Y1-1
  if (Y1 !== Y0) {
    const dyA = (Y1 - Y0) | 0, dyB = (Y2 - Y0) | 0;
    dxA = idiv((X1 - X0) << 8, dyA); dxB = idiv((X2 - X0) << 8, dyB);
    dzA = idiv((Z1 - Z0) << 8, dyA); dzB = idiv((Z2 - Z0) << 8, dyB);
    drA = idiv((R1 << 8) - (R0 << 8), dyA); drB = idiv((R2 << 8) - (R0 << 8), dyB);
    dgA = idiv((G1 << 8) - (G0 << 8), dyA); dgB = idiv((G2 << 8) - (G0 << 8), dyB);
    dbA = idiv((B1 << 8) - (B0 << 8), dyA); dbB = idiv((B2 << 8) - (B0 << 8), dyB);
    let y = Y0;
    for (;;) {
      while (y < 0) {
        y++;
        step();
        if (!(y < Y1)) break;
      }
      if (y >= h) return;
      if (y >= Y1) break;
      span(y);
      step();
      y++;
    }
  }
  // bottom half: y = Y1 .. Y2-1; edge B restarts from an interpolation of the long edge
  const dyL = (Y2 - Y0) | 0, dyS = (Y2 - Y1) | 0, tt = (Y1 - Y0) | 0;
  xA = X1 << 8; zA = Z1 << 8; rA = R1 << 8; gA = G1 << 8; bA = B1 << 8;
  xB = idiv((Math.imul(X2, tt) + Math.imul(X0, dyS)) | 0, dyL) << 8;
  zB = idiv((Math.imul(Z2, tt) + Math.imul(Z0, dyS)) | 0, dyL) << 8;
  rB = (idiv(Math.imul(R0, dyS) << 8, dyL) + idiv(Math.imul(R2, tt) << 8, dyL)) | 0;
  gB = (idiv(Math.imul(G0, dyS) << 8, dyL) + idiv(Math.imul(G2, tt) << 8, dyL)) | 0;
  bB = (idiv(Math.imul(dyS, B0) << 8, dyL) + idiv(Math.imul(tt, B2) << 8, dyL)) | 0;
  if (Y2 === Y1) return;
  dxA = idiv((X2 - X1) << 8, dyS); dxB = idiv((X2 - X0) << 8, dyL);
  dzA = idiv((Z2 - Z1) << 8, dyS); dzB = idiv((Z2 - Z0) << 8, dyL);
  drA = idiv((R2 << 8) - (R1 << 8), dyS); drB = idiv((R2 << 8) - (R0 << 8), dyL);
  dgA = idiv((G2 << 8) - (G1 << 8), dyS); dgB = idiv((G2 << 8) - (G0 << 8), dyL);
  dbA = idiv((B2 << 8) - (B1 << 8), dyS); dbB = idiv((B2 << 8) - (B0 << 8), dyL);
  let y = Y1;
  for (;;) {
    while (y < 0) {
      y++;
      step();
      if (!(y < Y2)) break;
    }
    if (y >= h) return;
    if (y >= Y2) return;
    span(y);
    step();
    y++;
  }
}

export const ape = {
  id: "Tentacles 3D",
  sha256: ["a53bac33a7dbcfd20daa83895ebdd8bda0ada787beefcca429e596bfe643d93a"],
  create(config: Uint8Array): ApeEffect {
    return new Tentacles3D(config);
  }
};
