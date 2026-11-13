import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ape, parseFlockConfig, initBirds, stepBirds, drawBird, limitSpeed, isNeighbour, ROW_HALF_WIDTH,
  FLOCK_DEFAULTS, FlockOff,
} from "./flock.ts";
import type { ApeContext } from "./flock.ts";

const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

/** MSVC rand() seeded as srand(seed). */
function msvcRand(seed = 1): () => number {
  let h = seed | 0;
  return () => {
    h = (Math.imul(h, 214013) + 2531011) | 0;
    return (h >>> 16) & 0x7fff;
  };
}

function ctx(w: number, h: number, nowMs: number, isBeat = false): ApeContext {
  return {
    w, h, isBeat,
    visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: msvcRand(1), makeRand: (seed?: number) => msvcRand(seed ?? 1), registers: new Float64Array(100),
    lineBlendMode: 0, globalBuffer: () => null, now: () => nowMs,
  };
}

// All 13 instances in the 10 presets that use the plug-in.
const PRESETS: [string, string, number[]][] = [
  ["Arcanoidon #1", "01000000ffffff0008000000040000001e0000000500000001000000", [1, 0xffffff, 8, 4, 30, 5, 1]],
  ["Arcanoidon #2", "01000000ff80800008000000040000001e0000000500000001000000", [1, 0x8080ff, 8, 4, 30, 5, 1]],
  ["Ancient", "01000000ffffff000800000004000000000000000000000010000000", [1, 0xffffff, 8, 4, 0, 0, 16]],
  ["Lightmap", "01000000ffffff000f00000014000000000000000000000002000000", [1, 0xffffff, 15, 20, 0, 0, 2]],
  ["Aurum", "01000000ffffff000f0000000a000000000000000000000002000000", [1, 0xffffff, 15, 10, 0, 0, 2]],
  ["Ancient 2", "01000000ffffff000800000004000000000000000000000010000000", [1, 0xffffff, 8, 4, 0, 0, 16]],
  ["HerE ComE da WormS", "01000000ffffff000a0000000a0000001e0000001e00000001000000", [1, 0xffffff, 10, 10, 30, 30, 1]],
  ["AncienT 3", "01000000ffffff0008000000030000001e0000001e00000002000000", [1, 0xffffff, 8, 3, 30, 30, 2]],
  ["ProtooberantsI", "01000000ffffff0014000000050000001e0000001e00000001000000", [1, 0xffffff, 20, 5, 30, 30, 1]],
  ["waterdrops #1", "0100000058b00000050000000a0000001e0000000a00000002000000", [1, 0x00b058, 5, 10, 30, 10, 2]],
  ["waterdrops #2", "01000000ff000000050000000a0000001e0000000a00000002000000", [1, 0x0000ff, 5, 10, 30, 10, 2]],
  ["waterdrops #3", "01000000ff800000140000000a0000001e0000000a00000002000000", [1, 0x0080ff, 20, 10, 30, 10, 2]],
  ["Ambient Vortex", "010000000080ff0008000000040000001e0000000500000001000000", [1, 0xff8000, 8, 4, 30, 5, 1]],
];

test("config: the real preset bytes and defaults", () => {
  for (const [name, bytes, v] of PRESETS) {
    const c = parseFlockConfig(hex(bytes));
    assert.deepEqual([c.enabled, c.color, c.birds, c.maxSpeed, c.vision, c.space, c.onBeat], v, name);
  }
  assert.deepEqual(parseFlockConfig(new Uint8Array(0)), FLOCK_DEFAULTS);
  assert.deepEqual(parseFlockConfig(hex("0000000011223300030000")),
    { ...FLOCK_DEFAULTS, enabled: 0, color: 0x332211 });
});

test("bird shape: 7 rows, half widths 1,3,4,4,4,4,3", () => {
  assert.deepEqual(ROW_HALF_WIDTH, [1, 3, 4, 4, 4, 4, 3]);
  const w = 400, h = 400;
  const fb = new Int32Array(w * h);
  drawBird(fb, w, h, 100.5, 200.25, 7); // px = 100, centre row 200
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    const xs: number[] = [];
    for (let x = 0; x < w; x++) if (fb[y * w + x]) xs.push(x);
    if (xs.length) rows.push(`${y}:${xs[0]}-${xs[xs.length - 1]}`);
  }
  assert.deepEqual(rows, ["197:99-100", "198:97-102", "199:96-103", "200:96-103", "201:96-103", "202:96-103", "203:97-102"]);
  // scaled to the frame (world 400 -> w, h) and clipped at the edges
  const f2 = new Int32Array(64 * 48);
  drawBird(f2, 64, 48, 400, 400, 1); // the corner where unused birds sit: px = 64, rows 45..51
  const lit: string[] = [];
  f2.forEach((v, i) => { if (v) lit.push(`${i % 64},${(i / 64) | 0}`); });
  assert.deepEqual(lit, ["63,45", "61,46", "62,46", "63,46", "60,47", "61,47", "62,47", "63,47"]);
});

test("constructor set-up: 8 birds from srand(seed), 4 rand() each (values from a Python model)", () => {
  const b = initBirds(msvcRand(12345));
  const expect = [
    [364, 384, 2.297799615466781, 1.4017761772515032], [205, 228, 2.708456678975799, -2.678426465651418],
    [204, 272, -0.3477889339884639, -0.38660847804193255], [132, 43, -1.6722922452467421, -0.5633716849269081],
    [216, 366, 2.3661610766930146, -3.0358592486342966], [325, 218, -1.2855616931669056, -0.2684408093508712],
    [85, 236, 1.2250129703665271, -3.1239967040009766], [69, 128, 1.1925412762840661, -3.4843592638935514],
  ];
  for (let i = 0; i < 8; i++) assert.deepEqual([b[i * 6 + 3], b[i * 6 + 4], b[i * 6], b[i * 6 + 1]], expect[i]);
  for (let i = 8 * 6; i < b.length; i++) assert.equal(b[i], 0);
});

test("speed limit: v * (1/|v|) * max, only when |v| > max", () => {
  const b = Float64Array.of(3, 4, 0, 0, 0, 0);
  limitSpeed(b, 0, 5);
  assert.deepEqual(Array.from(b.subarray(0, 3)), [3, 4, 0]);
  limitSpeed(b, 0, 2);
  assert.deepEqual(Array.from(b.subarray(0, 3)), [3 * (1 / 5) * 2, 4 * (1 / 5) * 2, 0]);
});

test("neighbours: bit-identical birds never see each other; 2-D distance <= vision", () => {
  const b = new Float64Array(3 * 6);
  b.set([1, 0, 0, 10, 10, 0], 0);
  b.set([1, 0, 0, 10, 10, 0], 6);
  b.set([0, 0, 0, 40, 10, 99], 12);
  assert.equal(isNeighbour(b, 0, 6, 30), false);
  assert.equal(isNeighbour(b, 0, 12, 30), true); // distance exactly 30, z ignored
  assert.equal(isNeighbour(b, 0, 12, 29.999), false);
});

test("separation only within personal space (the scatter beat adds 6)", () => {
  const two = (): Float64Array => {
    const b = new Float64Array(400 * 6);
    b.set([1, 0, 0, 100, 100, 0], 0);
    b.set([0, 1, 0, 108, 100, 0], 6);
    return b;
  };
  let b = two();
  stepBirds(b, 2, 4, 30, 5);
  assert.deepEqual(Array.from(b.subarray(0, 5)), [0.955, 0.125, 0, 100.955, 100.125]);
  assert.deepEqual(Array.from(b.subarray(6, 11)), [0.04892499999999998, 0.891875, 0, 108.048925, 100.891875]);
  b = two();
  stepBirds(b, 2, 4, 30, 11);
  assert.deepEqual(Array.from(b.subarray(0, 5)),
    [-3.999370514835648, 0.070961151789135, 0, 96.00062948516435, 100.07096115178913]);
  assert.deepEqual(Array.from(b.subarray(6, 11)),
    [-0.6199150195028125, 0.8845797554915332, 0, 107.38008498049719, 100.88457975549153]);
});

test("200 frames of 'Arcanoidon' (seed 12345) match the Python model bit for bit", () => {
  const fx = ape.create(hex(PRESETS[0][1])) as FlockOff;
  const c = ctx(64, 48, 12345678);
  for (let f = 0; f < 200; f++) fx.render(c, new Int32Array(64 * 48), new Int32Array(64 * 48));
  const b = fx.birds!;
  const expect = [
    [23.55992309335514, 264.35523545030003], [346.6913357951584, 92.31470686971684],
    [134.44221320230918, 194.6783043916157], [196.45759928091258, 79.717297542872],
    [167.6081984006415, 81.74258707959383], [67.8876613666183, 164.31183812982727],
    [175.29109538862141, 84.3346934161965], [188.91811550812585, 80.23011526554787],
  ];
  for (let i = 0; i < 8; i++) assert.deepEqual([b[i * 6 + 3], b[i * 6 + 4]], expect[i]);
});

test("20 birds: the 12 extra ones start at the corner and stay there (seed 777)", () => {
  const b = initBirds(msvcRand(777));
  for (let f = 0; f < 100; f++) stepBirds(b, 20, 5, 30, 30);
  assert.deepEqual([b[0 * 6 + 3], b[0 * 6 + 4]], [22.104097153605835, 309.28581421181974]);
  assert.deepEqual([b[7 * 6 + 3], b[7 * 6 + 4]], [186.68759044659424, 56.424102781927694]);
  assert.deepEqual([b[8 * 6 + 3], b[8 * 6 + 4], b[19 * 6 + 3], b[19 * 6 + 4]], [0, 0, 0, 0]);
});

test("render: draws before moving, replace in the preset colour, nothing when disabled", () => {
  const w = 64, h = 48;
  const fx = ape.create(hex(PRESETS[12][1])) as FlockOff; // Ambient Vortex, #ff8000
  const fb = new Int32Array(w * h);
  assert.equal(fx.render(ctx(w, h, 12345000), fb, new Int32Array(w * h)), 0);
  const ref = new Int32Array(w * h);
  const start = initBirds(msvcRand(12345));
  for (let i = 0; i < 8; i++) drawBird(ref, w, h, start[i * 6 + 3], start[i * 6 + 4], 0xff8000);
  assert.deepEqual(fb, ref);
  assert.ok(fb.some((v) => v === 0xff8000));

  const off = ape.create(hex("00000000ffffff00")) as FlockOff;
  const fb2 = new Int32Array(w * h);
  off.render(ctx(w, h, 0), fb2, new Int32Array(w * h));
  assert.ok(fb2.every((v) => v === 0));
});
