import assert from "node:assert/strict";
import test from "node:test";

import {
  XOO_DEFAULT_COLOURS, XOO_PALETTE, xooBlur, xooInitialState, xooRender, xooTables, svp, type ApeContext, type SvpVisData
} from "./svp-xoo.ts";

const ctx = {} as ApeContext;

function visData(wave: number, spec: number): SvpVisData {
  return {
    millSec: 0,
    waveform: [new Uint8Array(512), new Uint8Array(512).fill(wave)],
    spectrum: [new Uint8Array(256), new Uint8Array(256).fill(spec)]
  };
}

test("xoo: 516-colour table, default 258 colours", () => {
  assert.equal(XOO_PALETTE.length, 516 * 3);
  assert.equal(XOO_DEFAULT_COLOURS, 258);
  const rgb = (i: number) => [XOO_PALETTE[i * 3], XOO_PALETTE[i * 3 + 1], XOO_PALETTE[i * 3 + 2]];
  assert.deepEqual(rgb(0), [0xff, 0x89, 0x5e]);
  assert.deepEqual(rgb(1), [0xff, 0x8a, 0x5f]);
  assert.deepEqual(rgb(100), [0x5f, 0x8b, 0x7e]);
  assert.deepEqual(rgb(257), [0xbf, 0x8e, 0x85]);
  assert.deepEqual(rgb(515), [0x78, 0x86, 0xa2]);
});

test("xoo: sin/cos tables use pi = 3.14159265, j / 2", () => {
  const t = xooTables();
  assert.equal(t.sin[30 * 34 + 31], 7.749999991968799);
  assert.equal(Math.trunc(t.sin[30 * 34 + 31]! * 200), 1549); // not 1550: the binary's pi is short
  assert.equal(Math.trunc(t.cos[30 * 34 + 31]! * 200), 2684);
  assert.equal(t.cos[90 * 34 + 31]! * 200, 5.5641798845927735e-6);
  assert.equal(t.sin[90 * 34 + 31]! * 200, 3100);
  assert.equal(t.sin[17], 0);
});

test("xoo: in-place raster blur uses already-blurred left/upper neighbours and clears the top byte", () => {
  const w = 3;
  const h = 2;
  const v = new Int32Array([0xff000000 | 0x400000, 0, 0, 0, 0, 0x000040]);
  xooBlur(v, w, h, w);
  // (0,0): right 0, left itself 0x40<<16, up itself, down 0 -> R = (0 + 0x40 + 0x40 + 0) >> 2 = 0x20
  assert.equal(v[0], 0x200000);
  // (1,0): right 0, left = new (0,0) 0x20, up itself 0, down (1,1) 0 -> 0x20 >> 2 = 8
  assert.equal(v[1], 0x080000);
  // (2,0): right itself 0, left new 0x08, up itself 0, down (2,1) B 0x40 -> R 2, B 0x10
  assert.equal(v[2], 0x020010);
  // (0,1): right (1,1) 0, left itself 0, up new (0,0) 0x20, down itself 0 -> R 8
  assert.equal(v[3], 0x080000);
  // (1,1): right (2,1) B 0x40, left new (0,1) R 8, up new (1,0) R 8, down itself 0 -> R 4, B 0x10
  assert.equal(v[4], 0x040010);
  // (2,1): right itself B 0x40, left new (1,1), up new (2,0), down itself
  assert.equal(v[5], (((4 + 2) >> 2) << 16) | ((0x40 + 0x10 + 0x10 + 0x40) >> 2));
});

test("xoo: dots, line and colour cycling", () => {
  const w = 64;
  const h = 48;
  // silence: wave 0 -> j = 0: all 360 dots at the centre; line along the middle row
  const s = xooInitialState();
  const v = new Int32Array(w * h);
  const mid = (h >> 1) * w;
  const noBlur = new Int32Array(w * h);
  // replicate without the blur to check the drawing
  const pal = (i: number) => (XOO_PALETTE[i * 3]! << 16) | (XOO_PALETTE[i * 3 + 1]! << 8) | XOO_PALETTE[i * 3 + 2]!;
  // colour index advances before each use and wraps after entry 257 (default 258 colours)
  let entry = 0;
  const next = () => { entry = entry + 1 > 257 ? 0 : entry + 1; return pal(entry); };
  let orAll = 0;
  for (let i = 0; i < 360; i++) orAll |= next();
  assert.equal(entry, 102);
  noBlur[mid + (w >> 1)] = orAll;
  for (let x = 0; x < w; x++) noBlur[mid + x] = next();
  xooBlur(noBlur, w, h, w);
  xooRender(s, v, w, h, w, visData(0, 0));
  assert.deepEqual(v, noBlur);
  assert.equal(s.frameCount, 1);
  for (let i = 0; i < 3; i++) xooRender(s, v, w, h, w, visData(0, 0));
  assert.equal(s.frameCount, 0);
  assert.equal(s.colourStart, 3);
});

test("xoo: dot radius from Spectrum[1][128..254] max and Waveform[1]", () => {
  const w = 400;
  const h = 400;
  const vd = visData(0xff, 0); // j = 31
  vd.spectrum[1][127] = 250; // outside the scanned range
  vd.spectrum[1][200] = 10;
  const v = new Int32Array(w * h);
  const s = xooInitialState();
  const t = xooTables();
  // i = 90: x = 200 + trunc(sin * 31 / 2 * 10) = 355, y = 200 + trunc(~0) = 200
  assert.equal(Math.trunc(t.sin[90 * 34 + 31]! * 10), 155);
  xooRender(s, v, w, h, w, vd);
  assert.notEqual(v[200 * w + 355], 0);
  // the whole frame has been blurred: top bytes clear
  assert.ok(v.every((p) => p >>> 24 === 0));
  // deterministic across instances
  const a = new Int32Array(64 * 48);
  const b = new Int32Array(64 * 48);
  const ea = svp.create();
  const eb = svp.create();
  for (let i = 0; i < 6; i++) {
    ea.render(a, 64, 48, 64, visData(i * 40, i * 30), ctx);
    eb.render(b, 64, 48, 64, visData(i * 40, i * 30), ctx);
  }
  assert.deepEqual(a, b);
});
