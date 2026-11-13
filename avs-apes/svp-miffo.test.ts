import assert from "node:assert/strict";
import test from "node:test";

import {
  addPixel, lookAt, matVec, miffoCamera, miffoInit, miffoLevel, miffoRender, MIFFO_TEXTURE, packColor, project, rotation,
  splat, sprite, svp, type ApeContext, type MiffoFrame, type SvpVisData
} from "./svp-miffo.ts";

function msvcRand(seed = 1): () => number {
  let h = seed >>> 0;
  return () => {
    h = (Math.imul(h, 214013) + 2531011) >>> 0;
    return (h >>> 16) & 0x7fff;
  };
}

const ctx = { makeRand: (seed?: number) => msvcRand(seed ?? 1) } as unknown as ApeContext;

function visData(wave = 0, spec = 0): SvpVisData {
  return {
    millSec: 0,
    waveform: [new Uint8Array(512).fill(wave), new Uint8Array(512).fill(wave)],
    spectrum: [new Uint8Array(256).fill(spec), new Uint8Array(256).fill(spec)]
  };
}

function frame(w: number, h: number, fill = 0): MiffoFrame {
  return { video: new Int32Array(w * h).fill(fill), w, h, pitch: w };
}

test("miffo: Initialize's draws from the DLL's rand (seed 1)", () => {
  const s = miffoInit(msvcRand(1));
  assert.deepEqual([...s.periods], [841, 1267, 1134, 1300, 969, 1524, 1278, 1158, 1762, 1264, 1505, 945, 1081, 1627, 1761, 1291]);
  assert.deepEqual([s.x[0], s.y[0], s.z[0], s.bright[0], s.type[0]], [495, 442, 327, 111, 1]);
  assert.deepEqual([s.x[1], s.y[1], s.z[1], s.bright[1]], [-109, 104, 402, 253]);
  assert.deepEqual([s.x[1999], s.y[1999], s.z[1999], s.bright[1999]], [412, 422, 337, 109]);
});

test("miffo: rotation (Rz Ry Rx, 6.285 rad per 65536) and matrix-vector product in float32", () => {
  const m = rotation(1000, 2000, 3000);
  const expect = [0.941313624382019, 0.26494458317756653, 0.20912441611289978, 0, -0.27854838967323303, 0.9596710801124573,
    0.03797603026032448, 0, -0.19062912464141846, -0.09399862587451935, 0.9771513938903809, 0];
  assert.deepEqual([...m], expect);
  assert.deepEqual(matVec(m, 100, 0, 0), [94.13136291503906, -27.854839324951172, -19.062911987304688]);
  assert.deepEqual(matVec(m, 0, -37.5, 12.25), [-7.373647689819336, -35.5224609375, 15.4950532913208]);
  assert.deepEqual([...rotation(0, 0, 0)], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  // only the low 16 bits of the angle count
  assert.deepEqual([...rotation(65536 + 5, -65536 * 3, 7)], [...rotation(5, 0, 7)]);
});

test("miffo: camera at t = 0 and its look-at matrix", () => {
  const s = miffoInit(msvcRand(1));
  const cam = miffoCamera(s, 320, 240);
  assert.deepEqual([...cam.pos], [0, -400, 400]);
  assert.deepEqual([...cam.matrix], [-0.5773502588272095, -0.5773502588272095, -0.5773502588272095, 0, 0.7812932133674622,
    -0.1852550059556961, -0.5960381627082825, 0, -0.2371656894683838, 0.7952026128768921, -0.5580369234085083, 0]);
  assert.equal(cam.cx, 160);
  assert.equal(cam.cy, 120);
  assert.equal(cam.sx, 1);
  assert.equal(cam.sy, Math.fround(240 * Math.fround(1 / 240)));
  s.t = 300;
  assert.deepEqual([...miffoCamera(s, 320, 240).pos], [360.18096923828125, -294.31646728515625, 269.5909118652344]);
  // look-at of a plain direction: D = +z, up = +y -> rows (D x U) = (-1, 0, 0), U, D
  assert.deepEqual([...lookAt(Float32Array.of(0, 0, 5), Float32Array.of(0, 1, 0))], [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
});

test("miffo: projection (focal 140, x mirrored, far branch multiplies by -1000)", () => {
  const cam = { pos: new Float32Array(3), matrix: new Float32Array(12), cx: 160, cy: 120, sx: 1, sy: 1 };
  assert.deepEqual(project(cam, 14, 7, 140), [174, 113]);
  assert.deepEqual(project(cam, 1, 1, 0.1), [Math.fround(160 + 1000 * Math.fround(-1000) / -1000), Math.fround(120 + Math.fround(-1000))]);
});

test("miffo: level from samples 0..3 of both channels, bytes read as signed", () => {
  const vd = visData(0, 0);
  vd.spectrum[0][0] = 200; // -56 -> 56
  vd.waveform[0][0] = 100;
  vd.spectrum[1][3] = 10;
  vd.waveform[1][3] = 0xf6; // -10
  // acc = 56 * 100 + 10 * -10 = 5500 -> |5500 * 0.0025f| / 16
  assert.equal(miffoLevel(0, vd), Math.fround(Math.abs(5500 * Math.fround(0.0025)) * 0.0625));
  vd.spectrum[0][4] = 255; // index 4 is not read
  assert.equal(miffoLevel(0, vd), Math.fround(Math.abs(5500 * Math.fround(0.0025)) * 0.0625));
});

test("miffo: packed colours carry between bytes; saturating add clears the top byte", () => {
  assert.equal(packColor(300, 300, 300), 0x12d2d2c);
  const f = frame(4, 4, 0x7f102030);
  addPixel(f, 1, 1, packColor(300, 300, 300));
  assert.equal(f.video[5], 0x3d4d5c);
  addPixel(f, 2, 2, 0xffffff);
  assert.equal(f.video[10], 0xffffff);
  addPixel(f, 4, 0, 0x10);
  assert.equal(f.video[3], 0x7f102030);
});

test("miffo: bilinear splat weights in float32", () => {
  const f = frame(40, 40);
  splat(f, 10.25, 20.5, 100, 0, 0);
  assert.equal(f.video[20 * 40 + 10], 37 << 16);
  assert.equal(f.video[20 * 40 + 11], 12 << 16);
  assert.equal(f.video[21 * 40 + 10], 37 << 16);
  assert.equal(f.video[21 * 40 + 11], 12 << 16);
  const g = frame(40, 40);
  splat(g, 1.99, 10, 100, 100, 100); // x < 2: nothing
  splat(g, 38.5, 10, 100, 100, 100); // x > w - 2: nothing
  assert.ok(g.video.every((v) => v === 0));
  splat(g, 38, 38, 0, 0, 200);
  assert.equal(g.video[38 * 40 + 38], 200);
});

test("miffo: glow sprite (64 x 64 from the DLL) scaled to size", () => {
  assert.equal(MIFFO_TEXTURE.length, 4096);
  assert.equal(MIFFO_TEXTURE[32 * 64 + 32], 0xffffff);
  assert.equal(MIFFO_TEXTURE[30 * 64 + 26], 0x9c6563);
  assert.equal(MIFFO_TEXTURE[0], 0);
  let sum = 0;
  for (const v of MIFFO_TEXTURE) sum += v;
  assert.equal(sum, 7812629555);
  const f = frame(100, 100);
  sprite(f, 50, 50, 64, MIFFO_TEXTURE);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) assert.equal(f.video[(18 + y) * 100 + 18 + x], MIFFO_TEXTURE[y * 64 + x]);
  }
  const g = frame(100, 100);
  sprite(g, 50, 50, 16, MIFFO_TEXTURE); // step 256: every 4th texel
  assert.equal(g.video[(42 + 8) * 100 + 42 + 8], MIFFO_TEXTURE[32 * 64 + 32]);
  assert.equal(g.video[(42 + 7) * 100 + 42 + 6], MIFFO_TEXTURE[28 * 64 + 24]);
  const h = frame(100, 100);
  sprite(h, 50, 50, -3, MIFFO_TEXTURE);
  assert.ok(h.video.every((v) => v === 0));
});

test("miffo: Render adds onto the frame, deterministic, time and angles advance", () => {
  const a = svp.create();
  const b = svp.create();
  const fa = new Int32Array(160 * 120).fill(0x01010101);
  const fb = new Int32Array(160 * 120).fill(0x01010101);
  for (let i = 0; i < 5; i++) {
    a.render(fa, 160, 120, 160, visData(i * 20, 30), ctx);
    b.render(fb, 160, 120, 160, visData(i * 20, 30), ctx);
  }
  assert.deepEqual(fa, fb);
  let changed = 0;
  for (const v of fa) {
    if (v !== 0x01010101) {
      changed++;
      assert.equal(v >>> 24, 0);
      assert.ok((v & 0xff) >= 1 && ((v >> 8) & 0xff) >= 1 && ((v >> 16) & 0xff) >= 1);
    }
  }
  assert.ok(changed > 100);
  const s = miffoInit(msvcRand(1));
  miffoRender(s, frame(64, 48), visData());
  assert.equal(s.t, 3);
  assert.deepEqual([s.angX, s.angY, s.angZ], [300, 430, 550]);
  assert.deepEqual([s.type[0], s.bright[0], s.x[0], s.y[0], s.z[0]], [5, 300, 0, 0, 0]);
  assert.deepEqual([s.type[50], s.type[178], s.type[306], s.type[434], s.type[562], s.type[690]], [5, 5, 5, 5, 5, 5]);
  assert.deepEqual([s.type[1], s.type[129], s.type[257], s.type[385], s.type[513], s.type[641], s.type[768]], [2, 2, 3, 3, 4, 4, 1]);
  assert.equal(s.bright[1], 508);
  assert.equal(s.bright[50], 78);
});
