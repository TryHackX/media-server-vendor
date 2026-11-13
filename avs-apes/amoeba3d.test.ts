import assert from "node:assert/strict";
import test from "node:test";

import {
  ape, bandLevel, buildFaces, mixColor, parseTentacles3DConfig, rasterTriangle, rotateVec, shade, Tentacles3D,
  type ApeContext
} from "./amoeba3d.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** MSVC rand() with srand(seed). */
function msvcRand(seed = 1): () => number {
  let hold = seed >>> 0;
  return () => {
    hold = (Math.imul(hold, 214013) + 2531011) >>> 0;
    return (hold >>> 16) & 0x7fff;
  };
}

function makeCtx(w: number, h: number, now = 1000): ApeContext & { visdata: Int8Array } {
  const visdata = new Int8Array(2304);
  return {
    w, h, isBeat: false, visdata, visdataUnsigned: new Uint8Array(visdata.buffer),
    rand: () => 0, makeRand: (seed?: number) => msvcRand(seed), registers: new Float64Array(100),
    lineBlendMode: 0, globalBuffer: () => null, now: () => now
  };
}

const FABRY = "dbdbdb001b1b1b00d2d2d20007070700b4b4b4001d1d1d00f8f8f80008080800d3d3d3009f9f9f007a7a7a005b5b5b003f3f3f002828280012121200000000001000000001000000";
const UNCONED = "5a5aff005affff005aff5a00ffff5a00ff5a5a00ff5aff00000000000000000000000000000000000000000000000000000000000000000000000000000000000700000001000000";

test("config parsing: both presets, defaults, memcpy semantics, count clamp", () => {
  // fabry/FabryAVS/Fabry - Dark Silver Ending.avs
  const a = parseTentacles3DConfig(hex(FABRY));
  assert.deepEqual(a.colors, [0xdbdbdb, 0x1b1b1b, 0xd2d2d2, 0x070707, 0xb4b4b4, 0x1d1d1d, 0xf8f8f8, 0x080808,
    0xd3d3d3, 0x9f9f9f, 0x7a7a7a, 0x5b5b5b, 0x3f3f3f, 0x282828, 0x121212, 0]);
  assert.equal(a.count, 16);
  assert.equal(a.onBeat, 1);
  // unconed/Whacko_AVS_IV/UnConeD - 10 - Rubber Starfish.avs
  const b = parseTentacles3DConfig(hex(UNCONED));
  assert.deepEqual(b.colors.slice(0, 7), [0xff5a5a, 0xffff5a, 0x5aff5a, 0x5affff, 0x5a5aff, 0xff5aff, 0]);
  assert.equal(b.count, 7);
  assert.equal(b.onBeat, 1);
  // defaults (constructor 0x10001300)
  const d = parseTentacles3DConfig(new Uint8Array(0));
  assert.equal(d.colors[0], 0x7fff);
  assert.ok(d.colors.slice(1).every((c) => c === 0));
  assert.equal(d.count, 1);
  assert.equal(d.onBeat, 0);
  // longer than 72 bytes: ignored; count clamped to 1..16
  assert.deepEqual(parseTentacles3DConfig(new Uint8Array(73).fill(0x11)), d);
  const c0 = new Uint8Array(72); c0[64] = 0;
  assert.equal(parseTentacles3DConfig(c0).count, 1);
  const c17 = new Uint8Array(72); c17[64] = 17;
  assert.equal(parseTentacles3DConfig(c17).count, 16);
  // partial: 3 bytes overwrite the low bytes of colors[0] only
  assert.equal(parseTentacles3DConfig(hex("123456")).colors[0], 0x563412);
});

test("spectrum bands: bins [0,2), [20,60), [28,201) of (L+R)>>1, truncated mean", () => {
  const vis = new Uint8Array(2304);
  for (let i = 0; i < 576; i++) { vis[i] = i & 0xff; vis[576 + i] = 1; }
  // (0, 0.007): bins 0,1 -> ((0+1)>>1 + (1+1)>>1)/2 = (0+1)/2 = 0
  assert.equal(bandLevel(vis, 0.0, 0.007), 0);
  vis.fill(0);
  for (let i = 20; i < 60; i++) vis[i] = 200;            // only the mid band's bins
  assert.equal(bandLevel(vis, 0.07, 0.07), 100);          // (200+0)>>1
  assert.equal(bandLevel(vis, 0.0, 0.007), 0);
  // high band [28,201): 32 of 173 bins hold 100 -> 3200/173 = 18
  assert.equal(bandLevel(vis, 0.2, 0.3), 18);
  // single-bin path (width 0)
  vis.fill(0); vis[57] = 10; vis[576 + 57] = 31;
  assert.equal(bandLevel(vis, 0.1, 0), 20);               // trunc(0.1*576) = 57
});

test("rotation order: y by b, then x by a, then z by c", () => {
  const [x1, y1, z1] = rotateVec(1, 0, 0, 0, Math.PI / 2, 0);
  assert.ok(Math.abs(x1) < 1e-15 && y1 === 0 && Math.abs(z1 - 1) < 1e-15);
  const [x2, y2, z2] = rotateVec(0, 0, 1, Math.PI / 2, 0, 0);
  assert.ok(x2 === 0 && Math.abs(y2 + 1) < 1e-15 && Math.abs(z2) < 1e-15);
  const [x3, y3, z3] = rotateVec(1, 0, 0, 0, 0, Math.PI / 2);
  assert.ok(Math.abs(x3) < 1e-15 && Math.abs(y3 + 1) < 1e-15 && z3 === 0);
  // composition: (1,0,0) with b then a: y-rot to (cos b, 0, sin b), then x-rot
  const [x4, y4, z4] = rotateVec(1, 0, 0, 0.3, 0.5, 0);
  assert.ok(Math.abs(x4 - Math.cos(0.5)) < 1e-15);
  assert.ok(Math.abs(y4 + Math.sin(0.5) * Math.sin(0.3)) < 1e-15);
  assert.ok(Math.abs(z4 - Math.sin(0.5) * Math.cos(0.3)) < 1e-15);
});

test("topology: 6 tubes x 30 segments x 4 quads (2 triangles each)", () => {
  const f = buildFaces();
  assert.equal(f.length, 1440 * 3);
  assert.deepEqual([...f.slice(0, 12)], [0, 1, 4, 5, 4, 1, 1, 2, 5, 6, 5, 2]);
  assert.deepEqual([...f.slice(18, 24)], [3, 0, 7, 4, 7, 0]);       // k = 3 wraps to corner 0
  assert.deepEqual([...f.slice(240 * 3, 240 * 3 + 3)], [124, 125, 128]); // tentacle 1 starts at 124
  assert.equal(Math.max(...f), 743);
});

test("beat values: tentacle 0 is smoothed 5 times, the others only shift", () => {
  const t = new Tentacles3D(new Uint8Array(0));
  t.updateEntries(true);
  assert.equal(t.entBeat[0], 255);
  assert.equal(t.entBeat[30], 255);
  t.updateEntries(false);
  assert.deepEqual([...t.entBeat.slice(0, 8)], [0, 255, 247, 207, 127, 47, 7, 0]);
  assert.deepEqual([...t.entBeat.slice(30, 34)], [0, 255, 0, 0]);
  // root directions are the six axes rotated by the three angles (all 0 here)
  assert.deepEqual([...t.ent.slice(3 * 31, 3 * 31 + 3)], [-1, 0, 0]);
  assert.deepEqual([...t.ent.slice(3 * 150, 3 * 150 + 3)], [0, 0, -1]); // tentacle 5's fresh root
  assert.deepEqual([...t.ent.slice(3 * 151, 3 * 151 + 3)], [0, 0, -1]); // and last frame's, shifted
});

test("tube geometry for a straight tentacle along +x", () => {
  const t = new Tentacles3D(new Uint8Array(0));
  for (let j = 0; j < 30; j++) { t.ent[3 * j] = 1; t.ent[3 * j + 1] = 0; t.ent[3 * j + 2] = 0; }
  t.entBeat[5] = 99;
  t.zoom = 1.0;
  t.buildVertices();
  for (let q = 0; q < 4; q++) assert.deepEqual([t.vx[q], t.vy[q], t.vz[q]], [0, 0, 23]);
  // segment j = 5: A = (6,0,0); centre B = (5*0.7241379310344828, 0, 23)
  const j = 5, base = 4 + 4 * j;
  const bx = 5 * 1.0 * 0.7241379310344828;
  const r = (j * -0.034482758620689655 + 1.0) / 6 * 1.7; // U = (0,0,-6) has length 6
  assert.equal(t.vx[base], 0 * r + bx);
  assert.equal(t.vz[base], -6 * r + 23);                   // k = 0: U
  const rv = (j * -0.034482758620689655 + 1.0) / 1 * 1.7;  // V = (0,-1,0) after normalising
  assert.equal(t.vy[base + 1], -1 * rv);                   // k = 1: V
  assert.equal(t.vz[base + 2], 6 * r + 23);                // k = 2: -U
  assert.equal(t.vy[base + 3], 1 * rv);                    // k = 3: -V
  assert.equal(t.vbeat[base + 2], 99);
  // the last ring has radius 1.7*(1-29/29) = 0: collapses onto its centre
  const last = 4 + 4 * 29;
  assert.ok(Math.abs(t.vz[last] - 23) < 1e-12);
});

test("colour helpers", () => {
  assert.equal(mixColor(0xff0000, 0x0000ff, 0), 0x0000fe);
  assert.equal(mixColor(0xff0000, 0x0000ff, 255), 0xfe0000);
  // shade: per channel min(((c*df>>8)*255>>8) + (sp*255>>8), 255)
  const W = 0xffffff;
  assert.equal(shade(255, 0, W & 0xff00, W & 0xff, W & 0xff00ff), 0xfdfdfd);
  assert.equal(shade(255, 254, W & 0xff00, W & 0xff, W & 0xff00ff), 0xffffff);
  assert.equal(shade(64, 0, 0, 0, 0xff0000), 0x3e0000);
  // r: (32*64>>8)*255>>8 = 7, g: 31, b: 15, each + 100*255>>8 = 99
  assert.equal(shade(64, 100, 0x8000, 0x40, 0x200040), 0x6a8272);
  // base colour cycling: position 1.5 between colours 1 and 2
  const t = new Tentacles3D(hex(UNCONED));
  t.colorPos = 1.5;
  assert.equal(t.baseColor(), mixColor(0x5aff5a, 0xffff5a, 127));
  t.colorPos = 6.5; // between colour 6 (black) and colour 0 (wraps)
  assert.equal(t.baseColor(), mixColor(0xff5a5a, 0, 127));
});

test("rasteriser: flat triangle, Gouraud span, z-buffer and the 0x010101 outline", () => {
  const w = 40, h = 40;
  const fb = new Int32Array(w * h).fill(0x123456);
  const zb = new Uint16Array(2 * w * h + 2);
  const col = 0x806040;
  const v = (x: number, y: number, z: number) => ({ x, y, z, nx: 0, ny: 0, nz: 0, col });
  // F = zoom * min(20,20) = 20, 1/z = 0.5: (1,0,2) -> x' = 10 -> X = 30; (0,1,2) -> Y = 30
  rasterTriangle(fb, zb, w, h, 1.0, v(0, 0, 2), v(1, 0, 2), v(0, 1, 2));
  const px = (x: number, y: number) => fb[y * w + x];
  const lit = col | 0x010101;
  for (let y = 20; y <= 29; y++) {
    const right = 30 - (y - 20);
    for (let x = 20; x <= right; x++) assert.equal(px(x, y), lit, `${x},${y}`);
    assert.equal(px(19, y), 0x010101, `left outline ${y}`);
    assert.equal(px(right + 1, y), 0x010101, `right outline ${y}`);
    assert.equal(zb[y * w + 20], 32768);
  }
  for (let x = 20; x <= 30; x++) assert.equal(px(x, 19), 0x010101, `top outline ${x}`);
  assert.equal(px(20, 30), 0x010101);
  assert.equal(px(21, 30), 0x010101);
  assert.equal(px(22, 30), 0x123456);
  assert.equal(px(25, 25), lit);       // row 25 spans x = 20..25
  assert.equal(px(26, 25), 0x010101);
  assert.equal(px(27, 25), 0x123456);
  // a farther triangle behind it does not overwrite (smaller 1/z), a nearer one does
  rasterTriangle(fb, zb, w, h, 1.0, { ...v(0, 0, 4), col: 0xff }, { ...v(2, 0, 4), col: 0xff }, { ...v(0, 2, 4), col: 0xff });
  assert.equal(px(21, 21), lit);
  rasterTriangle(fb, zb, w, h, 1.0, { ...v(0, 0, 1.5), col: 0xff }, { ...v(1, 0, 1.5), col: 0xff }, { ...v(0, 1, 1.5), col: 0xff });
  assert.equal(px(21, 21), 0x0101ff);
  // behind the near plane (z < 1): nothing
  const fb2 = new Int32Array(w * h);
  rasterTriangle(fb2, new Uint16Array(2 * w * h + 2), w, h, 1.0, v(0, 0, 0.5), v(1, 0, 2), v(0, 1, 2));
  assert.ok(fb2.every((p) => p === 0));
});

test("smoke render: deterministic for a given seed, draws, returns 0", () => {
  const w = 96, h = 72;
  const run = (now: number) => {
    const ctx = makeCtx(w, h, now);
    const e = ape.create(hex(FABRY));
    const fb = new Int32Array(w * h);
    let ret = 0;
    for (let f = 0; f < 40; f++) {
      for (let i = 0; i < 576; i++) { ctx.visdata[i] = (f * 13 + i) & 63; ctx.visdata[576 + i] = (f * 5 + i) & 63; }
      (ctx as { isBeat: boolean }).isBeat = f % 6 === 0;
      fb.fill(0);
      ret |= e.render(ctx, fb, new Int32Array(w * h));
    }
    return { fb, ret };
  };
  const a = run(4242), b = run(4242), c = run(99);
  assert.equal(a.ret, 0);
  assert.deepEqual(a.fb, b.fb);
  assert.notDeepEqual(a.fb, c.fb);
  let drawn = 0, outline = 0;
  for (const p of a.fb) { if (p === 0x010101) outline++; else if (p !== 0) drawn++; }
  assert.ok(drawn > 200, `drawn ${drawn}`);
  assert.ok(outline > 20, `outline ${outline}`);
  // every lit pixel has the low bit of each channel set
  assert.ok(a.fb.every((p) => p === 0 || (p & 0x010101) === 0x010101));
  // the roots meet at the centre of the frame
  assert.notEqual(a.fb[36 * w + 48], 0);
});
