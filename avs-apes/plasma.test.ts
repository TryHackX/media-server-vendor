import assert from "node:assert/strict";
import test from "node:test";

import {
  ape, buildAxisTable, buildCosTable, buildPalette, COS_STEP, ftol, gradient, parsePlasmaConfig,
  parsePlasmaSpec, PLASMA_DEFAULTS, serializePlasmaConfig, vcAtof, vcAtoi, type ApeContext
} from "./plasma.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** Config bytes of the three presets in the collection that use this APE. */
const PRESETS = {
  "vflorelo/50_percent_off/Plasma fluid.avs": hex("ffffff0000000000312c3100312c3100"),
  "vflorelo/Golden/Plasma tunnel.avs": hex("00000000ffffff00322c3200322c3200"),
  "vflorelo/Golden/Plasma.avs": hex("00000000ffffff00332c3200332c3200")
};

function makeCtx(w: number, h: number): ApeContext {
  return {
    w, h, isBeat: false,
    visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: () => 0, makeRand: () => () => 0,
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null,
    now: () => 0
  };
}

/** floor(64·cos(2i·C)) computed with 60-digit decimals from the double arguments (Python). */
const EXACT_COS = [
  64, 63, 63, 63, 63, 63, 63, 63, 62, 62, 62, 61, 61, 60, 60, 59, 59, 58, 57, 57, 56, 55, 54, 54, 53,
  52, 51, 50, 49, 48, 47, 46, 45, 44, 42, 41, 40, 39, 38, 36, 35, 34, 32, 31, 30, 28, 27, 25, 24, 23,
  21, 20, 18, 17, 15, 14, 12, 10, 9, 7, 6, 4, 3, 1, 0, -2, -4, -5, -7, -8, -10, -11, -13, -15, -16,
  -18, -19, -21, -22, -24, -25, -26, -28, -29, -31, -32, -33, -35, -36, -37, -39, -40, -41, -42,
  -43, -45, -46, -47, -48, -49, -50, -51, -52, -53, -54, -55, -55, -56, -57, -58, -58, -59, -60,
  -60, -61, -61, -62, -62, -63, -63, -63, -64, -64, -64, -64, -64, -64, -64, -64, -64, -64, -64,
  -64, -64, -64, -64, -63, -63, -63, -62, -62, -61, -61, -60, -60, -59, -58, -58, -57, -56, -55,
  -55, -54, -53, -52, -51, -50, -49, -48, -47, -46, -45, -43, -42, -41, -40, -39, -37, -36, -35,
  -33, -32, -31, -29, -28, -26, -25, -24, -22, -21, -19, -18, -16, -15, -13, -11, -10, -8, -7, -5,
  -4, -2, -1, 1, 3, 4, 6, 7, 9, 10, 12, 14, 15, 17, 18, 20, 21, 23, 24, 25, 27, 28, 30, 31, 32, 34,
  35, 36, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 54, 55, 56, 57, 57, 58,
  59, 59, 60, 60, 61, 61, 62, 62, 62, 63, 63, 63, 63, 63, 63, 63
];

/** Straight per-pixel transcription of render (0x10001D70) for frame phase t. */
function referenceFrame(cfgBytes: Uint8Array, w: number, h: number, t: number): Int32Array {
  const cfg = parsePlasmaConfig(cfgBytes);
  const pal = buildPalette(cfg.colour1, cfg.colour2);
  const cos = buildCosTable();
  const xs = parsePlasmaSpec(cfg.xSpec), ys = parsePlasmaSpec(cfg.ySpec);
  const xt = xs.freqs.map((f) => buildAxisTable(w, f));
  const yt = ys.freqs.map((f) => buildAxisTable(h, f));
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = 0; i < xt.length; i++) {
        let v = (xt[i]![x % w]! + t) | 0;
        v = Math.abs(v) % 256;
        sum = (sum + Math.imul(cos[v]!, xs.amps[i]!)) | 0;
      }
      for (let i = 0; i < yt.length; i++) {
        let v = (yt[i]![y % h]! + t) | 0;
        v = Math.abs(v) % 256;
        sum = (sum + Math.imul(cos[v]!, ys.amps[i]!)) | 0;
      }
      out[y * w + x] = pal[Math.abs(sum % 256)]!;
    }
  }
  return out;
}

test("config of the three real presets", () => {
  assert.deepEqual(parsePlasmaConfig(PRESETS["vflorelo/50_percent_off/Plasma fluid.avs"]),
    { colour1: 0xffffff, colour2: 0, xSpec: "1,1", ySpec: "1,1" });
  assert.deepEqual(parsePlasmaConfig(PRESETS["vflorelo/Golden/Plasma tunnel.avs"]),
    { colour1: 0, colour2: 0xffffff, xSpec: "2,2", ySpec: "2,2" });
  assert.deepEqual(parsePlasmaConfig(PRESETS["vflorelo/Golden/Plasma.avs"]),
    { colour1: 0, colour2: 0xffffff, xSpec: "3,2", ySpec: "3,2" });
  for (const bytes of Object.values(PRESETS)) {
    assert.deepEqual(serializePlasmaConfig(parsePlasmaConfig(bytes)), bytes);
  }
});

test("short configs keep the constructor defaults like load_config", () => {
  assert.deepEqual(parsePlasmaConfig(new Uint8Array(0)), PLASMA_DEFAULTS);
  // 4 bytes: colour1 only; colour2 and both strings stay default.
  assert.deepEqual(parsePlasmaConfig(hex("11223344")),
    { colour1: 0x44332211, colour2: 0x00ff00, xSpec: "1,1", ySpec: "1,1" });
  // 8 bytes: both colours, strings default.
  assert.deepEqual(parsePlasmaConfig(hex("0102030405060708")),
    { colour1: 0x04030201, colour2: 0x08070605, xSpec: "1,1", ySpec: "1,1" });
  // First string present, second missing.
  assert.deepEqual(parsePlasmaConfig(hex("0000000000000000352c3700")),
    { colour1: 0, colour2: 0, xSpec: "5,7", ySpec: "1,1" });
  // Fewer than 4 bytes: the string is read from offset 0.
  assert.equal(parsePlasmaConfig(hex("3900")).xSpec, "9");
  // An empty first string is kept empty (no components on that axis).
  assert.deepEqual(parsePlasmaConfig(hex("0000000000000000" + "00" + "322c3100")),
    { colour1: 0, colour2: 0, xSpec: "", ySpec: "2,1" });
});

test("spec parsing: strtok on ',;', amplitude (atoi) then frequency ((float)atof)", () => {
  assert.deepEqual(parsePlasmaSpec("1,1"), { amps: [1], freqs: [1] });
  assert.deepEqual(parsePlasmaSpec("3,2"), { amps: [3], freqs: [2] });
  assert.deepEqual(parsePlasmaSpec(",,2;0.5,,-1, 3.5;"), { amps: [2, -1], freqs: [0.5, 3.5] });
  assert.deepEqual(parsePlasmaSpec("5"), { amps: [5], freqs: [] });
  assert.deepEqual(parsePlasmaSpec(""), { amps: [], freqs: [] });
  assert.equal(parsePlasmaSpec("1,0.7").freqs[0], Math.fround(0.7));
  assert.equal(vcAtoi(" 12"), 12);
  assert.equal(vcAtoi("-7x"), -7);
  assert.equal(vcAtoi("+3"), 3);
  assert.equal(vcAtoi("abc"), 0);
  assert.equal(vcAtoi("4294967297"), 1); // wraps like the VC6 accumulation
  assert.equal(vcAtof(" 1.5e1z"), 15);
  assert.equal(vcAtof("-.25"), -0.25);
  assert.equal(vcAtof("1e"), 1);
  assert.equal(vcAtof("."), 0);
  assert.equal(vcAtof("x1"), 0);
});

test("_ftol truncates and keeps the low 32 bits", () => {
  assert.equal(ftol(2.9), 2);
  assert.equal(ftol(-2.9), -2);
  assert.equal(ftol(-2147483648), -2147483648);
  assert.equal(ftol(2147483648), -2147483648);
  assert.equal(ftol(2 ** 32 + 5), 5);
  assert.equal(ftol(NaN), 0);
  assert.equal(ftol(1e300), 0);
});

test("gradient (0x10001000) steps and clamps like the plug-in", () => {
  const p1 = buildPalette(0xffffff, 0);
  assert.equal(p1[0], 0xffffff);
  assert.equal(p1[1], 0xfdfdfd);
  assert.equal(p1[127], 0x010101);
  assert.equal(p1[128], 0);
  assert.equal(p1[129], 0x020202);
  assert.equal(p1[255], 0xfefefe);
  // Constructor defaults red → green.
  const p2 = buildPalette(0xff0000, 0x00ff00);
  assert.deepEqual([p2[0], p2[1], p2[127], p2[128], p2[129], p2[255]],
    [0xff0000, 0xfd0200, 0x01fe00, 0x00ff00, 0x02fd00, 0xfe0100]);
  // |a-b| = 50: step floor(51/128 + 0.5) = 0, the channel never moves.
  const p3 = buildPalette(0x000000, 0x000032);
  assert.ok(p3.subarray(0, 128).every((c) => c === 0));
  assert.ok(p3.subarray(128).every((c) => c === 0x32));
  // |a-b| = 100: step 1, clamped at the target.
  const p4 = new Int32Array(128);
  gradient(0, 100, 128, p4, 0);
  assert.equal(p4[99], 99);
  assert.equal(p4[100], 100);
  assert.equal(p4[127], 100);
  gradient(100, 0, 128, p4, 0);
  assert.equal(p4[99], 1);
  assert.equal(p4[100], 0);
  assert.equal(p4[127], 0);
  // The top byte of a colour is ignored.
  assert.equal(buildPalette(0xff123456 | 0, 0)[0], 0x123456);
});

test("cosine table is floor(64·cos(2i·3.14159265/256)) for all 256 entries", () => {
  assert.equal(COS_STEP, 3.14159265 / 256);
  assert.deepEqual(Array.from(buildCosTable()), EXACT_COS);
});

test("axis tables use the float frequency: floor(i·f + 0.5)", () => {
  assert.deepEqual(Array.from(buildAxisTable(6, 1)), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(buildAxisTable(6, 0.5)), [0, 1, 1, 2, 2, 3]);
  assert.deepEqual(Array.from(buildAxisTable(4, 2)), [0, 2, 4, 6]);
  // 5 · (float)0.7 = 3.49999994 → 3, whereas the double 0.7 would give 5·0.7 = 3.5 → 4.
  assert.equal(buildAxisTable(6, Math.fround(0.7))[5], 3);
  assert.equal(buildAxisTable(6, 0.7)[5], 4);
  assert.deepEqual(Array.from(buildAxisTable(3, -1.5)), [0, -1, -3]); // floor(-2.5) = -3
});

test("hand-checked pixels of the real presets", () => {
  // Plasma fluid (white → black, "1,1"): s(0,0,t=0) = 64 + 64 = 128 → palette[128] = colour2 = 0.
  const fluid = ape.create(PRESETS["vflorelo/50_percent_off/Plasma fluid.avs"]);
  const fb = new Int32Array(4 * 2);
  assert.equal(fluid.render(makeCtx(4, 2), fb, new Int32Array(8)), 0);
  assert.equal(fb[0], 0);
  assert.equal(fb[1], 0x010101); // 63 + 64 = 127 → palette[127] = 255 − 2·127
  // Plasma ("3,2", black → white): (0,0): 3·64 + 3·64 = 384 → 128 → colour2 = white.
  const plasma = ape.create(PRESETS["vflorelo/Golden/Plasma.avs"]);
  plasma.render(makeCtx(4, 2), fb, new Int32Array(8));
  assert.equal(fb[0], 0xffffff);
  assert.equal(fb[1], 0xfafafa); // X(1) = 2: 3·63 + 192 = 381 → 125 → 2·125 = 250
  plasma.render(makeCtx(4, 2), fb, new Int32Array(8)); // t = 1
  assert.equal(fb[0], 0xf4f4f4); // 189 + 189 = 378 → 122 → 244
});

test("render matches a per-pixel transcription, frames advance and the phase wraps", () => {
  for (const bytes of [...Object.values(PRESETS),
    serializePlasmaConfig({ colour1: 0x123456, colour2: 0xfedcba, xSpec: "100000000,1.5;-7,0.25", ySpec: "3,0.7,2" })]) {
    const fx = ape.create(bytes);
    const w = 37, h = 11;
    const fb = new Int32Array(w * h);
    for (let t = 0; t < 3; t++) {
      assert.equal(fx.render(makeCtx(w, h), fb, new Int32Array(w * h)), 0);
      assert.deepEqual(fb, referenceFrame(bytes, w, h, t), `frame ${t}`);
    }
    // Resize: tables are rebuilt, the phase keeps counting (t = 3).
    const fb2 = new Int32Array(9 * 5);
    fx.render(makeCtx(9, 5), fb2, new Int32Array(45));
    assert.deepEqual(fb2, referenceFrame(bytes, 9, 5, 3));
    // 3 + 1 + 252 frames bring t back to 0: the 257th frame equals frame 0 at that size.
    for (let i = 0; i < 252; i++) fx.render(makeCtx(9, 5), fb2, new Int32Array(45));
    fx.render(makeCtx(9, 5), fb2, new Int32Array(45));
    assert.deepEqual(fb2, referenceFrame(bytes, 9, 5, 0));
  }
});

test("empty config renders the red/green default plasma; zero-sized frames are harmless", () => {
  const fx = ape.create(new Uint8Array(0));
  const fb = new Int32Array(16 * 16);
  fx.render(makeCtx(16, 16), fb, new Int32Array(256));
  const pal = buildPalette(0xff0000, 0x00ff00);
  assert.ok(Array.from(fb).every((c) => pal.includes(c)));
  assert.equal(fb[0], 0x00ff00); // 64 + 64 = 128
  assert.equal(fx.render(makeCtx(0, 0), new Int32Array(0), new Int32Array(0)), 0);
});
