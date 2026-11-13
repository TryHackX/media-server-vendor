import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ape, blendModes, buildPalette, interpolateColor, iterate, parseConfig, viewRect, VisFrac, vuLevel,
  type ApeContext,
} from "./visfrac.ts";

const f32 = Math.fround;
const hexF = (h: string): number => new DataView(Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16))).buffer).getFloat32(0, true);

/** Rebuild a 2100-byte preset config from its non-zero runs [offset, hex]. */
function fromRuns(runs: Array<[number, string]>): Uint8Array {
  const out = new Uint8Array(2100);
  for (const [off, hex] of runs) out.set(hex.match(/../g)!.map((b) => parseInt(b, 16)), off);
  return out;
}

// Config bytes of real presets (all non-zero bytes of the 2100-byte APE config).
const MUSHTHROMLAND = fromRuns([[0, "040001"], [8, "ffffff"], [16, "abf1523e0000ff005fba493fff0000002eb25d3f40ff0000b39d6f3f"], [2060, "08000000320000006f12833a00000040cdcc4c3e9a99193e000001"], [2092, "9a99193e64"]]);
const ANNOY_YOU = fromRuns([[0, "01000000ff0000004080ff0093ffff00ea26b13e"], [76, "75b90fa00c007300d40d83"], [100, "0c"], [136, "d046730030000000d8467300200000001800000002000400100000001c"], [176, "c318360270726f78792e62676e65742e62670000700072006f00780079002e00620067006e00650074002e00620067"], [2060, "02000000190000006f12833a00000040cdcc4c3eec51383e00000100010000009a99193e02000080"]]);
const BEYOND = fromRuns([[0, "01000100020202002100a6"], [16, "0bd7233d"], [2060, "02000000320000006f12833a00000040cdcc4c3e9a99193e"], [2088, "010000009a99193e0a000080"]]);
const FETT_FRACTAL = fromRuns([[0, "01"], [5, "80ff004080ff00804000004260653d"], [2060, "0600000032000000faed6b3a"], [2076, "f628dc3e5c8fc23e0001010001"], [2096, "64"]]);
const DANCE_OR_DIE = fromRuns([[8, "80ffff"], [2060, "01000000320000006f12833a00000040cdcc4c3e9a99193e01010101"], [2092, "5c8fc23e20"]]);
// nova.avs and Push Away carry uninitialised memory after their stops; the head and tail are enough here.
const NOVA = fromRuns([[0, "060001"], [16, "dace773e"], [24, "2731883e0000ae002b87963e"], [40, "e6d0a23e0067ce000f2db23effffff00b7f3fd3e"], [104, "689d7300c49e73"], [2060, "090000006400000017b7d139"], [2076, "cdcc4c3fa4707d3f00000100020000009a99193e64"]]);
const PUSH_AWAY = fromRuns([[0, "02"], [8, "ffffff00ff000000653b5f3e400000005d8f023f08000000660075006e006300740069006f006e000000a00a"], [2060, "02000000320000006f12833a9a99d93fcdcc4c3e9a99193e00000100040000009a99193e64"]]);

function fakeCtx(w: number, h: number, opts: { now?: () => number; rand?: () => number; isBeat?: boolean; vis?: Int8Array } = {}): ApeContext {
  const vis = opts.vis ?? new Int8Array(2304);
  return {
    w, h, isBeat: opts.isBeat ?? false, visdata: vis, visdataUnsigned: new Uint8Array(vis.buffer),
    rand: opts.rand ?? (() => 0), makeRand: () => () => 0, registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null, now: opts.now ?? (() => 1000),
  };
}

test("ape export", () => {
  assert.equal(ape.id, "VisFrac v1.0 by PP");
  assert.equal(ape.sha256.length, 2);
  assert.ok(ape.create(new Uint8Array(0)) instanceof VisFrac);
});

test("defaults of the constructor when the config is empty", () => {
  const c = parseConfig(new Uint8Array(0));
  assert.equal(c.stopCount, 0);
  assert.equal(c.sinusoidal, false);
  assert.equal(c.color0, 0x000000);
  assert.equal(c.color1, 0xffffff);
  assert.equal(c.model, 2);
  assert.equal(c.iterations, 50);
  assert.equal(c.speed, f32(0.001));
  assert.equal(c.dvu, 2);
  assert.equal(c.radius, f32(0.2));
  assert.equal(c.zoom, f32(0.15));
  assert.equal(c.pixelDoubling, true);
  assert.equal(c.zoomOnBeat, false);
  assert.equal(c.blend, 0);
  assert.equal(c.beatZoom, f32(0.15));
  assert.equal(c.beatChange, 100);
});

test("range checks of the newer build", () => {
  const raw = new Uint8Array(2100);
  const dv = new DataView(raw.buffer);
  dv.setUint32(0x80c, 12, true);
  dv.setUint32(0x810, 300, true);
  dv.setUint32(0x828, 7, true);
  const c = parseConfig(raw);
  assert.equal(c.model, 2);
  assert.equal(c.iterations, 50);
  assert.equal(c.blend, 0);
});

test("Mushthromland Warp Gate (horse-fly): 4 sinusoidal stops, model 8", () => {
  const c = parseConfig(MUSHTHROMLAND);
  assert.equal(c.stopCount, 4);
  assert.equal(c.sinusoidal, true);
  assert.equal(c.color0, 0);
  assert.equal(c.color1, 0xffffff);
  assert.deepEqual([...c.stopColors.subarray(0, 4)], [0x000000, 0xff0000, 0x0000ff, 0x00ff40]);
  assert.deepEqual([...c.stopPositions.subarray(0, 4)], ["abf1523e", "5fba493f", "2eb25d3f", "b39d6f3f"].map(hexF));
  assert.equal(c.model, 8);
  assert.equal(c.iterations, 50);
  assert.equal(c.blend, 0);
  assert.equal(c.pixelDoubling, true);
  assert.equal(c.beatChange, 0x64);
});

test("Annoy You (tonic): linear, model change every 2 beats, 50/50", () => {
  const c = parseConfig(ANNOY_YOU);
  assert.equal(c.stopCount, 1);
  assert.equal(c.sinusoidal, false);
  assert.equal(c.color0, 0x0000ff);
  assert.equal(c.color1, 0xff8040);
  assert.equal(c.stopColors[0], 0xffff93);
  assert.equal(c.stopPositions[0], hexF("ea26b13e"));
  assert.equal(c.model, 2);
  assert.equal(c.iterations, 25);
  assert.equal(c.zoom, f32(0.18));
  assert.equal(c.blend, 1);
  assert.equal(c.beatChange >>> 0, 0x80000002);
});

test("nova (el-vis), beyond (yathosho), Fett Fractal (zen-x), Dance or Die, Push Away", () => {
  const n = parseConfig(NOVA);
  assert.equal(n.stopCount, 6);
  assert.equal(n.sinusoidal, true);
  assert.deepEqual([...n.stopColors.subarray(0, 6)], [0, 0, 0xae0000, 0, 0xce6700, 0xffffff]);
  assert.equal(n.model, 9);
  assert.equal(n.iterations, 100);
  assert.equal(n.speed, hexF("17b7d139"));
  assert.equal(n.dvu, 0);
  assert.equal(n.radius, f32(0.8));
  assert.equal(n.zoom, f32(0.99));
  assert.equal(n.blend, 2);

  const b = parseConfig(BEYOND);
  assert.equal(b.color0, 0x020202);
  assert.equal(b.color1, 0xa60021);
  assert.equal(b.pixelDoubling, false);
  assert.equal(b.blend, 1);
  assert.equal(b.beatChange >>> 0, 0x8000000a);

  const f = parseConfig(FETT_FRACTAL);
  assert.equal(f.color0, 0xff8000);
  assert.equal(f.color1, 0xff8040);
  assert.equal(f.stopColors[0], 0x004080);
  assert.equal(f.model, 6);
  assert.equal(f.speed, hexF("faed6b3a"));
  assert.equal(f.reverseRotation, false);
  assert.equal(f.reverseDvu, true);
  assert.equal(f.pixelDoubling, true);
  assert.equal(f.radius, f32(0.43));
  assert.equal(f.zoom, f32(0.38));
  assert.equal(f.beatZoom, 0);

  const d = parseConfig(DANCE_OR_DIE);
  assert.equal(d.color0, 0);
  assert.equal(d.color1, 0xffff80);
  assert.equal(d.model, 1);
  assert.equal(d.reverseRotation && d.reverseDvu && d.pixelDoubling && d.zoomOnBeat, true);
  assert.equal(d.beatZoom, f32(0.38));
  assert.equal(d.beatChange, 0x20);

  const p = parseConfig(PUSH_AWAY);
  assert.equal(p.stopCount, 2);
  assert.equal(p.blend, 4); // "max": only the 12.09.2000 build offers it
  assert.equal(p.dvu, f32(1.7));
  assert.deepEqual([p.stopColors[0], p.stopColors[1]], [0x0000ff, 0x000040]);
});

test("colour interpolation rounds with fistp (to nearest even)", () => {
  assert.equal(interpolateColor(0x000000, 0x000005, 0.5, false), 0x000002); // 2.5 -> 2
  assert.equal(interpolateColor(0x000000, 0x000003, 0.5, false), 0x000002); // 1.5 -> 2
  assert.equal(interpolateColor(0x0a0b0c, 0x0a0b0c, 0.3, false), 0x0a0b0c);
  // sinusoidal: t' = (1 - cos(pi t)) / 2, so t = 0.5 stays 0.5
  assert.equal(interpolateColor(0, 0xffffff, 0.5, true), 0x808080);
  assert.equal(interpolateColor(0, 0x0000ff, f32(0.25), true), 0x000025); // 255 * 0.1464... = 37.33
  // out-of-range t wraps through the 16-bit store into the low byte
  assert.equal(interpolateColor(0, 0x0000ff, 2, false), 0x0000fe); // 510 & 255
});

test("palettes agree with the reference reading", () => {
  const def = buildPalette(parseConfig(new Uint8Array(0)));
  const expDef = [0x0, 0x50505, 0xa0a0a, 0xf0f0f, 0x141414, 0x191919, 0x1f1f1f, 0x242424, 0x292929, 0x2e2e2e, 0x333333, 0x383838, 0x3d3d3d, 0x424242, 0x474747, 0x4c4c4c, 0x525252, 0x575757, 0x5c5c5c, 0x616161, 0x666666, 0x6b6b6b, 0x707070, 0x757575, 0x7a7a7a, 0x808080, 0x858585, 0x8a8a8a, 0x8f8f8f, 0x949494, 0x999999, 0x9e9e9e, 0xa3a3a3, 0xa8a8a8, 0xadadad, 0xb2b2b2, 0xb8b8b8, 0xbdbdbd, 0xc2c2c2, 0xc7c7c7, 0xcccccc, 0xd1d1d1, 0xd6d6d6, 0xdbdbdb, 0xe0e0e0, 0xe5e5e5, 0xebebeb, 0xf0f0f0, 0xf5f5f5, 0xfafafa, 0xffffff];
  assert.deepEqual([...def.subarray(0, 51)], expDef);
  const mush = buildPalette(parseConfig(MUSHTHROMLAND));
  const expMush = [0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x20000, 0x50000, 0xa0000, 0x100000, 0x170000, 0x200000, 0x2a0000, 0x340000, 0x400000, 0x4c0000, 0x590000, 0x660000, 0x740000, 0x820000, 0x8f0000, 0x9d0000, 0xaa0000, 0xb70000, 0xc30000, 0xce0000, 0xd80000, 0xe20000, 0xea0000, 0xf10000, 0xf70000, 0xfb0000, 0xfe0000, 0xff0000, 0xf0000f, 0xa3005c, 0x4000bf, 0x400fb, 0x18ed, 0x7aa4, 0xe058, 0x2ff42, 0x4fff7b, 0xc6ffd5, 0xffffff];
  assert.deepEqual([...mush.subarray(0, 51)], expMush);
});

test("model routines agree with the reference reading", () => {
  const cr = f32(0.1234567);
  const ci = f32(-0.3210987);
  const pts: Array<[number, number]> = [[-1.2, 0.3], [0.05, 0.07], [0.6, -0.45], [-0.25, 0.8], [0, 0], [1.4, 1.1]];
  const expected = [
    [3, 11, 2, 8, 12, 1], [1, 8, 3, 8, 8, 1], [2, 8, 4, 5, 8, 1], [1, 7, 4, 9, 6, 1], [1, 8, 3, 13, 8, 1],
    [4, 14, 2, 8, 255, 1], [1, 134, 5, 3, 255, 1], [3, 30, 4, 2, 255, 1], [1, 34, 6, 7, 255, 1], [1, 33, 3, 2, 255, 1],
  ];
  for (let m = 0; m < 10; m++) {
    assert.deepEqual(pts.map(([x, y]) => iterate(m, f32(x), f32(y), cr, ci, 255)), expected[m], `model ${m}`);
  }
});

test("model 0 by hand: Z(n+1) = Z(n)^2 + Z(n-1), Z(0) = 0.5, C = 0", () => {
  // 0.75, 1.0625, 1.87890625, 4.59 -> escapes after the 4th step
  assert.equal(iterate(0, 0.5, 0, 0, 0, 50), 4);
  assert.equal(iterate(0, 0, 0, 0, 0, 50), 50); // never escapes: the limit, i.e. the last palette entry
  assert.equal(iterate(0, 1.5, 0, 0, 0, 50), 1); // Z(0) itself is not tested
  assert.equal(iterate(0, 0.5, 0, 0, 0, 3), 3); // limit reached before the escape
});

test("VU from the signed waveform", () => {
  const vis = new Int8Array(2304);
  for (let i = 0; i < 576; i++) {
    vis[1152 + i] = i & 1 ? 10 : -10; // |diff| = 20 at every step of channel 0
    vis[1728 + i] = i < 300 ? 0 : 50; // one step of 50 on channel 1
  }
  vis[0] = 127; // the spectrum is ignored
  assert.equal(vuLevel(vis), (575 * 20 + 50) * 1e-5);
});

test("view rectangle keeps A*B = s^2 and A/B = w/h", () => {
  const [x0, x1, y0, y1] = viewRect(640, 480, f32(0.15));
  const s = Math.pow(0.01, f32(0.15)) * 3;
  assert.equal(x0, -x1);
  assert.equal(y0, -y1);
  assert.ok(Math.abs(x1 * y1 - s * s) < 1e-6);
  assert.ok(Math.abs(x1 / y1 - 4 / 3) < 1e-6);
  assert.deepEqual(viewRect(10, 7, f32(0.15)), [-1.7970999479293823, 1.7970999479293823, -1.257969856262207, 1.257969856262207]);
});

test("blend routines (a = fractal colour, b = framebuffer)", () => {
  const a = 0x10f08020;
  const b = 0x2020ff10;
  assert.equal(blendModes[0]!(a, b), a);
  assert.equal(blendModes[1]!(a, b), 0x1888bf18); // per byte (a+b)>>1, all four bytes (MMX)
  assert.equal(blendModes[2]!(a, b), 0x30ffff30); // paddusb
  assert.equal(blendModes[3]!(a, b), 0x10007f00); // psubusb: b - a
  assert.equal(blendModes[4]!(a, b), 0x10f0ff20); // max of bytes 0..2, byte 3 of a
  assert.equal(blendModes[5]!(a, b), 0x10208010);
});

test("full-resolution grid of a 10x7 frame (row length not a multiple of 4)", () => {
  const cfgBytes = new Uint8Array(2100);
  const dv = new DataView(cfgBytes.buffer);
  dv.setUint32(0x008, 0xffffff, true);
  dv.setUint32(0x80c, 2, true);
  dv.setUint32(0x810, 50, true);
  dv.setFloat32(0x820, 0.15, true);
  cfgBytes[0x826] = 0; // no pixel doubling
  const vf = new VisFrac(cfgBytes);
  const w = 10, h = 7;
  const buf = vf.computeGrid(w, h, f32(w - 1), f32(h - 1), f32(0.11), f32(0.17), viewRect(w, h, f32(0.15)));
  assert.deepEqual([...buf.subarray(0, w * h)], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 6, 6, 5, 1, 1, 1, 1, 1, 2, 16, 22, 12, 50, 2, 1, 1, 1, 1, 10, 14, 13, 10, 3, 1, 1, 1, 1, 1, 2, 28, 9, 9, 10, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const fb = new Int32Array(w * h).fill(0x01020304);
  vf.draw(fb, w, h, buf, w);
  assert.equal(fb[26] >>> 0, 0xffffff); // count 50 = the limit = colour at 1.0
  assert.equal(fb[23] >>> 0, 0x525252);
  assert.equal(fb[0] >>> 0, 0x050505);
});

test("pixel doubling of a 9x6 frame with 50/50 blend", () => {
  const cfgBytes = new Uint8Array(2100);
  const dv = new DataView(cfgBytes.buffer);
  dv.setUint32(0x008, 0xffffff, true);
  dv.setUint32(0x80c, 7, true);
  dv.setUint32(0x810, 40, true);
  dv.setFloat32(0x820, 0.15, true);
  cfgBytes[0x826] = 1;
  dv.setUint32(0x828, 1, true);
  const vf = new VisFrac(cfgBytes);
  const w = 9, h = 6, cols = 8, rows = 4;
  const buf = vf.computeGrid(cols, rows, f32((w - 1) * 0.5), f32((h - 1) * 0.5), f32(-0.2), f32(0.05), viewRect(w, h, f32(0.15)));
  assert.deepEqual([...buf.subarray(0, cols * rows)], [1, 1, 1, 1, 1, 1, 1, 1, 1, 11, 40, 2, 1, 1, 1, 1, 1, 1, 24, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const fb = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) fb[i] = (i * 0x010305) & 0xffffff;
  vf.draw(fb, w, h, buf, cols);
  const exp = [0x30303, 0x30405, 0x40608, 0x4070a, 0x5090d, 0x50a0f, 0x60c12, 0x60d14, 0x70f17, 0x60b0f, 0x101a24, 0x18232e, 0x303c48, 0x475461, 0x293745, 0xc1b2a, 0xb1b2b, 0xb1c2d, 0x9121b, 0x1c2f42, 0x2d4155, 0x5b7085, 0x8aa0b6, 0x4e657c, 0x122a42, 0x112a43, 0x102a44, 0xb1826, 0x193551, 0x213e5b, 0x4b6987, 0x7594b3, 0x466686, 0x173859, 0x153759, 0x14375a, 0xd1f31, 0x153a5f, 0x163c62, 0x3b6289, 0x6088b0, 0x3e6790, 0x1b456f, 0x1a4570, 0x194571, 0xf263c, 0x1a4876, 0x1a4978, 0x2d5d8d, 0x4071a2, 0x2f6193, 0x1e5184, 0x1d5205, 0x1d5307];
  assert.deepEqual([...fb].map((v) => v >>> 0), exp);
});

test("change model after N beats picks another model of the same group with rand()", () => {
  const vf = new VisFrac(ANNOY_YOU); // model 2, every 2 beats
  const draws = [3, 0x7ffe];
  let k = 0;
  let beat = true;
  const ctx = fakeCtx(8, 6, { rand: () => draws[k++]! });
  Object.defineProperty(ctx, "isBeat", { get: () => beat });
  const fb = new Int32Array(48);
  vf.render(ctx, fb, fb);
  assert.equal(vf.model, 2); // first beat: counter 1 of 2
  beat = false;
  vf.render(ctx, fb, fb); // no beat: counter unchanged
  beat = true;
  vf.render(ctx, fb, fb);
  assert.equal(vf.model, 4); // rand & 3 = 3 >= 2 -> 4
  vf.render(ctx, fb, fb);
  assert.equal(vf.model, 4); // counter 1 of 2
  vf.render(ctx, fb, fb);
  assert.equal(vf.model, 2); // 0x7ffe & 3 = 2, not >= 4 -> 2
  assert.equal(k, 2);
});

test("model change stays inside the Z(n-2)*C group", () => {
  const raw = new Uint8Array(2100);
  const dv = new DataView(raw.buffer);
  dv.setUint32(0x80c, 7, true);
  dv.setUint32(0x810, 10, true);
  dv.setUint32(0x830, 0x80000001, true); // every beat
  const vf = new VisFrac(raw);
  const draws = [3, 1, 2];
  let k = 0;
  const ctx = fakeCtx(8, 6, { isBeat: true, rand: () => draws[k++]! });
  const fb = new Int32Array(48);
  vf.render(ctx, fb, fb);
  assert.equal(vf.model, 9); // 3 + 5 = 8 >= 7 -> 9
  vf.render(ctx, fb, fb);
  assert.equal(vf.model, 6); // 1 + 5 = 6 < 9
  vf.render(ctx, fb, fb);
  assert.equal(vf.model, 8); // 2 + 5 = 7 >= 6 -> 8
});

test("rotation phase follows GetTickCount and the float accumulator", () => {
  const vf = new VisFrac(MUSHTHROMLAND); // speed 0.001
  let t = 5000;
  const ctx = fakeCtx(8, 6, { now: () => t });
  const fb = new Int32Array(48);
  vf.render(ctx, fb, fb);
  assert.equal(vf.phase, 0); // the first frame measures from itself
  t += 16;
  vf.render(ctx, fb, fb);
  assert.equal(vf.phase, f32(16 * f32(0.001)));
  t += 17;
  vf.render(ctx, fb, fb);
  assert.equal(vf.phase, f32(17 * f32(0.001) + f32(16 * f32(0.001))));
});

test("every VisFrac preset on disk renders", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "avs-presets");
  const scan = join(here, "..", "..", "..", "scratch", "avs-reference", "visbot", "audit", "ape-scan-vendor.json");
  if (!existsSync(root) || !existsSync(scan)) return;
  const presets = (JSON.parse(readFileSync(scan, "utf8")) as { presets: Record<string, string[]> }).presets;
  const id = new TextEncoder().encode("VisFrac v1.0 by PP");
  let found = 0;
  for (const [path, apes] of Object.entries(presets)) {
    if (!apes.includes("APE:VisFrac v1.0 by PP")) continue;
    const data = new Uint8Array(readFileSync(join(root, path)));
    for (let i = 4; i + 36 <= data.length; i++) {
      if (!id.every((b, k) => data[i + k] === b) || data[i + id.length] !== 0) continue;
      const dv = new DataView(data.buffer, data.byteOffset);
      if (dv.getUint32(i - 4, true) < 16384) continue;
      const size = dv.getUint32(i + 32, true);
      assert.equal(size, 2100, path);
      const effect = ape.create(data.subarray(i + 36, i + 36 + size));
      const fb = new Int32Array(33 * 21);
      let t = 0;
      const ctx = fakeCtx(33, 21, { now: () => (t += 20) });
      assert.equal(effect.render(ctx, fb, fb), 0);
      effect.render(ctx, fb, fb);
      found++;
    }
  }
  assert.equal(found, 11);
});
