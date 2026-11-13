import assert from "node:assert/strict";
import test from "node:test";

import {
  ape, blendUberCls, parseUberClsConfig, resetUberClsGlobals, uberClsGlobals, updateUberClsColour,
  UBER_CLS_DEFAULTS, type ApeContext
} from "./uber-cls.ts";

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

function makeCtx(w: number, h: number, isBeat: boolean, pump = 0) {
  const visdata = new Int8Array(2304);
  visdata[576] = pump; // visdata[0][1][0]
  const seeds: (number | undefined)[] = [];
  const ctx: ApeContext = {
    w, h, isBeat, visdata, visdataUnsigned: new Uint8Array(visdata.buffer),
    rand: () => { throw new Error("the plug-in has its own CRT rand"); },
    makeRand: (seed?: number) => { seeds.push(seed); return msvcRand(seed ?? 1); },
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null,
    now: () => 0
  };
  return { ctx, seeds };
}

// The 11 configs of the collection (all 40 bytes). Fields: enabled, colour, red, blue, green,
// excludeDark, onBeat, morphing, pump, blend. ASCII garbage in never-initialised fields is "on".
const PRESET_CONFIGS: [string, number[]][] = [
  ["01000000ff484800446f63757320616e6d656e74010000007474696e010000000000000006000000",
    [1, 0x4848ff, 0x75636f44, 0x6e612073, 0x746e656d, 1, 0x6e697474, 1, 0, 6]],
  ["01000000ff0000002e434f4d6469723d0100000000000000494e444f010000000000000003000000",
    [1, 0xff, 0x4d4f432e, 0x3d726964, 1, 0, 0x4f444e49, 1, 0, 3]],
  ["010000000080ff00696e626f723d433a6f74646901000000444f5753010000000000000004000000",
    [1, 0xff8000, 0x6f626e69, 0x3a433d72, 0x6964746f, 1, 0x53574f44, 1, 0, 4]],
  ["01000000006ad500696e626f723d433a6f7464690100000000000000010000000000000006000000",
    [1, 0xd56a00, 0x6f626e69, 0x3a433d72, 0x6964746f, 1, 0, 1, 0, 6]],
  ["010000000000ff00010000000100000001000000000000005c4f776e010000000000000001000000",
    [1, 0xff0000, 1, 1, 1, 0, 0x6e774f5c, 1, 0, 1]],
  ["01000000ffffff005c54656d4552444f700055530100000001000000010000000100000008000000",
    [1, 0xffffff, 0x6d65545c, 0x4f445245, 0x53550070, 1, 1, 1, 1, 8]],
  ["010000000000ff000100000001000000010000000000000001000000010000000000000000000000",
    [1, 0xff0000, 1, 1, 1, 0, 1, 1, 0, 0]],
  ["01000000ff0000000100000001000000010000000000000001000000010000000000000002000000",
    [1, 0xff, 1, 1, 1, 0, 1, 1, 0, 2]],
  ["01000000ff000000696e626f723d433a6f74646900000000444f5753010000000000000008000000",
    [1, 0xff, 0x6f626e69, 0x3a433d72, 0x6964746f, 0, 0x53574f44, 1, 0, 8]],
  ["01000000ffffff00696e626f723d433a6f74646901000000444f5753010000000000000008000000",
    [1, 0xffffff, 0x6f626e69, 0x3a433d72, 0x6964746f, 1, 0x53574f44, 1, 0, 8]],
  ["01000000808080000100000001000000010000000100000001000000010000000000000000000000",
    [1, 0x808080, 1, 1, 1, 1, 1, 1, 0, 0]]
];
const KEYS = ["enabled", "colour", "randomRed", "randomBlue", "randomGreen", "excludeDark", "randomOnBeat",
  "morphing", "brightnessPump", "blendMode"] as const;

test("config parsing: the stored order, defaults, short configs and all preset configs", () => {
  for (const [h, values] of PRESET_CONFIGS) {
    const cfg = parseUberClsConfig(hex(h));
    assert.deepEqual(KEYS.map((k) => cfg[k]), values, h);
  }
  assert.deepEqual(parseUberClsConfig(new Uint8Array(0)), UBER_CLS_DEFAULTS);
  assert.equal(UBER_CLS_DEFAULTS.colour, 0xff);
  assert.equal(UBER_CLS_DEFAULTS.enabled, 1);
  // 10 bytes: enabled and colour only; the trailing 2 bytes are not a field.
  const short = parseUberClsConfig(hex("00000000123456000100"));
  assert.deepEqual(short, { ...UBER_CLS_DEFAULTS, enabled: 0, colour: 0x563412 });
});

test("random colours on beat: draws in blue, red, green order, 1/4 morphing, pump and wrap", () => {
  resetUberClsGlobals();
  const rand = () => msvcRand(1);
  // Preset config 6: all random, exclude dark, on beat, morphing, pump, Invert+Additive.
  const cfg = parseUberClsConfig(hex(PRESET_CONFIGS[5]![0]));
  // First rand() values from seed 1: 41, 18467, 6334 -> %250 + 55 = 96, 272, 139.
  const c1 = updateUberClsColour(cfg, true, -25, rand);
  assert.deepEqual(uberClsGlobals().target, [96, 272, 139]);
  assert.deepEqual(uberClsGlobals().cur, [24, 68, 34]);
  // pump trunc(-25/10) = -2 on the morphing values: blue 22, red 66, green 32.
  assert.equal(c1, 0x00422016);
  // No beat: targets stay, cur keeps moving a quarter (truncated) of the way; pump 0 here.
  const seq = [0x773c2a, 0x9d4f37, 0xb95e41, 0xce6948, 0xde714e];
  for (const want of seq) assert.equal(updateUberClsColour(cfg, false, 5, rand), want);
  // One more step (cur 82, 234, 119) with pump trunc(127/10) = 12: 94, 246, 131.
  assert.equal(updateUberClsColour(cfg, false, 127, rand), (246 << 16) | (131 << 8) | 94);
  // Red keeps going towards its target 272 (> 255): 234 -> 243 -> 250 -> 255 -> 259 -> 262 ...;
  // from 256 on, min(…, 255) holds the byte at 0xff.
  for (let i = 0; i < 4; i += 1) updateUberClsColour(cfg, false, 0, rand);
  assert.equal(uberClsGlobals().cur[1], 259);
  assert.equal(updateUberClsColour(cfg, false, 0, rand) >>> 16, 255);
  // A negative pumped value wraps to its low byte: cur 0 + trunc(-128/10) = -12 -> 0xf4.
  resetUberClsGlobals();
  assert.equal(updateUberClsColour(cfg, false, -128, rand), 0x00f4f4f4);
});

test("without morphing the target is used directly; exclude-dark off draws rand()%255", () => {
  resetUberClsGlobals();
  const cfg = { ...UBER_CLS_DEFAULTS, randomRed: 1, randomGreen: 1, randomBlue: 0, randomOnBeat: 1 };
  // Two draws (red, green): 41 % 255 = 41, 18467 % 255 = 107; blue is set to 0 on beat.
  const c = updateUberClsColour(cfg, true, 0, () => msvcRand(1));
  assert.equal(c, (41 << 16) | (107 << 8) | 0);
  assert.deepEqual(uberClsGlobals().target, [0, 41, 107]);
  // Pump on the targets: 41 + 12, 107 + 12; a target of 255 + 12 clamps to 255.
  const pumped = updateUberClsColour({ ...cfg, brightnessPump: 1 }, false, 120, () => msvcRand(1));
  assert.equal(pumped, (53 << 16) | (119 << 8) | 12);
});

test("random on beat off: the configured colour, no pump, but the shared state still moves", () => {
  resetUberClsGlobals();
  const on = { ...UBER_CLS_DEFAULTS, randomRed: 1, randomBlue: 1, randomGreen: 1, randomOnBeat: 1, morphing: 1 };
  updateUberClsColour(on, true, 0, () => msvcRand(1)); // targets 41, 107 (18467%255), 214 (6334%255)
  const off = parseUberClsConfig(hex(PRESET_CONFIGS[3]![0])); // colour 0xd56a00, on beat off
  assert.equal(updateUberClsColour(off, true, -100, () => msvcRand(1)), 0xd56a00);
  // The beat did not draw (on-beat flag off), but cur moved on: 10->17 ... from [10, 26, 53].
  assert.deepEqual(uberClsGlobals().target, [41, 107, 214]);
  assert.deepEqual(uberClsGlobals().cur, [17, 46, 93]);
});

test("blend modes on chosen pixels (colour 0x00c08040)", () => {
  const col = 0x00c08040;
  const px = [0x00102030, 0x00ffffff, 0x7f80c040, 0x00000000];
  const run = (mode: number) => {
    const fb = Int32Array.from(px);
    blendUberCls(mode, fb, col, 4);
    return Array.from(fb, (x) => x >>> 0);
  };
  assert.deepEqual(run(0), [col, col, col, col]);
  assert.deepEqual(run(1), [0x00d0a070, 0x00ffffff, 0x7fffff80, 0x00c08040]);
  // max on bytes 0..2; top byte: fb 0x7f > 0x00 (signed) -> 0x7f | 0x00.
  assert.deepEqual(run(2), [0x00c08040, 0x00ffffff, 0x7fc0c040, 0x00c08040]);
  assert.deepEqual(run(3), [0x00685038, 0x00dfbf9f, 0x3fa0a040, 0x00604020]);
  assert.deepEqual(run(4), [0x00000000, 0x003f7fbf, 0x7f004000, 0x00000000]);
  assert.deepEqual(run(5), [0x00b06010, 0x00000000, 0x00400000, 0x00c08040]);
  assert.deepEqual(run(6), [
    ((0x10 * 0xc0) >> 8) << 16 | ((0x20 * 0x80) >> 8) << 8 | ((0x30 * 0x40) >> 8),
    0x00bf7f3f, 0x00606010, 0
  ]);
  assert.deepEqual(run(7), px.map((x) => (x ^ col) >>> 0));
  // Invert+Additive: min(255, p + 255 - c) per channel, top byte dropped.
  assert.deepEqual(run(8), [0x004f9fef, 0x00ffffff, 0x00bfffff, 0x003f7fbf]);
  assert.deepEqual(run(9), px.map((x) => x >>> 0));
  assert.deepEqual(run(-1), px.map((x) => x >>> 0));
});

test("max: the top byte follows pcmpgtb's signed compare", () => {
  const fb = Int32Array.from([0x80000000 | 0, 0x01000000, 0x05000000, 0x05000000]);
  blendUberCls(2, fb, 0x03000000, 4);
  // 0x80 (-128) > 3? no -> 0;  1 > 3 no -> 0;  5 > 3 yes -> 5|3 = 7.
  assert.deepEqual(Array.from(fb, (x) => x >>> 0), [0, 0, 0x07000000, 0x07000000]);
});

test("odd pixel counts: the 8-byte modes leave the last pixel", () => {
  for (let mode = 0; mode <= 8; mode += 1) {
    const fb = Int32Array.from([0x00123456, 0x00123456, 0x00123456]);
    blendUberCls(mode, fb, 0x00808080, 3);
    const touchedLast = fb[2] !== 0x00123456;
    assert.equal(touchedLast, [0, 3, 6, 8].includes(mode), `mode ${mode}`);
  }
});

test("render: disabled does nothing, the generator is private (seed 1) and shared by instances", () => {
  resetUberClsGlobals();
  const { ctx, seeds } = makeCtx(2, 2, true);
  const fb = Int32Array.from([1, 2, 3, 4]);
  assert.equal(ape.create(hex("00000000" + PRESET_CONFIGS[6]![0].slice(8))).render(ctx, fb, new Int32Array(4)), 0);
  assert.deepEqual(Array.from(fb), [1, 2, 3, 4]);
  assert.deepEqual(uberClsGlobals().cur, [0, 0, 0]);

  // Preset config 7: random R G B on beat, morphing, Replace.
  const a = ape.create(hex(PRESET_CONFIGS[6]![0]));
  const b = ape.create(hex(PRESET_CONFIGS[6]![0]));
  assert.equal(a.render(ctx, fb, new Int32Array(4)), 0);
  // targets 41%255, 18467%255, 6334%255 = 41, 107, 214 (blue, red, green); cur = 10, 26, 53.
  assert.deepEqual(Array.from(fb), new Array(4).fill((26 << 16) | (53 << 8) | 10));
  assert.deepEqual(seeds, [1]);
  // The second instance continues the same generator: 26500 % 255 = 235 for blue, etc.
  b.render(ctx, fb, new Int32Array(4));
  assert.deepEqual(uberClsGlobals().target, [26500 % 255, 19169 % 255, 15724 % 255]);
  assert.deepEqual(seeds, [1], "only one generator for the DLL");
  resetUberClsGlobals();
});
