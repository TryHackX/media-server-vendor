import assert from "node:assert/strict";
import test from "node:test";

import {
  ftol, svp, VORONOI_PALETTE, voronoiBars, voronoiField, voronoiPaletteIndex, voronoiShift, voronoiSites,
  type ApeContext, type SvpVisData
} from "./svp-voronoi.ts";

const ctx = {} as ApeContext;

function visData(millSec: number, sample: number): SvpVisData {
  return {
    millSec,
    waveform: [new Uint8Array(512).fill(sample), new Uint8Array(512).fill(sample)],
    spectrum: [new Uint8Array(256), new Uint8Array(256)]
  };
}

test("voronoi: palette at 0x10007030 is 256 B,G,R entries of 0..63", () => {
  assert.equal(VORONOI_PALETTE.length, 768);
  assert.deepEqual([...VORONOI_PALETTE.subarray(0, 6)], [0, 0, 0, 1, 0, 0]);
  assert.deepEqual([...VORONOI_PALETTE.subarray(48 * 3, 48 * 3 + 3)], [0x38, 0x1c, 0x00]);
  assert.deepEqual([...VORONOI_PALETTE.subarray(100 * 3, 100 * 3 + 3)], [0x23, 0x00, 0x23]);
  assert.deepEqual([...VORONOI_PALETTE.subarray(232 * 3, 232 * 3 + 3)], [0x3f, 0x20, 0x00]);
  assert.deepEqual([...VORONOI_PALETTE.subarray(765)], [0, 0, 0]);
  assert.ok(Math.max(...VORONOI_PALETTE) <= 63);
});

test("voronoi: _ftol truncates; palette index and time base", () => {
  assert.equal(ftol(2.999), 2);
  assert.equal(ftol(-2.999), -2);
  assert.equal(voronoiPaletteIndex(123456), 165);
  assert.equal(ftol(123456 * 0.03333333333333333), 4115);
});

test("voronoi: distance shift by frame width", () => {
  assert.equal(voronoiShift(100), 2);
  assert.equal(voronoiShift(159), 2);
  assert.equal(voronoiShift(160), 3);
  assert.equal(voronoiShift(299), 3);
  assert.equal(voronoiShift(300), 5);
  assert.equal(voronoiShift(511), 5);
});

test("voronoi: the 15 sites on their Lissajous paths", () => {
  const at0 = voronoiSites(0, 320, 240);
  assert.deepEqual([...at0.subarray(0, 8)], [160, 216, 287, 203, 68, 84, 32, 117]);
  assert.deepEqual([...at0.subarray(28, 30)], [246, 166]);
  const at1000 = voronoiSites(1000, 320, 240);
  assert.deepEqual([...at1000.subarray(0, 6)], [40, 48, 283, 213, 43, 206]);
  assert.deepEqual([...at1000.subarray(26, 30)], [287, 215, 103, 141]);
});

test("voronoi: field equals the binary's incremental distance update (unsigned compare, sites 14..1)", () => {
  const w = 37;
  const h = 23;
  const sites = voronoiSites(777, w, h);
  const buf = new Int32Array(w * h);
  voronoiField(buf, sites, 60, w, h);
  // literal transcription of 0x10001150
  const pal = [VORONOI_PALETTE[180]!, VORONOI_PALETTE[181]!, VORONOI_PALETTE[182]!];
  const dist = new Uint32Array(15);
  let off = 0;
  let c0 = 0, c1 = 0, c2 = 0;
  for (let y = 0; y < h; y++) {
    for (let k = 14; k >= 1; k--) {
      const dy = (y - sites[k * 2 + 1]!) | 0;
      dist[k] = Math.imul(dy, dy) + Math.imul(sites[k * 2]!, sites[k * 2]!);
    }
    for (let x = 0; x < w; x++, off++) {
      if (!(x & 1)) {
        let min = 0x7fffffff;
        let best = 14;
        for (let k = 14; k >= 1; k--) {
          const sx = sites[k * 2]!;
          const ebx = (Math.imul(sx, 0x3fffffff) + x) | 0;
          const v = (dist[k]! + Math.imul(ebx, 4) + 4) >>> 0;
          dist[k] = v;
          if (v < min) { min = v; best = k; }
        }
        const d = dist[best]! >>> 2;
        c2 = Math.min(255, pal[2]! + d);
        c1 = Math.min(255, pal[1]! + d);
        c0 = Math.min(255, pal[0]! + d);
      }
      assert.equal(buf[off], (c2 << 16) | (c1 << 8) | c0, `pixel ${x},${y}`);
    }
  }
});

test("voronoi: waveform bars brighten (c + 255) >> 1 around the middle row", () => {
  const w = 16;
  const h = 40;
  const buf = new Int32Array(w * h).fill(0x00102030);
  const wave = new Uint8Array(512).fill(0x80); // silence after ^0x80 -> 16 rows
  voronoiBars(buf, wave, w, h);
  const lit = (0x10 + 255) >> 1 << 16 | (0x20 + 255) >> 1 << 8 | (0x30 + 255) >> 1;
  for (let y = 0; y < h; y++) {
    const expect = y >= 20 - 8 && y < 20 - 8 + 16 ? lit : 0x00102030;
    assert.equal(buf[y * w + 3], expect, `row ${y}`);
  }
  // full-scale sample: 0xff >> 3 = 31 rows, starting at mid - 15
  const buf2 = new Int32Array(w * h);
  voronoiBars(buf2, new Uint8Array(512).fill(0xff), w, h);
  let rows = 0;
  for (let y = 0; y < h; y++) if (buf2[y * w] === 0x7f7f7f) rows++;
  assert.equal(rows, 31);
  assert.equal(buf2[(20 - 15) * w], 0x7f7f7f);
  assert.equal(buf2[(20 - 16) * w], 0);
});

test("voronoi: replaces the frame; draws nothing above 511 x 383; waveform refresh every > 50 ms", () => {
  const effect = svp.create();
  const big = new Int32Array(512 * 10).fill(0x123456);
  effect.render(big, 512, 10, 512, visData(1000, 0), ctx);
  assert.ok(big.every((v) => v === 0x123456));

  const w = 64;
  const h = 48;
  const expected = (millSec: number, waveByte: number): Int32Array => {
    const buf = new Int32Array(w * h);
    voronoiField(buf, voronoiSites(ftol(millSec * 0.03333333333333333), w, h), voronoiPaletteIndex(millSec), w, h);
    voronoiBars(buf, new Uint8Array(512).fill(waveByte), w, h);
    return buf;
  };
  const frame = new Int32Array(w * h).fill(0x7f00ff);
  effect.render(frame, w, h, w, visData(1000, 0x7f), ctx); // refresh: 0x7f ^ 0x80 = 0xff -> 31 rows
  assert.deepEqual(frame, expected(1000, 0xff));
  assert.ok(frame.every((v) => (v >>> 24) === 0));
  // 30 ms later: no refresh, the bars keep the old samples although the input is now silent
  effect.render(frame, w, h, w, visData(1030, 0x80), ctx);
  assert.deepEqual(frame, expected(1030, 0xff));
  // 51 ms after the refresh: new samples (0x80 ^ 0x80 = 0 -> no bar)
  effect.render(frame, w, h, w, visData(1051, 0x80), ctx);
  assert.deepEqual(frame, expected(1051, 0x00));
  // a pitch wider than the frame leaves the gap alone
  const wide = new Int32Array((w + 3) * h).fill(-1);
  svp.create().render(wide, w, h, w + 3, visData(1000, 0x7f), ctx);
  for (let y = 0; y < h; y++) {
    assert.deepEqual(wide.subarray(y * (w + 3), y * (w + 3) + w), expected(1000, 0xff).subarray(y * w, y * w + w));
    assert.equal(wide[y * (w + 3) + w], -1);
  }
});
