import assert from "node:assert/strict";
import test from "node:test";

import {
  LIQUID_FADE_LENGTH, LIQUID_FADE_PAUSE, liquidBlend, liquidFadeProfile, liquidFrameParams, liquidInitialState, liquidRadiusTable,
  liquidRender, liquidTexel, liquidTextures, svp,
  type ApeContext, type SvpVisData
} from "./svp-liquid.ts";

function msvcRand(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 214013) + 2531011) >>> 0;
    return (s >>> 16) & 0x7fff;
  };
}

const ctx = { makeRand: msvcRand } as unknown as ApeContext;

function visData(bass = 0): SvpVisData {
  const s = new Uint8Array(256);
  s.fill(bass, 0, 6);
  return {
    millSec: 0,
    waveform: [new Uint8Array(512), new Uint8Array(512)],
    spectrum: [s, s.slice()]
  };
}

test("liquid: built-in textures (no Liquid_*.bmp): x ^ y and a 0x23C981 checkerboard", () => {
  const [t0, t1] = liquidTextures();
  assert.equal(t0![0x1234], 0x34 ^ 0x12);
  assert.equal(t0![0xffff], 0);
  assert.equal(t1![10 * 256 + 40], 0x23c981);
  assert.equal(t1![40 * 256 + 40], 0);
  assert.equal(t1![40 * 256 + 10], 0x23c981);
});

test("liquid: radius table (int)(sqrt(u^2 + v^2) * 700), u, v in -1..1", () => {
  const t = liquidRadiusTable(8, 6);
  assert.equal(t[0], 989);
  assert.equal(t[3 * 8 + 4], 0);
  assert.equal(t[3 * 8 + 5], 175);
  assert.equal(t[5 * 8 + 7], 702);
  assert.ok(liquidRadiusTable(640, 480).reduce((m, v) => Math.max(m, v), 0) < 1024);
});

test("liquid: frame-0 mapping parameters (320 x 240, silence)", () => {
  const f = liquidFrameParams(0, 320, 240, 0, 0);
  assert.deepEqual(f, { p1: 52428, p2: 0, p3: 0, p4: -69905, u0: -8388480, v0: 8388600, offU: 134217728, offV: 201326592 });
  assert.equal(liquidTexel(-8388480, 8388600, 4096, f.offU, f.offV), 16128);
});

test("liquid: first frame replaces the frame with texture 0 (rand 41 -> 0, 18467 -> 1)", () => {
  const w = 320;
  const h = 240;
  const frame = new Int32Array(w * h).fill(-1);
  svp.create().render(frame, w, h, w, visData(0), ctx);
  assert.equal(frame[0], 63);
  assert.equal(frame[120 * w + 160], 64);
  assert.equal(frame[239 * w + 319], 190);
  assert.equal(frame[50 * w + 100], 90);
  assert.ok(frame.every((v) => v >= 0 && v < 256));
});

test("liquid: bass ripple enters the radius history 20 entries per frame", () => {
  const state = liquidInitialState();
  const rand = msvcRand(1);
  const frame = new Int32Array(16 * 12);
  liquidRender(state, frame, 16, 12, 16, visData(100), rand); // bins 0-5 = 100 in both channels: sum 1200
  assert.equal(state.avgA, 120);
  for (let k = 0; k < 20; k++) assert.equal(state.history[k], 4096 - (120 * (20 - k)) / 4);
  assert.equal(state.history[20], 4096);
  liquidRender(state, frame, 16, 12, 16, visData(100), rand); // avgA 228: delta 108
  assert.equal(state.avgA, 228);
  assert.equal(state.history[20], 4096 - 600);
  assert.equal(state.history[39], 4096 - 30);
  assert.equal(state.history[0], 3496 - 540);
});

test("liquid: cross-fade blend and profiles", () => {
  assert.equal(liquidBlend(0x0000ff, 0x23c981, 128), 0x1164bf);
  assert.equal(liquidBlend(0x123456, 0x123456, 255), 0x113355); // (c * 255) >> 8 per channel
  const prof = new Int32Array(1024);
  assert.equal(liquidFadeProfile(prof, 0, () => 0, 50), 26);
  assert.deepEqual([prof[0], prof[1023]], [-1024, -1]);
  assert.equal(liquidFadeProfile(prof, 1, () => 0, 50), 26);
  assert.deepEqual([prof[0], prof[5]], [0, -5]);
  assert.equal(liquidFadeProfile(prof, 2, () => 16384, 50), 30); // m = 7
  assert.deepEqual([prof[0], prof[1], prof[2], prof[100]], [-200, -192, -184, -482]);
  assert.equal(liquidFadeProfile(prof, 3, () => 16384, 50), 30); // m = 5
  assert.deepEqual([prof[0], prof[1], prof[512], prof[1023]], [-1224, -1216, -712, -207]);
});

test("liquid: fadePause 300, then a 50-frame fade, then the textures swap", () => {
  assert.equal(LIQUID_FADE_PAUSE, 300);
  assert.equal(LIQUID_FADE_LENGTH, 50);
  const state = liquidInitialState();
  const rand = msvcRand(1);
  const w = 32;
  const h = 24;
  const frame = new Int32Array(w * h);
  for (let i = 0; i < 300; i++) liquidRender(state, frame, w, h, w, visData(0), rand);
  assert.equal(state.fading, true); // rand 6334 -> profile 0 (linear outwards), step 26
  assert.equal(state.step, 26);
  assert.equal(state.profile[0], -1024);
  for (let i = 0; i < 49; i++) liquidRender(state, frame, w, h, w, visData(0), rand);
  assert.equal(state.fading, true);
  assert.equal(state.profile[0], -1024 + 26 * 49);
  liquidRender(state, frame, w, h, w, visData(0), rand);
  assert.equal(state.fading, false);
  assert.equal(state.texA, 1);
  assert.equal(state.texB, 0); // rand 26500 -> 1 and 19169 -> 1 are rejected, 15724 -> 0
  assert.equal(state.countdown, 300);
  // after the swap the frame shows texture 1 only (0 or 0x23C981)
  liquidRender(state, frame, w, h, w, visData(0), rand);
  assert.ok(frame.every((v) => v === 0 || v === 0x23c981));
});
