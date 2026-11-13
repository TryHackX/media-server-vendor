import assert from "node:assert/strict";
import test from "node:test";

import {
  clampX87, lerp16, randBool, randf, rint, starwaveAllocate, starwaveCreateState, starwaveDrawChannel, starwaveInitialize,
  starwaveNewParams, starwavePalette, starwaveRender, starwaveRing, starwaveRoughness, starwaveSweepLine, starwaveTables,
  starwaveWarp, STARWAVE_DEFAULTS, svp,
  type ApeContext, type SvpVisData
} from "./svp-starwave.ts";

function msvcRand(seed = 1): () => number {
  let h = seed >>> 0;
  return () => {
    h = (Math.imul(h, 214013) + 2531011) >>> 0;
    return (h >>> 16) & 0x7fff;
  };
}

const ctx = { now: () => 12345, makeRand: (seed?: number) => msvcRand(seed ?? 1) } as unknown as ApeContext;

function visData(wave0: Uint8Array, wave1: Uint8Array = wave0): SvpVisData {
  return { millSec: 0, waveform: [wave0, wave1], spectrum: [new Uint8Array(256), new Uint8Array(256)] };
}

test("starwave: x87 helpers (fistp round-half-even, 16.16 lerp, clamp order, rand helpers)", () => {
  assert.equal(rint(2.5), 2);
  assert.equal(rint(3.5), 4);
  assert.equal(rint(-2.5), -2);
  assert.equal(rint(62.5), 62);
  assert.equal(rint(187.5), 188);
  assert.equal(rint(2.4999), 2);
  assert.equal(lerp16(50, 60, 32768), 55);
  assert.equal(lerp16(60, 50, 32768), 55);
  assert.equal(lerp16(0, 255, 65535), 254);
  assert.equal(clampX87(NaN, 10, 1), 1);
  assert.equal(clampX87(0.5, 10, 1), 1);
  assert.equal(clampX87(10, 10, 1), 10);
  assert.equal(clampX87(10.5, 10, 1), 10);
  const r = msvcRand(1);
  assert.deepEqual([r(), r(), r()], [41, 18467, 6334]);
  const r2 = msvcRand(1);
  assert.equal(randf(r2, 500), (41 * 500) / 32768);
  assert.equal(randBool(msvcRand(1)), false); // 41
  const r3 = msvcRand(1);
  r3();
  assert.equal(randBool(r3), true); // 18467 >= 16384
});

test("starwave: Initialize's float sin/cos tables of 2i * 3.14 / 512", () => {
  const { sin, cos } = starwaveTables();
  assert.equal(sin[0], 0);
  assert.equal(cos[0], 1);
  assert.equal(sin[100], 0.9413343071937561);
  assert.equal(cos[100], 0.3374755382537842);
  assert.equal(sin[256], 0.0015926528722047806); // 3.14, not pi
  assert.equal(cos[511], 0.9998806118965149);
});

test("starwave: move-map parameters, decay table and first map from rand() seeded 1", () => {
  const state = starwaveCreateState();
  starwaveInitialize(state, msvcRand(12345), msvcRand(1));
  assert.equal(state.sweepTarget, 115); // (int)(7584 * 500 / 32768) on the loading thread
  starwaveAllocate(state, 64, 48);
  assert.equal(state.a028, -0.498748779296875);
  assert.equal(state.a024, 0.16907043755054474);
  assert.equal(state.rings, 4);
  assert.equal(state.generation, 1);
  assert.deepEqual([state.lut[0], state.lut[1], state.lut[2], state.lut[3], state.lut[100], state.lut[200], state.lut[255]], [0, 0, 1, 2, 95, 190, 242]);
  const at = (x: number, y: number) => [state.cur[2 * (y * 64 + x)], state.cur[2 * (y * 64 + x) + 1]];
  assert.deepEqual(at(0, 0), [65536, 83860]);
  assert.deepEqual(at(5, 0), [355931, 77048]);
  assert.deepEqual(at(32, 0), [2065301, 65536]);
  assert.deepEqual(at(63, 0), [4009035, 65536]);
  assert.deepEqual(at(0, 10), [99749, 650160]);
  assert.deepEqual(at(63, 10), [4088000, 719687]);
  assert.deepEqual(at(32, 24), [2097152, 1572864]);
  assert.deepEqual(at(0, 47), [122549, 3057645]);
  assert.deepEqual(at(63, 47), [4099080, 2988320]);
  assert.equal(state.colPrev, 0xaead11);
  assert.equal(state.colNext, 0x798824);
  // every coordinate stays inside [1, w-1] x [1, h-1]
  for (let i = 0; i < 64 * 48; i++) {
    assert.ok(state.cur[2 * i]! >= 65536 && state.cur[2 * i]! <= 63 * 65536);
    assert.ok(state.cur[2 * i + 1]! >= 65536 && state.cur[2 * i + 1]! <= 47 * 65536);
  }
});

test("starwave: palette ramps black -> colour -> white with integer division", () => {
  const pal = new Int32Array(768);
  starwavePalette(pal, 255, 255, 255);
  assert.deepEqual([...pal.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual([...pal.subarray(3, 6)], [1, 1, 1]);
  assert.deepEqual([...pal.subarray(127 * 3, 128 * 3)], [253, 253, 253]);
  assert.deepEqual([...pal.subarray(128 * 3, 129 * 3)], [255, 255, 255]);
  starwavePalette(pal, 100, 50, 200);
  assert.deepEqual([...pal.subarray(64 * 3, 65 * 3)], [50, 25, 100]);
  assert.deepEqual([...pal.subarray(128 * 3, 129 * 3)], [100, 50, 200]);
  assert.deepEqual([...pal.subarray(192 * 3, 193 * 3)], [177, 152, 227]);
  assert.deepEqual([...pal.subarray(255 * 3, 256 * 3)], [253, 253, 254]);
});

test("starwave: waveform roughness (signed samples, /256, capped at 127)", () => {
  const alt = new Uint8Array(512).map((_, i) => (i & 1 ? 0xf0 : 0x10));
  assert.equal(starwaveRoughness(alt), (32 * 511) / 256);
  const loud = new Uint8Array(512).map((_, i) => (i & 1 ? 0x80 : 0x7f));
  assert.equal(starwaveRoughness(loud), 127);
  assert.equal(starwaveRoughness(new Uint8Array(512)), 0);
});

test("starwave: ring of dots around a centre (fistp rounding, border test)", () => {
  const state = starwaveCreateState();
  starwaveInitialize(state, msvcRand(1), msvcRand(1));
  starwaveAllocate(state, 64, 48);
  const wave = new Uint8Array(512);
  wave[0] = 64;
  wave[128] = 0xc0; // -64
  const f = starwaveRoughness(wave);
  assert.equal(f, 0.75);
  state.img.fill(0);
  starwaveRing(state, wave, 32, 24, Math.fround((6 * f) / 128));
  const lit = [...state.img.keys()].filter((i) => state.img[i] === 255);
  assert.deepEqual(lit, [24 * 64 + 33, 26 * 64 + 32]);
  // points on or outside the 2-pixel border are dropped
  state.img.fill(0);
  starwaveRing(state, wave, 1.4, 24, Math.fround((6 * f) / 128));
  assert.deepEqual([...state.img.keys()].filter((i) => state.img[i] === 255), [24 * 64 + 2]);
});

test("starwave: bilinear 16.16 warp through the decay table", () => {
  const state = starwaveCreateState();
  state.w = 4;
  state.h = 3;
  state.img = Uint8Array.from([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
  state.img2 = new Uint8Array(12);
  state.cur = new Int32Array(24);
  for (let i = 0; i < 12; i++) { state.cur[2 * i] = 98304; state.cur[2 * i + 1] = 81920; } // (1.5, 1.25)
  state.cur[0] = 3 * 65536; state.cur[1] = 2 * 65536; // last pixel: weights 0 past the end
  for (let i = 0; i < 256; i++) state.lut[i] = i;
  state.lut[65] = 64;
  starwaveWarp(state);
  assert.equal(state.img[0], 110);
  assert.equal(state.img[1], 64);
  assert.equal(state.img[11], 64);
});

test("starwave: the sweep starts when a rounded draw of 0..500 equals the target", () => {
  const state = starwaveCreateState();
  starwaveInitialize(state, msvcRand(1), msvcRand(1));
  starwaveAllocate(state, 64, 48);
  // next draws: 31998 -> 488 (no hit), then 10322 -> 158
  state.sweepTarget = 158;
  const quiet = new Uint8Array(512);
  starwaveDrawChannel(state, quiet, 0, 6);
  assert.equal(state.sweepActive, false);
  starwaveDrawChannel(state, quiet, 0, 6);
  assert.equal(state.sweepActive, true); // hit: direction and new target drawn
  const check = msvcRand(1);
  for (let i = 0; i < 265 + 2; i++) check();
  const dir = check() >= 16384;
  const target = rint(Math.fround(((check() & 0x7fff) * 500) / 32768));
  assert.equal(state.sweepDown, dir);
  assert.equal(state.sweepTarget, target);
  assert.equal(state.sweepPos, dir ? 1 : 47);
  // the line: sample 0 at x = 0 skipped, others d = s * 40 / 128 from row pos
  const line = new Uint8Array(512).fill(32);
  state.img.fill(0);
  starwaveSweepLine(state, line, 20, 40);
  const rows = new Set([...state.img.keys()].filter((i) => state.img[i] === 255).map((i) => (i / 64) | 0));
  assert.deepEqual([...rows], [30]);
  assert.equal(state.angle, Math.fround(Math.fround(0.003) + Math.fround(0.003)));
});

test("starwave: Render replaces every pixel (alpha 0xFF), is deterministic, and uses 267 draws on frame 1", () => {
  const w = 80;
  const h = 60;
  const wave = new Uint8Array(512).map((_, i) => (Math.round(Math.sin(i / 9) * 90) & 0xff));
  const a = new Int32Array(w * h).fill(0x123456);
  const b = new Int32Array(w * h).fill(0x654321);
  const ea = svp.create();
  const eb = svp.create();
  for (let f = 0; f < 5; f++) {
    ea.render(a, w, h, w, visData(wave), ctx);
    eb.render(b, w, h, w, visData(wave), ctx);
  }
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >>> 24 === 0xff));
  assert.ok(a.some((v) => (v & 0xffffff) !== 0));

  const state = starwaveCreateState();
  starwaveInitialize(state, msvcRand(12345), msvcRand(1));
  const frame = new Int32Array(w * h);
  starwaveRender(state, frame, w, h, w, visData(new Uint8Array(512)));
  const shadow = msvcRand(1);
  for (let i = 0; i < 267; i++) shadow();
  assert.equal(state.rand(), shadow());
  assert.equal(state.row, 1);
  // silence: nothing drawn, the image stays 0 and the frame shows palette entry 0 (black)
  assert.ok(frame.every((v) => v === (0xff000000 | 0)));
});

test("starwave: fixed colours when CycleColors is off; defaults from the missing avs.ini", () => {
  assert.deepEqual({ ...STARWAVE_DEFAULTS }, { drawSweep: true, cycleColors: true, fixedR: 255, fixedG: 255, fixedB: 255 });
  const state = starwaveCreateState({ ...STARWAVE_DEFAULTS, cycleColors: false, fixedR: 0, fixedG: 128, fixedB: 255 });
  starwaveInitialize(state, msvcRand(1), msvcRand(1));
  const frame = new Int32Array(32 * 24);
  starwaveRender(state, frame, 32, 24, 32, visData(new Uint8Array(512)));
  assert.deepEqual([...state.pal.subarray(128 * 3, 129 * 3)], [0, 128, 255]);
  // cycling: entry 128 is the colour; on frame 1 the blend is 0, so it is colPrev with byte 0 as red
  const cyc = starwaveCreateState();
  starwaveInitialize(cyc, msvcRand(1), msvcRand(1));
  starwaveRender(cyc, frame, 32, 24, 32, visData(new Uint8Array(512)));
  assert.deepEqual([...cyc.pal.subarray(128 * 3, 129 * 3)], [0x11, 0xad, 0xae]);
  starwaveNewParams(cyc);
  assert.equal(cyc.generation, 2);
});
