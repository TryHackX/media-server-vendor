import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";

import {
  ape, DEFAULT_LOG_VOLUME_SCALING, Fluid, GeissFluid, mulIntF32, NX, NY, resetClockOrigin, volumeScale,
  type ApeContext,
} from "./geissfluid.ts";

const f32 = Math.fround;

/** MSVC rand() (static CRT: holdrand * 214013 + 2531011, bits 16..30). */
function msvcRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 214013) + 2531011) >>> 0;
    return (s >>> 16) & 0x7fff;
  };
}

const crcOf = (a: Float32Array | Int32Array): number => crc32(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

function fakeCtx(w: number, h: number, now: () => number, seeds: number[] = [], vis = new Int8Array(2304)): ApeContext {
  return {
    w, h, isBeat: false, visdata: vis, visdataUnsigned: new Uint8Array(vis.buffer), rand: () => 0,
    makeRand: (seed?: number) => {
      seeds.push(seed ?? 1);
      return msvcRand(seed ?? 1);
    },
    registers: new Float64Array(100), lineBlendMode: 0, globalBuffer: () => null, now,
  };
}

test("ape export and the 4-byte config of the presets", () => {
  assert.equal(ape.id, "GeissFluid");
  assert.deepEqual(ape.sha256, ["d97cbe7ea3d3464346dcbfab618b35ca2c768e40f3fd2d3121534d3298d25262"]);
  // all six presets (JC7 x2, Runar x2, undefined4, zen-x5) store ff 00 00 00
  const fx = ape.create(Uint8Array.of(0xff, 0, 0, 0)) as GeissFluid;
  assert.equal(fx.color, 0xff);
  assert.equal((ape.create(new Uint8Array(0)) as GeissFluid).color, 0xff); // constructor default
  assert.equal((ape.create(Uint8Array.of(1, 2, 3, 4)) as GeissFluid).color, 0x04030201);
});

test("registry default: log_volume_scaling 500 -> gain 2^6.5000001 as float", () => {
  assert.equal(DEFAULT_LOG_VOLUME_SCALING, 500);
  const g = volumeScale(500);
  assert.equal(g, 90.50967407226562);
  assert.equal(new Uint32Array(new Float32Array([g]).buffer)[0], 0x42b504f4);
  assert.equal(volumeScale(0), f32(Math.pow(2, 4.5)));
  assert.ok(Math.abs(volumeScale(1000) - Math.pow(2, 8.5)) < 1e-3);
});

test("int * float rounds once to float, also above 2^24", () => {
  const k = f32(0.001);
  // exact reference with BigInt: k = m * 2^e
  const bits = new Uint32Array(new Float32Array([k]).buffer)[0]!;
  const m = BigInt((bits & 0x7fffff) | 0x800000);
  const e = ((bits >>> 23) & 0xff) - 127 - 23;
  const exact = (n: number): number => {
    // round n*m*2^e to 24 significant bits, ties to even
    const prod = BigInt(n) * m;
    const neg = prod < 0n;
    let p = neg ? -prod : prod;
    let shift = 0;
    while (p >= 1n << 24n) {
      shift++;
      p >>= 1n;
    }
    const full = neg ? -prod : prod;
    const lost = full - (p << BigInt(shift));
    const half = shift > 0 ? 1n << BigInt(shift - 1) : 0n;
    if (shift > 0 && (lost > half || (lost === half && (p & 1n) === 1n))) p += 1n;
    const v = Number(p) * Math.pow(2, shift + e);
    return neg ? -v : v;
  };
  let seed = 7;
  for (let i = 0; i < 2000; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const n = (seed % 0x7fffffff) - (i & 1 ? 0x40000000 : 0);
    assert.equal(mulIntF32(n, k), f32(exact(n)), `n=${n}`);
  }
});

test("reset: rand() order and the constructor's 53-bit arithmetic", () => {
  const fl = new Fluid(msvcRand(12345), 100);
  assert.equal(fl.gain, 90.50967407226562);
  assert.equal(fl.offset, 18000);
  assert.deepEqual([fl.px[0], fl.py[0], fl.page[0], fl.plife[0]], [2.6399998664855957, 6.949999809265137, 1.8750001192092896, 15]);
  assert.deepEqual([fl.px[32767], fl.py[32767]], [5.880000114440918, 25.10999870300293]);
  assert.deepEqual([...fl.em.subarray(0, 10)], [0.08285000175237656, 0.10220000892877579, 0.08480000495910645, 0.06935000419616699, 5.40708065032959, 2.549680233001709, 0.052000001072883606, 0.06675999611616135, 5.7462005615234375, 1.8651601076126099]);
  assert.deepEqual([...fl.em.subarray(110, 120)], [0.0755000039935112, 0.17150001227855682, 0.12425000965595245, 0.13250000774860382, 4.119680404663086, 6.0602006912231445, 0.048340000212192535, 0.04456000030040741, 0.3705200254917145, 0.6280000805854797]);
  assert.equal(fl.emFlag[0], 0);
  assert.ok(fl.P.every((v) => v === 1) && fl.U.every((v) => v === 0) && fl.V.every((v) => v === 0));
});

test("six frames agree with the reference reading (fluid, emitters, particles, fade, respawns)", () => {
  const rnd = msvcRand(12345);
  const fl = new Fluid(rnd, 100);
  const w = 56, h = 40;
  const spec = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i % 5 === 0 ? 200 : 40 + ((i * 13) % 80);
    spec[i] = (v << 24) >> 24; // signed char, as the plug-in reads visdata
  }
  const fb = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) fb[i] = Math.imul(i, 0x01020305);
  for (const clk of [116, 133, 150, 166, 183, 200]) fl.render(fb, w, h, spec, clk);
  assert.equal(fl.frames, 6);
  assert.equal(fl.particleCount, 80);
  assert.equal(crcOf(fl.P), 651869815);
  assert.equal(crcOf(fl.U), 2570079273);
  assert.equal(crcOf(fl.V), 3775739490);
  assert.deepEqual([fl.P[0], fl.P[617], fl.P[1199], fl.U[5 * 40 + 10], fl.V[12 * 40 + 20]], [0.9999997019767761, 1.0910826921463013, 1, 0.005928754806518555, 0.03794628381729126]);
  assert.deepEqual([...fl.px.subarray(0, 6)], [8.972860336303711, 15.520018577575684, 2.5131490230560303, 36.590003967285156, 24.570756912231445, 30.659818649291992]);
  assert.deepEqual([...fl.py.subarray(0, 6)], [4.261683940887451, 13.676175117492676, 16.45775604248047, 8.999996185302734, 12.434688568115234, 19.1600284576416]);
  assert.equal(crcOf(fb), 2948872458);
  assert.deepEqual([...fb.subarray(0, 8)].map((v) => v >>> 0), [0x0, 0x0, 0x0, 0x0, 0x2, 0x7, 0xc, 0x311]);
  assert.equal(fb[w * h - 1]! >>> 0, 0xbe8656a9);
  // the respawns of frame 0 consumed the same draws: the generator continues identically
  const ref = msvcRand(212867571);
  assert.equal(rnd(), ref());
});

test("a silent frame: no forcing, particles stand still and are drawn in the slowest colour", () => {
  const fl = new Fluid(msvcRand(99), 0);
  const w = 64, h = 48;
  const fb = new Int32Array(w * h);
  const x0 = fl.px.slice(0, 109);
  const y0 = fl.py.slice(0, 109);
  fl.render(fb, w, h, new Float32Array(256), 20);
  assert.equal(fl.particleCount, Math.trunc((w * h) / 28));
  assert.ok(fl.P.every((v) => v === 1));
  assert.deepEqual(fl.px.slice(0, 109), x0);
  assert.deepEqual(fl.py.slice(0, 109), y0);
  // |v| = 0 -> s = 0.25: B = 0.0625*128 = 8, G = 50, R = trunc(0.5*255) = 127
  for (let p = 0; p < fl.particleCount; p++) {
    const row = Math.trunc(f32(f32(y0[p]! / NY) * h));
    const col = Math.trunc(f32(f32(x0[p]! / NX) * w));
    assert.equal(fb[row * w + col], 0x7f3208);
  }
});

test("spectrum bins above 127 count negative (signed char)", () => {
  // emitter 0 averages bins 3..22; 20 bins of 0x80 (-128) give no forcing, 20 of 0x7f a strong one
  const quiet = new Fluid(msvcRand(5), 0);
  const loud = new Fluid(msvcRand(5), 0);
  const specNeg = new Float32Array(256).fill(-128);
  const specPos = new Float32Array(256).fill(127);
  quiet.render(new Int32Array(64), 8, 8, specNeg, 10);
  loud.render(new Int32Array(64), 8, 8, specPos, 10);
  assert.ok(quiet.U.every((v) => v === 0) && quiet.V.every((v) => v === 0));
  assert.ok(loud.U.some((v) => v !== 0));
});

test("fade: psubusb 3 on all four bytes, in blocks of 16 pixels", () => {
  const fl = new Fluid(msvcRand(1), 0);
  const fb = new Int32Array(25).fill(0x05020304);
  fl.render(fb, 5, 5, new Float32Array(256), 1); // 25*4/8 = 12 -> 12>>3 = 1 block = 16 pixels; 0 particles
  assert.equal(fl.particleCount, 0);
  for (let i = 0; i < 16; i++) assert.equal(fb[i], 0x02000001);
  for (let i = 16; i < 25; i++) assert.equal(fb[i], 0x05020304);
});

test("timing: first frame dt = 0.333/3, then the mean frame time / 3; t starts at the random offset", () => {
  const fl = new Fluid(msvcRand(3), 1000);
  const off = fl.offset;
  const spec = new Float32Array(256);
  const k = f32(0.001);
  fl.render(new Int32Array(64), 8, 8, spec, 1000); // lastClock is 0 (zeroed allocation): L1C = -1000 * 0.001f
  assert.equal(fl.dt, f32(f32(0.333) / 3));
  assert.equal(fl.t, f32(off + f32(-1000 * k)));
  fl.render(new Int32Array(64), 8, 8, spec, 1016); // measured at the previous frame: 0 s over 1 frame
  assert.equal(fl.dt, 0);
  assert.equal(fl.t, off);
  fl.render(new Int32Array(64), 8, 8, spec, 1033); // 16 ms over 2 frames
  assert.equal(fl.dt, f32(f32(f32(16 * k) / 2) / 3));
  assert.equal(fl.t, f32(off + f32(16 * k)));
  fl.render(new Int32Array(64), 8, 8, spec, 1050); // 33 ms over 3 frames
  assert.equal(fl.dt, f32(f32(f32(33 * k) / 3) / 3));
  assert.equal(fl.frames, 4);
});

test("the effect: makeRand seeded like srand(time(NULL)), clock() from the first GeissFluid frame", () => {
  resetClockOrigin();
  const seeds: number[] = [];
  let t = 1_234_567;
  const ctx = fakeCtx(32, 24, () => t, seeds);
  const fx = new GeissFluid(Uint8Array.of(0xff, 0, 0, 0));
  const fb = new Int32Array(32 * 24);
  assert.equal(fx.render(ctx, fb, fb), 0);
  assert.deepEqual(seeds, [1234]);
  assert.equal(fx.fluid!.initClock, 0);
  t += 20;
  fx.render(ctx, fb, fb);
  assert.equal(fx.fluid!.lastClock, 20);
  // a second effect created later measures clock() from the same origin
  const fx2 = new GeissFluid(Uint8Array.of(0xff, 0, 0, 0));
  t += 1000;
  fx2.render(ctx, fb, fb);
  assert.equal(fx2.fluid!.initClock, 1020);
});

test("the colour config does not change the picture", () => {
  const run = (cfg: Uint8Array): Int32Array => {
    resetClockOrigin();
    let t = 5000;
    const vis = new Int8Array(2304);
    for (let i = 0; i < 256; i++) vis[i] = 100;
    const ctx = fakeCtx(40, 30, () => (t += 17), [], vis);
    const fx = ape.create(cfg);
    const fb = new Int32Array(40 * 30);
    for (let i = 0; i < 5; i++) fx.render(ctx, fb, fb);
    return fb;
  };
  assert.deepEqual(run(Uint8Array.of(0xff, 0, 0, 0)), run(Uint8Array.of(0x00, 0xff, 0x00, 0)));
});
