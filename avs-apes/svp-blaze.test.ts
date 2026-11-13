import assert from "node:assert/strict";
import test from "node:test";

import {
  BLAZE_ACTIONS, BLAZE_BANDS, blazeBands, blazeFirePixel, blazeGeometry, blazeInitialState, blazeLevel, blazeRender,
  blazeSegment, svp, type ApeContext, type SvpVisData
} from "./svp-blaze.ts";

function msvcRand(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
}

const ctx = { makeRand: (seed?: number) => msvcRand(seed ?? 1) } as unknown as ApeContext;

function visData(level: number): SvpVisData {
  return {
    millSec: 0,
    waveform: [new Uint8Array(512), new Uint8Array(512)],
    spectrum: [new Uint8Array(256).fill(level), new Uint8Array(256).fill(level)]
  };
}

test("blaze: 10 spectrum bands, integer means of both channels", () => {
  assert.equal(BLAZE_BANDS.length, 10);
  assert.equal(BLAZE_BANDS.reduce((n, [a, b]) => n + b - a + 1, 0), 256);
  for (const [a, b, d] of BLAZE_BANDS) assert.equal(b - a + 1, d);
  const s0 = new Uint8Array(256).map((_, i) => i);
  const bands = blazeBands(s0, new Uint8Array(256));
  assert.deepEqual([...bands], [0, 2, 4, 7, 11, 26, 58, 119, 170, 217]);
  assert.deepEqual([...blazeBands(new Uint8Array(256).fill(255), new Uint8Array(256).fill(255))], Array(10).fill(510));
});

test("blaze: box, emitter positions and levels (float constants 0.1f, 0.25f, 0.0025f)", () => {
  const g = blazeGeometry(320, 240);
  assert.deepEqual([g.boxW, g.xoff, g.boxH, g.bottom], [310, 5, 230, 234]);
  assert.deepEqual([...g.emitterX], [12, 43, 74, 105, 136, 167, 198, 229, 260, 291]);
  const g2 = blazeGeometry(333, 217);
  assert.deepEqual([g2.boxW, g2.xoff, g2.boxH, g2.bottom], [320, 6, 200, 207]);
  assert.equal(g2.emitterX[0], 14);
  assert.equal(blazeLevel(510, 230), 293);
  assert.equal(blazeLevel(100, 230), 57);
  assert.equal(blazeLevel(0, 230), 0);
  assert.equal(blazeSegment(293), 6);
  assert.equal(blazeSegment(57), 2);
  assert.equal(blazeSegment(49), 1);
  assert.equal(blazeSegment(50), 2);
});

test("blaze: action table of rand() % 14", () => {
  assert.deepEqual(BLAZE_ACTIONS, [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3]);
});

test("blaze: one fire pixel per action", () => {
  const w = 4;
  const at = (seq: number[]) => { let i = 0; return () => seq[i++ % seq.length]!; };
  const fresh = () => { const b = new Int32Array(w * 5); b[2 * w + 1] = 0x01ffff00; return b; };
  let b = fresh();
  blazeFirePixel(b, 2 * w + 1, w, at([0]));
  assert.equal(b[2 * w + 1], 0x01fefb00);
  assert.equal(b[2 * w], 0x01fefb00);
  b = fresh();
  blazeFirePixel(b, 2 * w + 1, w, at([15])); // 15 % 14 = 1: right
  assert.equal(b[2 * w + 2], 0x01fefb00);
  b = fresh();
  blazeFirePixel(b, 2 * w + 1, w, at([2]));
  assert.equal(b[2 * w + 1], 0x01fefb00);
  assert.equal(b[1 * w + 1], 0x01fdf900);
  assert.equal(b[0 * w + 1], 0x01fdf900);
  b = fresh();
  b[3 * w + 1] = 0x01123456;
  blazeFirePixel(b, 2 * w + 1, w, at([13]));
  assert.equal(b[3 * w + 1], 0);
  // decay to nothing clears the marker byte; rising always writes it
  b = new Int32Array(w * 5);
  b[2 * w + 1] = 0x01010401;
  blazeFirePixel(b, 2 * w + 1, w, at([2]));
  assert.equal(b[2 * w + 1], 0);
  assert.equal(b[w + 1], 0x01000000);
  // inactive pixels (top byte 0) are left alone and draw no random number
  b = new Int32Array(w * 5);
  b[2 * w + 1] = 0x00ffffff;
  let draws = 0;
  blazeFirePixel(b, 2 * w + 1, w, () => { draws++; return 0; });
  assert.equal(b[2 * w + 1], 0x00ffffff);
  assert.equal(draws, 0);
});

test("blaze: one-frame delay, emitters, hold and decay", () => {
  const w = 320;
  const h = 240;
  const state = blazeInitialState();
  const clearBelow = () => 12; // every active pixel decays in place
  const frame = new Int32Array(w * h).fill(0x123456);
  blazeRender(state, frame, w, h, w, visData(50).spectrum[0], visData(50).spectrum[1], clearBelow);
  assert.ok(frame.every((v) => v === 0)); // fresh buffer replaces the frame
  assert.deepEqual([...state.level], Array(10).fill(57));
  assert.deepEqual([...state.hold], Array(10).fill(2));
  blazeRender(state, frame, w, h, w, visData(50).spectrum[0], visData(50).spectrum[1], clearBelow);
  const lit = [...frame.keys()].filter((i) => frame[i] !== 0);
  const xs = [12, 43, 74, 105, 136, 167, 198, 229, 260, 291];
  assert.deepEqual(lit, xs.flatMap((x) => [177 * w + x, 177 * w + x + 1]));
  for (const i of lit) assert.equal(frame[i], 0x01fefb00);
  blazeRender(state, frame, w, h, w, visData(50).spectrum[0], visData(50).spectrum[1], clearBelow);
  assert.equal(frame[177 * w + 12], 0x01fdf700);
  assert.deepEqual([...state.hold], Array(10).fill(0));
  blazeRender(state, frame, w, h, w, visData(50).spectrum[0], visData(50).spectrum[1], clearBelow);
  assert.deepEqual([...state.level], Array(10).fill(52));
  // next call: 57 > 52 -> the emitters fire again
  blazeRender(state, frame, w, h, w, visData(50).spectrum[0], visData(50).spectrum[1], clearBelow);
  assert.deepEqual([...state.level], Array(10).fill(57));
  // silence: the level keeps sinking by 5 once the hold is over and 0 re-fires a single pixel
  const quiet = blazeInitialState();
  const f2 = new Int32Array(w * h);
  blazeRender(quiet, f2, w, h, w, new Uint8Array(256), new Uint8Array(256), clearBelow);
  assert.equal(quiet.level[0], -5);
  blazeRender(quiet, f2, w, h, w, new Uint8Array(256), new Uint8Array(256), clearBelow);
  assert.equal(quiet.level[0], 0);
  blazeRender(quiet, f2, w, h, w, new Uint8Array(256), new Uint8Array(256), clearBelow);
  assert.equal(f2[234 * w + 12], 0x01fefb00);
  assert.equal(f2[234 * w + 13], 0);
});

test("blaze: a new size reallocates (black frame); the effect draws with makeRand(1)", () => {
  const effect = svp.create();
  const a = new Int32Array(64 * 48);
  for (let i = 0; i < 6; i++) effect.render(a, 64, 48, 64, visData(200), ctx);
  assert.ok(a.some((v) => v !== 0));
  const b = new Int32Array(80 * 60).fill(7);
  effect.render(b, 80, 60, 80, visData(200), ctx);
  assert.ok(b.every((v) => v === 0));
  // same inputs and seed -> same frames
  const e1 = svp.create();
  const e2 = svp.create();
  const f1 = new Int32Array(64 * 48);
  const f2 = new Int32Array(64 * 48);
  for (let i = 0; i < 20; i++) {
    e1.render(f1, 64, 48, 64, visData(120 + i), ctx);
    e2.render(f2, 64, 48, 64, visData(120 + i), ctx);
  }
  assert.deepEqual(f1, f2);
  // the reference transcription with the same generator gives the same frame
  const state = blazeInitialState();
  const rand = msvcRand(1);
  const f3 = new Int32Array(64 * 48);
  for (let i = 0; i < 20; i++) {
    const vd = visData(120 + i);
    blazeRender(state, f3, 64, 48, 64, vd.spectrum[0], vd.spectrum[1], rand);
  }
  assert.deepEqual(f3, f1);
});
