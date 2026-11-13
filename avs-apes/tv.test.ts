import assert from "node:assert/strict";
import test from "node:test";

import { ape, parseTvConfig, resetTvRand, tvNoise, TV_DEFAULTS, type ApeContext } from "./tv.ts";

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

function makeCtx(w: number, h: number) {
  const seeds: (number | undefined)[] = [];
  const ctx: ApeContext = {
    w, h, isBeat: false,
    visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: () => { throw new Error("tv.ape has its own CRT rand"); },
    makeRand: (seed?: number) => { seeds.push(seed); return msvcRand(seed ?? 1); },
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null,
    now: () => 0
  };
  return { ctx, seeds };
}

test("config parsing: defaults, the all-or-nothing colour block, and the six preset configs", () => {
  assert.deepEqual(parseTvConfig(new Uint8Array(0)), TV_DEFAULTS);
  assert.deepEqual(TV_DEFAULTS.colors, [0xff00, 0xc000, 0x8000, 0x4000]);
  // 4..19 bytes: only "enabled".
  assert.deepEqual(parseTvConfig(hex("00000000")), { enabled: 0, colors: [0xff00, 0xc000, 0x8000, 0x4000] });
  assert.deepEqual(parseTvConfig(hex("00000000ffffff00000000000000000000000000".slice(0, 38))),
    { enabled: 0, colors: [0xff00, 0xc000, 0x8000, 0x4000] });
  const presets: [string, number[]][] = [
    ["01000000ffffff0000000000c0c0c00080808000", [0xffffff, 0x000000, 0xc0c0c0, 0x808080]],
    ["01000000ffffff00bebebe005957580000000000", [0xffffff, 0xbebebe, 0x585759, 0x000000]],
    ["01000000ffffff00cfcfcf00828282001f1f1f00", [0xffffff, 0xcfcfcf, 0x828282, 0x1f1f1f]],
    ["01000000ffffff00c0c0c0008080800000000000", [0xffffff, 0xc0c0c0, 0x808080, 0x000000]],
    ["010000000000ff0000ff0000ff000000ffffff00", [0xff0000, 0x00ff00, 0x0000ff, 0xffffff]],
    ["0100000000000000ff000000a000000000000000", [0x000000, 0x0000ff, 0x0000a0, 0x000000]]
  ];
  for (const [h, colors] of presets) assert.deepEqual(parseTvConfig(hex(h)), { enabled: 1, colors }, h);
});

test("noise arithmetic: per byte (px>>1)+(c>>1), colour index rand()&3, top byte included", () => {
  const colors = [0x00ffffff, 0x00010203, 0x80808080 | 0, 0x00000000];
  const fb = Int32Array.from([0x00ffffff, 0x00ffffff, 0x00ffffff, 0x00ffffff, 0xff000001 | 0, 0x00030303]);
  const draws = [4, 1, 2, 3, 6, 32767]; // & 3 -> 0, 1, 2, 3, 2, 3
  let k = 0;
  tvNoise(fb, 6, colors, () => draws[k++]!);
  assert.equal(k, 6);
  assert.deepEqual(Array.from(fb, (x) => x >>> 0), [
    0x00fefefe,             // 7f+7f per byte
    0x007f8080,             // 7f+0, 7f+1, 7f+1 (0x01>>1 = 0, 0x02>>1 = 1, 0x03>>1 = 1)
    0x40bfbfbf,             // 7f+40 per byte, top 0+0x40
    0x007f7f7f,             // halves only
    0xbf404040,             // top 0x7f+0x40; 0x01>>1 = 0 + 0x40
    0x00010101              // 0x03>>1 = 1, colour 0
  ]);
});

test("render: private generator from seed 1, one rand() per pixel in memory order, shared by instances", () => {
  resetTvRand();
  const { ctx, seeds } = makeCtx(2, 2);
  const a = ape.create(hex("01000000ffffff0000000000c0c0c00080808000"));
  const fb = new Int32Array(4); // black
  assert.equal(a.render(ctx, fb, new Int32Array(4)), 0);
  // rand() from seed 1: 41, 18467, 6334, 26500 -> & 3 = 1, 3, 2, 0 -> colours 0, 0x808080, 0xc0c0c0, 0xffffff
  assert.deepEqual(Array.from(fb), [0x000000, 0x404040, 0x606060, 0x7f7f7f]);
  assert.deepEqual(seeds, [1]);
  // A second instance continues the same sequence: 19169, 15724, 11478, 29358 -> 1, 0, 2, 2.
  const b = ape.create(hex("01000000ffffff0000000000c0c0c00080808000"));
  const fb2 = new Int32Array(4);
  b.render(ctx, fb2, new Int32Array(4));
  assert.deepEqual(Array.from(fb2), [0x000000, 0x7f7f7f, 0x606060, 0x606060]);
  assert.deepEqual(seeds, [1]);
  resetTvRand();
});

test("render: disabled draws nothing; an odd pixel count is fully processed", () => {
  resetTvRand();
  const { ctx, seeds } = makeCtx(3, 1);
  const off = ape.create(hex("00000000ffffff0000000000c0c0c00080808000"));
  const fb = Int32Array.from([7, 8, 9]);
  assert.equal(off.render(ctx, fb, new Int32Array(3)), 0);
  assert.deepEqual(Array.from(fb), [7, 8, 9]);
  assert.deepEqual(seeds, []);
  // Defaults (no config): green colours; seed-1 draws & 3 = 1, 3, 2 -> 0xc000, 0x4000, 0x8000.
  const def = ape.create(new Uint8Array(0));
  const fb2 = new Int32Array(3);
  def.render(ctx, fb2, new Int32Array(3));
  assert.deepEqual(Array.from(fb2), [0x6000, 0x2000, 0x4000]);
  resetTvRand();
});
