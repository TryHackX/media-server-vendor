import assert from "node:assert/strict";
import test from "node:test";

import {
  SMEAR_SETTINGS, SmearEngine, SmearMoveScript, SmearWaveScript, smearColorEntry, smearDecayTable, smearFtol, smearPalette,
  smearPickIndex, smearRnd, smearSplashMask, smearSwitchTime, svp,
  type ApeContext, type SvpVisData
} from "./svp-smear.ts";

/** MSVC rand(): holdrand = holdrand * 214013 + 2531011, (holdrand >> 16) & 0x7fff. */
function msvcRand(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 214013) + 2531011) >>> 0;
    return (s >>> 16) & 0x7fff;
  };
}

function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function makeCtx(clock: { t: number }, seeds: number[] = []): ApeContext {
  return {
    w: 0, h: 0, isBeat: false, visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: () => 0,
    makeRand: (seed?: number) => { seeds.push(seed ?? 1); return msvcRand(seed); },
    registers: new Float64Array(100), lineBlendMode: 0, globalBuffer: () => null,
    now: () => clock.t
  };
}

function visData(sample = 0): SvpVisData {
  return {
    millSec: 0,
    waveform: [new Uint8Array(512).fill(sample & 255), new Uint8Array(512).fill(sample & 255)],
    spectrum: [new Uint8Array(256), new Uint8Array(256)]
  };
}

test("smear: defaults read by OpenSettings when avs.ini has no [smear] section", () => {
  assert.deepEqual({ ...SMEAR_SETTINGS }, {
    movemapHold: 150, movemapFade: 30, colormapHold: 130, colormapFade: 30, waveformHold: 150, waveformFade: 15,
    particleHold: 100, particleFade: 30, particleChance: 10, letterBox: 100, showTitles: true, debugScripts: false
  });
});

test("smear: Stutter RND, script choice and hold times", () => {
  assert.equal(smearRnd(seq([16384]), 16), 8);
  assert.equal(smearRnd(seq([16384])), 0.5);
  assert.equal(smearRnd(seq([0x7fff]), 5, 2), (0x7fff / 32768) * 3 + 2);
  assert.equal(smearRnd(seq([0x18000]), 16), 0); // rand() & 0x7fff
  const r = msvcRand(1);
  assert.equal(smearPickIndex(r, 1), 0);
  assert.equal(r(), 18467); // the pick consumed the first draw (41)
  assert.equal(smearSwitchTime(seq([0]), 150), 7500);
  assert.equal(smearSwitchTime(seq([99]), 150), 22350);
  assert.equal(smearSwitchTime(seq([41]), 30), 2730);
});

test("smear: decay table (rand() % 500 / 10000 + 0.95) * i", () => {
  const t = smearDecayTable(seq([0, 499, 250]));
  assert.equal(t[0], 0);
  assert.equal(t[1], 0); // 0.9999 * 1
  assert.equal(t[2], 1); // 0.975 * 2
  assert.equal(t[255], smearFtol(0.95 * 255)); // r = 0 -> 242
  assert.equal(t[255], 242);
  assert.equal(t[100], smearFtol((499 / 10000 + 0.95) * 100));
});

test("smear: built-in colour script through the HSV conversion", () => {
  // time 0: hue 0 (red sector, H flipped to 1)
  assert.equal(smearColorEntry(0, 0), 0x000000);
  assert.equal(smearColorEntry(0, 64), 0x800000);
  assert.equal(smearColorEntry(0, 192), 0xff8080);
  assert.equal(smearColorEntry(0, 255), 0xfffefe);
  // time 5 s: h = 0.25 -> sector 1, f = 0.5
  assert.equal(smearColorEntry(5, 64), 0x408000);
  // one hue turn per 20 s
  const a = new Int32Array(256);
  const b = new Int32Array(256);
  smearPalette(1234, a);
  smearPalette(21234, b);
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >>> 24 === 0));
});

test("smear: built-in move script (polar, a0 = 2 + rnd 16, a1 = .002 + rnd .02, a2 = .002 + rnd .006)", () => {
  const m = new SmearMoveScript();
  m.init(seq([16384, 0, 32767]));
  assert.equal(m.a0, 10);
  assert.equal(m.a1, 0.002);
  assert.equal(m.a2, (32767 / 32768) * 0.006 + 0.002);
  const out = new Float64Array(2);
  m.move(0, 0, out);
  assert.deepEqual([...out], [0, 0]);
  m.move(0.5, 0, out);
  const sr = 0.5 - m.a2;
  const st = Math.sin(0.5 * 10) * 0.002;
  assert.equal(out[0], Math.cos(st) * sr);
  assert.equal(out[1], Math.sin(st) * sr);
});

test("smear: move map row in 16.16, centred, clamped, aspect = max(w, h) / 2", () => {
  const e = new SmearEngine();
  e.tick = () => 0;
  e.w = 8; e.h = 4; e.boxH = 4;
  e.rand = seq([0]);
  e.moveScript.a0 = 2; e.moveScript.a1 = 0; e.moveScript.a2 = 0;
  e.moveCur = e.moveScript;
  e.mapW = 8; e.mapH = 4; e.maps = [new Int32Array(64), new Int32Array(64)]; e.mapA = 0;
  const budget = { v: 5 };
  assert.equal(e.computeRow(2, budget), 0);
  // a1 = a2 = 0: identity map; row 2 is the centre row (y = 2.0 exactly)
  const row = e.maps[1].subarray(2 * 8 * 2, 3 * 8 * 2);
  for (let x = 0; x < 8; x++) {
    assert.ok(Math.abs(row[x * 2]! - x * 65536) <= 1, `x ${x}: ${row[x * 2]}`);
    assert.equal(row[x * 2 + 1], 2 * 65536);
  }
  // shrink by a2 = 0.5 (in units of max(w,h)/2 = 4 px): pixel 0 (r = 1) -> r 0.5 -> x 2.0
  e.moveScript.a2 = 0.5;
  e.computeRow(2, budget);
  assert.equal(row[0], 2 * 65536);
  // time budget exceeded: the row is abandoned and the budget goes negative
  let t = 0;
  e.tick = () => (t += 3);
  const b2 = { v: 5 };
  assert.equal(e.computeRow(0, b2), -1);
  assert.ok(b2.v < 0);
});

test("smear: DDA line from (x1, y1), end point excluded, 1-pixel border never drawn", () => {
  const e = new SmearEngine();
  e.w = 10; e.h = 10; e.boxH = 10; e.bufW = 10; e.bufH = 10; e.origin = 11;
  e.bufs = [new Uint8Array(10 * 10 + 22), new Uint8Array(10 * 10 + 22)]; e.cur = 0;
  const px = (x: number, y: number) => e.bufs![0][11 + y * 10 + x];
  e.line(5, 5, 1, 1, 200, 0);
  assert.deepEqual([px(5, 5), px(4, 4), px(3, 3), px(2, 2), px(1, 1)], [200, 200, 200, 200, 0]);
  e.line(3, 0, 3, 9, 255, 0);
  assert.equal(px(3, 0), 0);
  assert.equal(px(3, 1), 255);
  assert.equal(px(3, 8), 255);
  e.line(9, 4, 0, 4, 255, 0);
  assert.equal(px(9, 4), 0);
  assert.equal(px(8, 4), 255);
  assert.equal(px(0, 4), 0);
  // blend 1 (saturating add) and 2 (max)
  e.line(6, 7, 7, 7, 100, 1);
  e.line(6, 7, 7, 7, 100, 1);
  e.line(6, 7, 7, 7, 100, 1);
  assert.equal(px(6, 7), 255);
  e.line(6, 6, 7, 6, 50, 2);
  e.line(6, 6, 7, 6, 40, 2);
  assert.equal(px(6, 6), 50);
});

test("smear: warp is bilinear through the decay table, fixed point as the binary", () => {
  const e = new SmearEngine();
  e.tick = () => 0;
  e.w = 4; e.h = 2; e.boxH = 2;
  e.rand = seq([0]);
  e.moveCur = e.moveScript;
  e.mapW = 4; e.mapH = 2; e.row = 2; // map complete
  const A = new Int32Array(16);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) { A[(y * 4 + x) * 2] = x * 65536 + 32768; A[(y * 4 + x) * 2 + 1] = y * 65536; }
  e.maps = [A, new Int32Array(16)]; e.mapA = 0;
  e.bufW = 4; e.bufH = 2; e.origin = 5; e.bufs = [new Uint8Array(4 * 2 + 10), new Uint8Array(4 * 2 + 10)]; e.cur = 0;
  e.decay = Uint8Array.from({ length: 256 }, (_, i) => i);
  e.splashDone = 1; e.holdUntil = 1 << 30; // no switch
  const src = e.bufs[0];
  src.set([10, 20, 30, 40, 50, 60, 70, 80], 5);
  e.warp();
  assert.equal(e.cur, 1);
  // x + 0.5 between neighbours: 10 + ((20 - 10) * 32768 >> 16) = 15 ...; the last column reads the
  // next row's first pixel (40 -> 50: 45) and, on the last row, the zeroed guard (80 -> 0: 40)
  assert.deepEqual([...e.bufs[1].subarray(5, 13)], [15, 25, 35, 45, 55, 65, 75, 40]);
});

test("smear: waveform line rotates 0.015 per drawing; first frame is the splash", () => {
  const w = 64;
  const h = 48;
  const clock = { t: 100000 };
  const seeds: number[] = [];
  const ctx = makeCtx(clock, seeds);
  const effect = svp.create();
  const frame = new Int32Array(w * h).fill(0x123456);
  effect.render(frame, w, h, w, visData(0), ctx);
  assert.deepEqual(seeds, [1]); // render thread: per-thread rand state 1
  // silence: points (step * 2 - 1, 0) rotated by 0.015 -> nearly horizontal line through the centre
  const lit = [...frame.keys()].filter((i) => frame[i] !== frame[0]);
  assert.ok(lit.length > 50 && lit.length < 70, `${lit.length}`);
  for (const i of lit) assert.ok(Math.abs(Math.floor(i / w) - 24) <= 1);
  // everything comes from the palette (alpha 0) and the frame is fully replaced
  assert.ok(frame.every((v) => v >>> 24 === 0 && v !== 0x123456));
  const pal = new Int32Array(256);
  smearPalette(100000, pal);
  assert.equal(frame[0], pal[0]);
  assert.equal(frame[lit[0]!], pal[255]);
});

test("smear: rand() order — palette pick + hold, move pick + a0 a1 a2, decay table, waveform pick + hold, particles", () => {
  const e = new SmearEngine();
  const clock = { t: 5000 };
  e.render(new Int32Array(32 * 24), 32, 24, 32, visData(0), makeCtx(clock));
  const r = msvcRand(1);
  const d = Array.from({ length: 6 }, () => r());
  assert.equal(e.colorNext, 5000 + smearSwitchTime(seq([d[1]!]), 130));
  assert.equal(e.moveScript.a0, (d[3]! / 32768) * 16 + 2);
  assert.equal(e.moveScript.a1, (d[4]! / 32768) * 0.02 + 0.002);
  assert.equal(e.moveScript.a2, (d[5]! / 32768) * 0.006 + 0.002);
  const decay = smearDecayTable(r);
  assert.deepEqual(e.decay, decay);
  r(); // waveform pick
  assert.equal(e.waveNext, 5000 + smearSwitchTime(seq([r()]), 150));
  assert.equal(e.particleLastTry, 5000);
});

test("smear: splash lasts until the first map is done and 1.5 s passed, then warping starts", () => {
  const e = new SmearEngine();
  const clock = { t: 1000 };
  const ctx = makeCtx(clock);
  const w = 40;
  const h = 30;
  const frame = new Int32Array(w * h);
  e.render(frame, w, h, w, visData(0), ctx);
  assert.equal(e.splashDone, 0);
  assert.equal(e.row, h); // constant clock: the whole map fits in the budget
  clock.t = 2499;
  e.render(frame, w, h, w, visData(0), ctx);
  assert.equal(e.splashDone, 0);
  clock.t = 2500;
  e.render(frame, w, h, w, visData(0), ctx);
  assert.equal(e.splashDone, 1);
  assert.equal(e.moveFading, 1);
  assert.equal(e.fadeDur, 0);
  // next frame: the (instant) fade ends, the maps swap, a new map starts
  clock.t = 2516;
  const a0 = e.moveScript.a0;
  e.render(frame, w, h, w, visData(0), ctx);
  assert.equal(e.moveFading, 0);
  assert.notEqual(e.moveScript.a0, a0);
  assert.ok(e.holdUntil >= 2516 + 7500 && e.holdUntil <= 2516 + 22350);
});

test("smear: letter box for portrait frames (box = width rows), other rows cleared", () => {
  const w = 20;
  const h = 40;
  const clock = { t: 777 };
  const frame = new Int32Array(w * h).fill(-1);
  svp.create().render(frame, w, h, w, visData(0), makeCtx(clock));
  for (let y = 0; y < 10; y++) for (let x = 0; x < w; x++) assert.equal(frame[y * w + x], 0);
  for (let y = 30; y < 40; y++) for (let x = 0; x < w; x++) assert.equal(frame[y * w + x], 0);
});

test("smear: waveform morph records interpolate the skipped sample indices", () => {
  const e = new SmearEngine();
  e.record(10, 20, 255, 1, 0, 0);
  e.record(14, 12, 255, 1, 0, 4);
  const r = e.records[0]![0]!;
  assert.deepEqual([...r.x.subarray(0, 5)], [10, 11, 12, 13, 14]);
  assert.deepEqual([...r.y.subarray(0, 5)], [20, 18, 16, 14, 12]);
  assert.equal(r.last, 4);
  const ws = new SmearWaveScript();
  ws.newline();
  ws.newline();
  assert.equal(ws.angle, 0.015 + 0.015);
  ws.waveform(1, 0);
  assert.equal(ws.x0, Math.cos(0.03) * 1);
  assert.equal(ws.y0, Math.sin(0.03) * 1);
});

test("smear: without a canvas the GDI splash text is absent (node)", () => {
  assert.equal(smearSplashMask(64, 48, 48), null);
});
