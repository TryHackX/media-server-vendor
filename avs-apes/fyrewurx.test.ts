import assert from "node:assert/strict";
import test from "node:test";

import {
  addBlock, ape, COS_TAB, FYREWURX_DEFAULTS, FYREWURX_UPTIME, Fyrewurx, FyrewurxAnalyser, FyrewurxEmitter,
  FyrewurxParticles, fyrewurxRand, fyrewurxWindow, LOG_TAB, parseFyrewurxConfig, resetFyrewurxRand, SIN_TAB,
  WEIGHT, type ApeContext
} from "./fyrewurx.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** MSVC rand(): holdrand = holdrand * 214013 + 2531011, (holdrand >> 16) & 0x7fff. */
function msvcRand(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 214013) + 2531011) >>> 0;
    return (s >>> 16) & 0x7fff;
  };
}

/** A rand() that hands out the given values, then fails. */
function script(values: number[]): () => number {
  let k = 0;
  return () => {
    assert.ok(k < values.length, "more rand() draws than expected");
    return values[k++]!;
  };
}

function makeCtx(w: number, h: number, time: { now: number }, beat: { on: boolean }, spectrum = 0): ApeContext {
  const visdata = new Int8Array(2304);
  const visdataUnsigned = new Uint8Array(visdata.buffer);
  visdataUnsigned.fill(spectrum, 0, 1152);
  return {
    w, h,
    get isBeat() { return beat.on; },
    visdata, visdataUnsigned,
    rand: () => { throw new Error("fyrewurx.ape has its own CRT rand"); },
    makeRand: () => { throw new Error("the port keeps its generator at module level"); },
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null,
    now: () => time.now
  } as ApeContext;
}

test("config: enabled, then the colour while 4 more bytes remain (load_config 0x10001150)", () => {
  assert.deepEqual(parseFyrewurxConfig(new Uint8Array(0)), FYREWURX_DEFAULTS);
  assert.deepEqual(FYREWURX_DEFAULTS, { enabled: 1, color: 0x285080 });
  assert.deepEqual(parseFyrewurxConfig(hex("00000000")), { enabled: 0, color: 0x285080 });
  assert.deepEqual(parseFyrewurxConfig(hex("00000000ffff00")), { enabled: 0, color: 0x285080 });
  assert.deepEqual(parseFyrewurxConfig(hex("0100000080502800")), { enabled: 1, color: 0x285080 });
  assert.deepEqual(parseFyrewurxConfig(hex("010000000000ff00")), { enabled: 1, color: 0xff0000 });
});

test("the DLL's rand() is MSVC's from seed 1, and creating an instance draws once", () => {
  resetFyrewurxRand();
  const ref = msvcRand(1);
  const first = [fyrewurxRand(), fyrewurxRand(), fyrewurxRand(), fyrewurxRand()];
  assert.deepEqual(first, [41, 18467, 6334, 26500]);
  for (let k = 0; k < 4; k += 1) ref();
  for (let k = 0; k < 1000; k += 1) assert.equal(fyrewurxRand(), ref());
  resetFyrewurxRand();
  ape.create(hex("0100000080502800"));
  assert.equal(fyrewurxRand(), 18467);
  // Disabled: render() returns at once, no draws.
  resetFyrewurxRand();
  const off = ape.create(hex("0000000080502800"));
  const fb = new Int32Array(64 * 48);
  assert.equal(off.render(makeCtx(64, 48, { now: 0 }, { on: true }, 255), fb, new Int32Array(fb.length)), 0);
  assert.equal(fyrewurxRand(), 18467);
  assert.ok(fb.every((p) => p === 0));
});

test("tables: a 2048-step circle with pi as 3.1412789f, i·ln(1+i) as a byte, sqrt(i)·25856", () => {
  assert.equal(SIN_TAB[0], 0);
  assert.equal(COS_TAB[0], 128);
  assert.equal(SIN_TAB[512], 127);  // just short of a quarter turn
  assert.equal(COS_TAB[512], 0);
  assert.equal(SIN_TAB[1024], 0);
  assert.equal(COS_TAB[1024], -127);
  assert.equal(SIN_TAB[1536], -127);
  assert.equal(COS_TAB[2047], 127);
  assert.deepEqual([...LOG_TAB.subarray(0, 12)], [0, 0, 2, 4, 6, 8, 11, 14, 17, 20, 23, 27]);
  assert.equal(LOG_TAB[255], 1414 & 255); // 255 · ln 256 = 1414.02, stored in a byte
  assert.equal(WEIGHT[0], 0);
  assert.equal(WEIGHT[4], 51712);
  assert.equal(WEIGHT[575], Math.trunc(Math.sqrt(575) * 25856));
});

test("analyser: peaks through the tables, at most 0xFF00, falling 0.4 a ms with the remainder kept", () => {
  const a = new FyrewurxAnalyser();
  const visdata = new Uint8Array(2304);
  visdata[1] = 10;        // left, bin 1
  visdata[576 + 4] = 255; // right, bin 4
  visdata[100] = 255;     // bin 100: LOG_TAB[255] · WEIGHT[100] >> 8 is above 0xFF00
  a.update(visdata, 5000);
  assert.equal(a.last, 5000);
  assert.equal(a.cur[1], (LOG_TAB[10]! * WEIGHT[1]!) >>> 8);
  assert.equal(a.cur[576 + 4], (LOG_TAB[255]! * WEIGHT[4]!) >>> 8);
  assert.equal(a.cur[100], 0xff00);
  assert.ok(a.prev.every((v) => v === 0));
  const before = a.cur[576 + 4]!;
  a.update(new Uint8Array(2304), 5016); // 16 ms: 16 · 10 · 40 / 1000 = 6; last moves 6000 / 400 = 15
  assert.equal(a.prev[576 + 4], before);
  assert.equal(a.cur[576 + 4], before - 6);
  assert.equal(a.last, 5015);
  a.update(new Uint8Array(2304), 5017); // 2 ms since 5015: 0.8 → 0, nothing moves
  assert.equal(a.cur[576 + 4], before - 6);
  assert.equal(a.last, 5015);
  a.cur[0] = 3;
  a.update(new Uint8Array(2304), 5040); // 25 ms: 10, below zero is 0
  assert.equal(a.cur[0], 0);
  assert.equal(a.last, 5040);
});

test("levels: gain · max(0, (sum − 3584 · 100) / previous sum) / 128 per channel", () => {
  const a = new FyrewurxAnalyser();
  const e = new FyrewurxEmitter(script([7]));
  assert.equal(e.angle, 7);
  assert.deepEqual(e.levels(a), [0, 0]);
  for (let i = 0; i <= 100; i += 1) { a.cur[i] = 10000; a.prev[i] = 8000; a.cur[576 + i] = 3000; }
  a.cur[101] = 1 << 20; // outside the bins
  const left = (101 * 10000 - 358400) / (101 * 8000);
  assert.deepEqual(e.levels(a), [Math.fround(100 * left * 0.0078125), 0]); // right: below the threshold, previous sum 0 → 1
});

test("a burst: where, how many, angle, speed and life in the plug-in's order of draws", () => {
  const a = new FyrewurxAnalyser();
  const ps = new FyrewurxParticles();
  const e = new FyrewurxEmitter(script([0]));
  // Quiet: no burst, no draws, the limiter keeps its credit.
  e.emit(FYREWURX_UPTIME, a, ps, 320, 200, script([]));
  assert.equal(ps.count, 0);
  assert.equal(e.last, FYREWURX_UPTIME - 2000);
  // Level 1.5625 + 0 → (int)(100 · 1.5625) = 156 particles.
  for (let i = 0; i <= 100; i += 1) { a.cur[i] = 2 * 3548; a.prev[i] = 3548; }
  a.cur[0] += 358400; // Σcur − 3584 · 100 = 2 · Σprev
  const [left, right] = e.levels(a);
  assert.deepEqual([left, right], [1.5625, 0]);
  const count = 156;
  const draws = [333, 77]; // x = 333 % 320 = 13, y = 77
  for (let i = 0; i < count; i += 1) draws.push(i * 3, i * 7, i * 11);
  e.emit(FYREWURX_UPTIME + 5, a, ps, 320, 200, script(draws));
  assert.equal(ps.count, count);
  assert.equal(e.last, FYREWURX_UPTIME + 5 - 2000 + 100); // 2 s of credit from this call, 100 ms spent
  // The first particle allocated is the tail of the list (order[0]), the last the head.
  for (let i = 0; i < count; i += 1) {
    const p = ps.order[i]!;
    assert.equal(ps.x[p], 13 << 8);
    assert.equal(ps.y[p], 77 << 8);
    const angle = (i * 3) & 2047;
    const speed = (i * 7) % 360;
    assert.equal(ps.vx[p], SIN_TAB[angle]! * speed);
    assert.equal(ps.vy[p], COS_TAB[angle]! * speed);
    assert.equal(ps.life[p], 1000 + ((i * 11) % 500) - 250);
    assert.equal(ps.size[p], 3);
  }
  // Within 100 ms of credit spent: the next beat does nothing.
  e.last = FYREWURX_UPTIME + 5 - 50;
  e.emit(FYREWURX_UPTIME + 5, a, ps, 320, 200, script([]));
  assert.equal(ps.count, count);
});

test("bursts stop at 300 particles and at the list's 1000 nodes", () => {
  const a = new FyrewurxAnalyser();
  const ps = new FyrewurxParticles();
  const e = new FyrewurxEmitter(script([0]));
  a.cur.fill(0xff00);
  a.prev.fill(1);
  const rand = msvcRand(5);
  let draws = 0;
  const counted = () => { draws += 1; return rand(); };
  for (let k = 0; k < 4; k += 1) e.emit(FYREWURX_UPTIME + 1000 * k, a, ps, 320, 200, counted);
  assert.equal(ps.count, 1000);
  assert.equal(draws, 3 * (2 + 3 * 300) + 2 + 3 * 100); // the fourth burst gets 100 nodes, then alloc fails
});

test("update order and arithmetic", () => {
  const ps = new FyrewurxParticles();
  const p = ps.alloc(); // tail
  const q = ps.alloc(); // head
  ps.x[p] = 100 << 8; ps.y[p] = 50 << 8; ps.vx[p] = 25600; ps.vy[p] = -12800; ps.life[p] = 40;
  ps.x[q] = 10 << 8; ps.y[q] = 10 << 8; ps.life[q] = 1000;
  // First call: dt 0. Head first: q gets (0, 1) → (−128, 0), p gets (2, 2) → (+128, +128).
  ps.update(1000, Math.fround(0.99), 1, script([0, 1, 2, 2]));
  assert.equal(ps.x[q], (10 << 8) - 128);
  assert.equal(ps.y[q], 10 << 8);
  assert.equal(ps.x[p], (100 << 8) + 128);
  assert.equal(ps.y[p], (50 << 8) + 128);
  // 30 ms: dt · 0.001f stored as a float; p moves (int)(25600 · 0.03f) = 768, no damping at 0.99f.
  const s = Math.fround(30 * Math.fround(0.001));
  ps.update(1030, Math.fround(0.99), 1, script([1, 1, 1, 1]));
  assert.equal(ps.x[p], (100 << 8) + 128 + Math.trunc(25600 * s));
  assert.equal(ps.y[p], (50 << 8) + 128 + Math.trunc(-12800 * s));
  assert.equal(ps.vx[p], 25600);
  assert.equal(ps.age[p], 30);
  // 10 ms more: p reaches its life (40) and is freed after its jitter.
  ps.update(1040, Math.fround(0.99), 1, script([1, 1, 1, 1]));
  assert.equal(ps.count, 1);
  assert.equal(ps.order[0], q);
  // Below 0.99f the plug-in would damp.
  ps.vx[q] = 1000;
  ps.update(1050, Math.fround(0.5), 0, script([]));
  assert.equal(ps.vx[q], 500);
});

test("draw: size × size blocks fading as 255 − age · 255 / life, clipped to w − 1 and h − 1", () => {
  const ps = new FyrewurxParticles();
  const p = ps.alloc();
  ps.x[p] = 5 << 8; ps.y[p] = 6 << 8; ps.size[p] = 3; ps.life[p] = 1000; ps.age[p] = 500;
  ps.red[p] = 255; ps.green[p] = 0x80; ps.blue[p] = 1;
  const got: number[][] = [];
  ps.draw(20, 20, (...args) => got.push(args));
  const level = 255 - Math.floor((500 * 255) / 1000);
  assert.deepEqual(got, [[5, 6, 8, 9, ((255 * level) >>> 8 << 16) | (((0x80 * level) >>> 8) << 8) | ((1 * level) >>> 8)]]);
  got.length = 0;
  ps.x[p] = 18 << 8; // 18 + 3 ≥ 20 → to 19: one column
  ps.draw(20, 20, (...args) => got.push(args));
  assert.deepEqual(got.map((b) => b.slice(0, 4)), [[18, 6, 19, 9]]);
  got.length = 0;
  ps.x[p] = 19 << 8; // no column left
  ps.draw(20, 20, (...args) => got.push(args));
  ps.x[p] = -1 << 8; // left of the frame: unsigned, skipped
  ps.draw(20, 20, (...args) => got.push(args));
  assert.deepEqual(got, []);
  const fb = new Int32Array(4).fill(0x01f0f0f0 | 0);
  addBlock(fb, 2, 0, 0, 2, 1, 0x200a20);
  assert.deepEqual([...fb], [0x01fffaff, 0x01fffaff, 0x01f0f0f0, 0x01f0f0f0]);
});

test("AVS's window: the frame itself up to 480 lines, then about 480 lines drawn scaled up", () => {
  assert.deepEqual(fyrewurxWindow(640, 360), { vw: 640, vh: 360 });
  assert.deepEqual(fyrewurxWindow(320, 480), { vw: 320, vh: 480 });
  assert.deepEqual(fyrewurxWindow(1280, 720), { vw: 853, vh: 480 });
  assert.deepEqual(fyrewurxWindow(1920, 1080), { vw: 853, vh: 480 });
  const plugin = new Fyrewurx({ enabled: 1, color: 0xffffff }, script([0]));
  const p = plugin.particles.alloc();
  const ps = plugin.particles;
  ps.x[p] = 852 << 8; ps.y[p] = 0; ps.size[p] = 3; ps.life[p] = 1000; ps.red[p] = ps.green[p] = ps.blue[p] = 255;
  const got: number[][] = [];
  plugin.blocks(1280, 720, (...args) => got.push(args));
  assert.deepEqual(got, []); // the window's last column has no block, as in the plug-in
  ps.x[p] = 851 << 8; ps.y[p] = 1 << 8;
  plugin.blocks(1280, 720, (...args) => got.push(args));
  // Frame pixel X shows window pixel ⌊X · 853 / 1280⌋: window column 851 is frame 1277…1278.
  assert.deepEqual(got.map((b) => b.slice(0, 4)), [[Math.ceil((851 * 1280) / 853), 2, Math.ceil((852 * 1280) / 853), 6]]);
  for (let X = got[0]![0]!; X < got[0]![2]!; X += 1) assert.equal(Math.floor((X * 853) / 1280), 851);
});

test("render() and additive() give the same frames from the same state", () => {
  const time = { now: 0 };
  const beat = { on: false };
  const w = 96, h = 64;
  const ctx = makeCtx(w, h, time, beat);
  resetFyrewurxRand(77);
  const one = ape.create(hex("01000000ff804000"));
  resetFyrewurxRand(77);
  const two = ape.create(hex("01000000ff804000"));
  const frameA = new Int32Array(w * h);
  const frameB = new Int32Array(w * h);
  const out = new Int32Array(w * h);
  let lit = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    time.now = frame * 16 + (frame % 3);
    beat.on = frame % 9 === 0;
    for (let i = 0; i < 1152; i += 1) ctx.visdataUnsigned[i] = (frame * 37 + i * 11) & 255;
    for (let i = 0; i < w * h; i += 1) {
      const base = ((frame * 7 + i) * 2654435761) >>> 0;
      frameA[i] = frameB[i] = (base & 0x3f3f3f) | 0x7f000000;
    }
    // Same generator for both: run A from the shared state, then rewind and run B.
    resetFyrewurxRand(1000 + frame);
    assert.equal(one.render(ctx, frameA, out), 0);
    resetFyrewurxRand(1000 + frame);
    const sums = new Map<number, number>();
    two.additive!(ctx, (offset, rgb) => {
      const old = sums.get(offset) ?? 0;
      const add = (x: number, y: number, s: number) => Math.min(255, ((x >>> s) & 255) + ((y >>> s) & 255)) << s;
      sums.set(offset, add(old, rgb, 16) | add(old, rgb, 8) | add(old, rgb, 0));
    });
    for (const [offset, rgb] of sums) addBlock(frameB, w, offset % w, Math.floor(offset / w), offset % w + 1, Math.floor(offset / w) + 1, rgb);
    assert.deepEqual(frameB, frameA, `frame ${frame}`);
    if (sums.size) lit += 1;
  }
  assert.ok(lit > 60, `particles drawn in ${lit} frames`);
});
