import assert from "node:assert/strict";
import test from "node:test";

import {
  ape, aaLine, amoebaVolume, backAlpha, blendAdditive, blendHalf, blendReplace, centerAlpha, forwardAlpha,
  parseAmoebaConfig, AMOEBA_DEFAULTS, type ApeContext
} from "./amoeba.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

function makeCtx(w: number, h: number, fillWave?: (i: number) => number): ApeContext {
  const visdata = new Int8Array(2304);
  if (fillWave) for (let i = 0; i < 576; i++) visdata[1152 + i] = fillWave(i);
  return {
    w, h, isBeat: false, visdata, visdataUnsigned: new Uint8Array(visdata.buffer),
    rand: () => 0, makeRand: () => () => 0, registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null, now: () => 0
  };
}

test("config parsing: the presets' configs, defaults, memcpy semantics and clamps", () => {
  // ishan/Rocky_AVS_IV/Rocky Avs - 13 - Electric Blue's.avs
  assert.deepEqual(parseAmoebaConfig(hex("080000001e000000ffffff000200000032000000")),
    { arms: 8, segments: 30, color: 0xffffff, mode: 2, size: 50 });
  // montana/Conspiracy/15 - Montana - Pleasure.avs (two instances)
  assert.deepEqual(parseAmoebaConfig(hex("030000001e0000008000ff000200000064000000")),
    { arms: 3, segments: 30, color: 0xff0080, mode: 2, size: 100 });
  assert.deepEqual(parseAmoebaConfig(hex("050000001e00000000ff00000200000032000000")),
    { arms: 5, segments: 30, color: 0x00ff00, mode: 2, size: 50 });
  assert.deepEqual(parseAmoebaConfig(new Uint8Array(0)), AMOEBA_DEFAULTS);
  assert.deepEqual(AMOEBA_DEFAULTS, { arms: 8, segments: 30, color: 0xffffff, mode: 1, size: 50 });
  // memcpy of a partial config: 5 bytes overwrite arms and the low byte of segments (30 -> 0x07).
  assert.deepEqual(parseAmoebaConfig(hex("0300000007")), { arms: 3, segments: 7, color: 0xffffff, mode: 1, size: 50 });
  // longer than 20 bytes: not copied at all.
  assert.deepEqual(parseAmoebaConfig(hex("030000001e0000008000ff00020000006400000000")), AMOEBA_DEFAULTS);
  // clamps: arms >= 1, segments >= 2 (<= 2 -> 2), size 1..100.
  assert.deepEqual(parseAmoebaConfig(hex("00000000010000000000000000000000f4010000")),
    { arms: 1, segments: 2, color: 0, mode: 0, size: 100 });
  assert.deepEqual(parseAmoebaConfig(hex("fbffffff030000000000000000000000ffffffff")),
    { arms: 1, segments: 3, color: 0, mode: 0, size: 1 });
});

test("blend functions on chosen pixels", () => {
  assert.equal(blendReplace(0xffffff, 0, 255), 0xfefefe);
  assert.equal(blendReplace(0, 0xffffff, 0), 0xfefefe);
  // r: 0x80*128>>8 + 0x10*127>>8 = 64+7; g: 32+15; b: 16+31
  assert.equal(blendReplace(0x804020, 0x102040, 128), 0x472f2f);
  // only the low byte of alpha counts: 256 -> 0
  assert.equal(blendReplace(0xffffff, 0x000000, 256), 0);
  assert.equal(blendHalf(0xffffff, 0, 255), 0x7e7e7e);
  assert.equal(blendHalf(0xffffff, 0xffffff, 255), 0x7e7e7e + 0x7f7f7f);
  assert.equal(blendAdditive(0xffffff, 0x808080, 255), 0xffffff);
  assert.equal(blendAdditive(0x404040, 0x101010, 128), 0x303030);
  assert.equal(blendAdditive(0xff0000, 0x00ff00, 0x20), 0x1fff00);
  // the destination's top byte is dropped
  assert.equal(blendAdditive(0x000000, 0x7f010203, 255) >>> 0, 0x010203);
});

test("anti-aliasing profile of the line", () => {
  const rows: [number, number, number, number][] = [
    [0, 128, 179, 0], [1, 129, 179, 0], [63, 217, 133, 0], [64, 218, 132, 0],
    [127, 255, 55, 55], [128, 255, 52, 57], [191, 218, 0, 133], [254, 129, 0, 179]
  ];
  for (const [t, c, f, b] of rows) {
    assert.equal(centerAlpha(t), c, `centre ${t}`);
    assert.equal(forwardAlpha(t), f, `forward ${t}`);
    assert.equal(backAlpha(t), b, `back ${t}`);
  }
});

test("line shapes: vertical, horizontal (end excluded), diagonal", () => {
  const w = 6, h = 6;
  let fb = new Int32Array(w * h);
  aaLine(fb, 0xffffff, w, h, 2, 1, 2, 3, 1);
  for (let y = 1; y <= 3; y++) {
    assert.equal(fb[y * w + 2], 0xfefefe);
    assert.equal(fb[y * w + 1], 0x1f1f1f);
    assert.equal(fb[y * w + 3], 0x1f1f1f);
  }
  assert.equal(fb[0 * w + 2], 0);
  assert.equal(fb[4 * w + 2], 0);

  fb = new Int32Array(w * h);
  aaLine(fb, 0xffffff, w, h, 3, 2, 1, 2, 1); // swapped to 1..3, x = 1, 2 only
  for (const x of [1, 2]) {
    assert.equal(fb[2 * w + x], 0xfefefe);
    assert.equal(fb[1 * w + x], 0x1f1f1f);
    assert.equal(fb[3 * w + x], 0x1f1f1f);
  }
  assert.equal(fb[2 * w + 3], 0);

  fb = new Int32Array(w * h);
  aaLine(fb, 0xffffff, w, h, 0, 0, 2, 2, 1); // dy >= dx: t stays 127
  const lit = new Map<number, number>();
  for (let i = 0; i < fb.length; i++) if (fb[i]) lit.set(i, fb[i]);
  const expect = new Map<number, number>([
    [0, 0xfefefe], [1, 0x363636], [6, 0x363636],
    [7, 0xfefefe], [8, 0x363636], [13, 0x363636],
    [14, 0xfefefe], [15, 0x363636]
  ]);
  assert.deepEqual(lit, expect);

  // shallow positive slope, x-major: from (0,0) to (4,1)
  fb = new Int32Array(w * h);
  aaLine(fb, 0xffffff, w, h, 0, 0, 4, 1, 0);
  // x=0: err 0 -> t=127; err=1 (2 < 4); x=1: t=|trunc(-255/4)+127| = 64; err=2 -> 4>=4 -> y=1, err=-2
  assert.equal(fb[0], blendReplace(0xffffff, 0, 255));
  assert.equal(fb[1], blendReplace(0xffffff, 0, centerAlpha(64)));
  assert.equal(fb[w + 1], blendReplace(0xffffff, 0, forwardAlpha(64)));
  // x=2 (y=1): t=|trunc(510/4)+127| = |127+127| = 254
  assert.equal(fb[w + 2], blendReplace(0xffffff, 0, centerAlpha(254)));
  assert.equal(fb[2], blendReplace(0xffffff, 0, backAlpha(254)));
});

test("volume reads the left waveform as little-endian int16 pairs", () => {
  assert.equal(amoebaVolume(makeCtx(1, 1).visdataUnsigned), 0);
  assert.equal(amoebaVolume(makeCtx(1, 1, () => 1).visdataUnsigned), 514);       // 288*257/144
  assert.equal(amoebaVolume(makeCtx(1, 1, () => 127).visdataUnsigned), 32768);   // capped
  assert.equal(amoebaVolume(makeCtx(1, 1, () => -1).visdataUnsigned), -2);       // no lower cap
  // odd bytes carry the weight: (lo=100, hi=0) -> 100 each; (lo=0, hi=1) -> 256 each
  assert.equal(amoebaVolume(makeCtx(1, 1, (i) => (i & 1 ? 0 : 100)).visdataUnsigned), 200);
  assert.equal(amoebaVolume(makeCtx(1, 1, (i) => (i & 1 ? 1 : 0)).visdataUnsigned), 512);
});

test("smoke render: silence draws the resting star, additive, inside its radius", () => {
  const w = 32, h = 24;
  const effect = ape.create(new Uint8Array(0));
  const fb = new Int32Array(w * h);
  assert.equal(effect.render(makeCtx(w, h), fb, new Int32Array(w * h)), 0);
  // arm 0 at angle 0: points x = trunc(r*5000/8192 + 16), r = 0..11 -> horizontal ray 16..22 on row 12
  assert.equal(fb[12 * w + 16], 0xffffff); // the centre collects every arm
  assert.ok(fb[12 * w + 21] !== 0);
  // R = 12, A = 5000: no point is farther than 11*5000/8192 < 7 pixels from the centre (+1 AA)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.abs(x - 16) > 8 || Math.abs(y - 12) > 8) assert.equal(fb[y * w + x], 0, `${x},${y}`);
  }
  // deterministic
  const fb2 = new Int32Array(w * h);
  ape.create(new Uint8Array(0)).render(makeCtx(w, h), fb2, new Int32Array(w * h));
  assert.deepEqual(fb2, fb);
  // a loud frame turns the star (phase advances) and swells it
  const loud = makeCtx(w, h, (i) => (i & 1 ? 40 : 0));
  const fb3 = new Int32Array(w * h);
  for (let k = 0; k < 3; k++) { fb3.fill(0); effect.render(loud, fb3, new Int32Array(w * h)); }
  assert.notDeepEqual(fb3, fb);
});
