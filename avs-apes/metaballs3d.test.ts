import assert from "node:assert/strict";
import test from "node:test";

import {
  ape, Metaballs3D, parseMetaballs3DConfig, metaballs3dDefaults, ftol, spectrumLevel, fieldValue,
  vertexInterp, rotateBall, scaleColor, cycleColor, shadeColor, TRI_TABLE, EDGE_TABLE, GRID_XY, GRID_Z, K,
  type ApeContext,
} from "./metaballs3d.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

function msvcRand(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 214013) + 2531011) >>> 0;
    return (s >>> 16) & 0x7fff;
  };
}

function makeCtx(w: number, h: number, seed = 1234): ApeContext & { isBeat: boolean } {
  const vis = new Uint8Array(2304);
  return {
    w, h, isBeat: false,
    visdata: new Int8Array(vis.buffer), visdataUnsigned: vis,
    rand: msvcRand(1), makeRand: (s?: number) => msvcRand(s ?? 1),
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null,
    now: () => seed,
  };
}

// The only preset using the APE: unconed/Whacko_AVS_IV/UnConeD - 08 - Yummy Plastics.avs (72 bytes).
const YUMMY = "0093ff0033ffc1009f00ff00ffc60000e1ff0d0000ff6600922e3d00" +
  "000000000000000000000000000000000000000000000000000000000000000000000000" + "07000000" + "01000000";

test("config: the real preset, defaults, short, long and out-of-range blobs", () => {
  const c = parseMetaballs3DConfig(hex(YUMMY));
  assert.deepEqual(c.colors.slice(0, 8), [0xff9300, 0xc1ff33, 0xff009f, 0x00c6ff, 0x0dffe1, 0x66ff00, 0x3d2e92, 0]);
  assert.equal(c.count, 7);
  assert.equal(c.onBeat, 1);

  const d = metaballs3dDefaults();
  assert.deepEqual(parseMetaballs3DConfig(new Uint8Array(0)), d);
  assert.equal(d.colors[0], 0x7fff);
  assert.equal(d.count, 1);
  assert.equal(d.onBeat, 0);
  // 4 bytes: only colour 0 is replaced
  assert.deepEqual(parseMetaballs3DConfig(hex("112233ff")).colors.slice(0, 2), [0xff332211 | 0, 0]);
  // longer than 72 bytes: ignored entirely (memcpy only when len <= 72)
  assert.deepEqual(parseMetaballs3DConfig(hex(YUMMY + "00")), d);
  // count clamped to 1..16
  const zero = hex(YUMMY); zero.set([0, 0, 0, 0], 64);
  assert.equal(parseMetaballs3DConfig(zero).count, 1);
  const big = hex(YUMMY); big.set([99, 0, 0, 0], 64);
  assert.equal(parseMetaballs3DConfig(big).count, 16);
  const neg = hex(YUMMY); neg.set([0xff, 0xff, 0xff, 0xff], 64);
  assert.equal(parseMetaballs3DConfig(neg).count, 1);
  assert.equal(ape.id, "Metaballs 3D");
});

test("constants decoded from the binary's bit patterns", () => {
  assert.equal(K.PHASE_STEP, 0.015);
  assert.equal(K.INV_65536, 1 / 65536);
  assert.equal(K.VEL, 1 / 300);
  assert.equal(K.INV_R2, 2.066115702479339e-5);
  assert.equal(K.D_BAND, 0.0016500000000000002);   // not the nearest double to 0.00165
  assert.equal(K.L2_SPD, -0.311);
  assert.equal(K.FIELD, 3000);
});

test("marching-cubes tables are Bourke's, edge table derived from the triangle table", () => {
  assert.deepEqual(Array.from(EDGE_TABLE.slice(0, 8)), [0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c]);
  assert.equal(EDGE_TABLE[255], 0);
  assert.equal(EDGE_TABLE.reduce((a, b) => a + b, 0), 524160);   // sum of the binary's table at 0x10010030
  assert.deepEqual(Array.from(TRI_TABLE.slice(16, 20)), [0, 8, 3, -1]);
  assert.deepEqual(Array.from(TRI_TABLE.slice(3 * 16, 3 * 16 + 7)), [1, 8, 3, 9, 8, 1, -1]);
  assert.deepEqual(Array.from(TRI_TABLE.slice(254 * 16, 254 * 16 + 4)), [0, 3, 8, -1]);
  for (let i = 0; i < 256; i++) assert.equal(TRI_TABLE[i * 16 + 15], -1);
});

test("_ftol truncates and keeps the low dword", () => {
  assert.equal(ftol(2.9), 2);
  assert.equal(ftol(-2.9), -2);
  assert.equal(ftol(-0.5), 0);
  assert.equal(ftol(NaN), 0);
  assert.equal(ftol(4294967296 + 5), 5);
  assert.equal(ftol(1e30), 0);
});

test("spectrum bands: bins [0,2), [20,60), [28,201), channel mean", () => {
  const vis = new Uint8Array(2304);
  const lvl = (p: number, w: number) => spectrumLevel(vis, p, w, 0);
  const band = [(): number => lvl(0, K.BAND0_W), (): number => lvl(K.BAND1_P, K.BAND1_P), (): number => lvl(K.BAND2_P, K.BAND2_W)];
  const probe = (b: number, bin: number): number => {
    vis.fill(0);
    vis[bin] = 255; vis[576 + bin] = 255;
    return band[b]();
  };
  assert.equal(probe(0, 0), 127); assert.equal(probe(0, 1), 127); assert.equal(probe(0, 2), 0);
  assert.equal(probe(1, 19), 0); assert.equal(probe(1, 20), 6); assert.equal(probe(1, 59), 6); assert.equal(probe(1, 60), 0);
  assert.equal(probe(2, 27), 0); assert.equal(probe(2, 28), 1); assert.equal(probe(2, 200), 1); assert.equal(probe(2, 201), 0);
  // per-bin mean of the two channels is truncated before summing
  vis.fill(0);
  for (let i = 0; i < 576; i++) { vis[i] = i & 0xff; vis[576 + i] = 100; }
  assert.equal(band[0](), 50);
  assert.equal(band[1](), 69);   // sum (100+i)>>1 for i=20..59 = 2780, /40
  // a single bin (width 0) and explicit channels
  vis.fill(0); vis[10] = 7; vis[576 + 10] = 9;
  assert.equal(spectrumLevel(vis, 10 / 576 + 1e-9, 0, 0), 8);
  assert.equal(spectrumLevel(vis, 10 / 576 + 1e-9, 0, 1), 7);
  assert.equal(spectrumLevel(vis, 10 / 576 + 1e-9, 0, 2), 9);
});

test("field: sum of trunc(3000 (1 - d²/220²)²) minus 2000", () => {
  const at0 = new Float64Array(18);
  assert.equal(fieldValue(at0, 0, 0, 0), 6 * 3000 - 2000);
  assert.equal(fieldValue(at0, 110, 0, 0), 6 * 1687 - 2000);     // r² = 0.25 → 1687.5
  assert.equal(fieldValue(at0, 0, 220, 0), -2000);               // r² = 1 is outside
  assert.equal(fieldValue(at0, 0, 0, 0) - fieldValue(at0, 0, 0, 0), 0);
  const balls = Float64Array.from([0, 0, 0, 100, 0, 0, 0, -60, 10, -50, 40, -5, 200, 200, 0, -300, 0, 0]);
  // expected values computed independently with IEEE doubles (Python) in the binary's order
  assert.equal(fieldValue(balls, 0, 0, 0), 7956);
  assert.equal(fieldValue(balls, 30, -30, 22), 7451);
  assert.equal(fieldValue(balls, -90, 60, -45), 2836);
  assert.equal(fieldValue(balls, 150, 150, 0), 1127);
});

test("grid: x/y -330..330 step 30, z = trunc(t/4) for t = -990..990 step 90", () => {
  assert.equal(GRID_XY[0], -330); assert.equal(GRID_XY[22], 330); assert.equal(GRID_XY[11], 0);
  assert.deepEqual(Array.from(GRID_Z), [-247, -225, -202, -180, -157, -135, -112, -90, -67, -45, -22, 0,
    22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247]);
});

test("vertex interpolation at iso 0 (z + 480)", () => {
  const o = new Float64Array(3);
  vertexInterp(o, 0, 0, 0, 0, 30, 0, 0, -100, 200);
  assert.deepEqual(Array.from(o), [10, 0, 480]);
  vertexInterp(o, 0, -300, -330, -247, -330, -330, -247, -100, 100);
  assert.deepEqual(Array.from(o), [-315, -330, 233]);
  vertexInterp(o, 0, 1, 2, 3, 4, 5, 6, 0, 50);
  assert.deepEqual(Array.from(o), [1, 2, 483]);
  vertexInterp(o, 0, 1, 2, 3, 4, 5, 6, 50, 0);
  assert.deepEqual(Array.from(o), [4, 5, 486]);
  vertexInterp(o, 0, 1, 2, 3, 4, 5, 6, -7, -7);
  assert.deepEqual(Array.from(o), [2.5, 3.5, 484.5]);
});

test("ball rotation: about y by b, then x by a, then z by c", () => {
  const v = Float64Array.from([1, 0, 0]);
  rotateBall(v, 0, 0, Math.PI / 2, 0);
  assert.ok(Math.abs(v[0]) < 1e-15 && v[1] === 0 && v[2] === 1);
  const u = Float64Array.from([0, 1, 0]);
  rotateBall(u, 0, Math.PI / 2, 0, 0);
  assert.ok(u[0] === 0 && Math.abs(u[1]) < 1e-15 && u[2] === 1);
  const s = Float64Array.from([1, 0, 0]);
  rotateBall(s, 0, 0, 0, Math.PI / 2);
  assert.ok(Math.abs(s[0]) < 1e-15 && s[1] === -1 && s[2] === 0);
});

test("colour cycle and vertex shading arithmetic", () => {
  assert.equal(scaleColor(0xff0000, 128), 0x7f0000);
  assert.equal(scaleColor(0x0000ff, 127), 0x00007e);
  assert.equal(scaleColor(0xffffff, 255), 0xfefefe);
  assert.equal(cycleColor([0xff0000, 0x0000ff], 2, 0.5), 0x7f007e);
  assert.equal(cycleColor([0xff0000, 0x0000ff], 2, 1.5), 0x7e007f);
  assert.equal(cycleColor([0x123456, 0, 0], 3, 0), 0x113355);      // (C*255)>>8 at f = 0
  assert.equal(cycleColor([0x7fff, 0xffffff], 1, 0.7), 0x7fff);      // one colour: used as is
  assert.equal(shadeColor(0xff8040, 254, 0), 0xfc7e3e);
  assert.equal(shadeColor(0xffffff, 254, 254), 0xffffff);
  assert.equal(shadeColor(0x000000, 64, 100), 0x636363);
});

test("marching cubes: one inside grid point gives 6 shared vertices and 8 triangles", () => {
  const e = new Metaballs3D(metaballs3dDefaults());
  e.lattice.fill(100);
  e.lattice[(1 * 23 + 1) * 23 + 1] = -100;      // grid point (x1, y1, z1)
  e.nv = 0; e.nt = 0;
  e.march();
  assert.equal(e.nv, 6);
  assert.equal(e.nt, 8);
  for (let i = 0; i < e.nt * 3; i++) assert.ok(e.tidx[i] >= 0 && e.tidx[i] < 6);
  // first vertex: edge 5 of cube (0,0,0), from (x1, y0, z1) [+100] to (x1, y1, z1) [-100]
  assert.deepEqual(Array.from(e.vpos.slice(0, 3)), [-300, -315, -225 + 480]);
  // second: edge 6 of cube (0,0,0), from (x1, y1, z1) [-100] to (x0, y1, z1) [+100]
  assert.deepEqual(Array.from(e.vpos.slice(3, 6)), [-315, -300, -225 + 480]);
  // a corner cube is never cached: one negative corner at (0,0,0) → edges 0, 3, 8, triangle (0, 8, 3)
  e.lattice.fill(100);
  e.lattice[0] = -100;
  e.nv = 0; e.nt = 0;
  e.march();
  assert.equal(e.nv, 3);
  assert.equal(e.nt, 1);
  assert.deepEqual(Array.from(e.tidx.slice(0, 3)), [0, 2, 1]);
  assert.deepEqual(Array.from(e.vpos.slice(0, 9)), [-315, -330, 233, -330, -315, 233, -330, -330, -247 + 11 + 480]);
});

function setTri(e: Metaballs3D, pts: number[][], cols: number[]): void {
  e.nv = 3;
  for (let i = 0; i < 3; i++) {
    e.vpos[i * 3] = pts[i][0]; e.vpos[i * 3 + 1] = pts[i][1]; e.vpos[i * 3 + 2] = pts[i][2];
    e.vcol[i] = cols[i];
  }
}

test("triangle raster: flat fill, 1/z buffer, 0x010101 outline, culling", () => {
  const w = 64, h = 64;   // scale 32, z = 512 → x/16, y/16 exactly
  const e = new Metaballs3D(metaballs3dDefaults());
  e.zbuf = new Uint16Array(w * h); e.zw = w; e.zh = h;
  const fb = new Int32Array(w * h).fill(0x404040);
  const P = (x: number, y: number): number => fb[y * w + x];
  setTri(e, [[-160, -160, 512], [160, -160, 512], [0, 160, 512]], [0x806040, 0x806040, 0x806040]);
  e.drawTriangle(fb, w, h, 0, 1, 2, 1.0);
  const col = 0x806040 | 0x010101;
  assert.equal(P(22, 22), col); assert.equal(P(42, 22), col); assert.equal(P(32, 30), col);
  assert.equal(P(31, 41), col); assert.equal(P(32, 41), col);
  assert.equal(P(21, 22), 0x010101); assert.equal(P(43, 22), 0x010101);   // left/right of a span
  assert.equal(P(30, 21), 0x010101);                                      // above the first row
  assert.equal(P(32, 42), 0x010101); assert.equal(P(30, 41), 0x010101);   // below / left of the last row
  assert.equal(P(42, 23), 0x010101);                                      // the edge steps inwards
  assert.equal(P(5, 5), 0x404040);
  assert.equal(e.zbuf[30 * w + 32], 128);                                 // 65536/512
  // a nearer triangle wins the z test, a farther one does not
  setTri(e, [[-80, -80, 256], [80, -80, 256], [0, 80, 256]], [0x0000ff, 0x0000ff, 0x0000ff]);
  e.drawTriangle(fb, w, h, 0, 1, 2, 0.0);
  assert.equal(P(32, 30), 0x0101ff);
  setTri(e, [[-320, -320, 1024], [320, -320, 1024], [0, 320, 1024]], [0x00ff00, 0x00ff00, 0x00ff00]);
  e.drawTriangle(fb, w, h, 0, 1, 2, 0.0);
  assert.equal(P(32, 30), 0x0101ff);
  // culled: normal z below -0.3, or a vertex nearer than z = 1
  const before = fb.slice();
  setTri(e, [[-160, -160, 300], [160, -160, 300], [0, 160, 300]], [0xffffff, 0xffffff, 0xffffff]);
  e.drawTriangle(fb, w, h, 0, 1, 2, -0.31);
  setTri(e, [[-160, -160, 0.5], [160, -160, 300], [0, 160, 300]], [0xffffff, 0xffffff, 0xffffff]);
  e.drawTriangle(fb, w, h, 0, 1, 2, 1.0);
  assert.deepEqual(fb, before);
});

test("triangle raster: Gouraud colours along the first row", () => {
  const w = 64, h = 64;
  const e = new Metaballs3D(metaballs3dDefaults());
  e.zbuf = new Uint16Array(w * h); e.zw = w; e.zh = h;
  const fb = new Int32Array(w * h);
  setTri(e, [[-160, -160, 512], [160, -160, 512], [0, 160, 512]], [0xff0000, 0x00ff00, 0x0000ff]);
  e.drawTriangle(fb, w, h, 0, 1, 2, 1.0);
  // row 22 runs from vertex 0 (x 22) to vertex 1 (x 42): slope ((0-0xff00)<<8)/(20*256+1) = -3263
  assert.equal(fb[22 * w + 22], 0xff0101);
  assert.equal(fb[22 * w + 42], 0x01ff01);
  assert.equal(fb[22 * w + 32], ((0xff00 - 3263 * 10) >> 8) << 16 | ((3263 * 10) >> 8) << 8 | 0x010101);
});

test("render: smoke test on a small frame, deterministic for a given seed", () => {
  const run = (): Int32Array => {
    const w = 96, h = 72;
    const eff = ape.create(hex(YUMMY));
    const ctx = makeCtx(w, h, 777);
    const fb = new Int32Array(w * h);
    const out = new Int32Array(w * h).fill(0x5a5a5a);
    for (let f = 0; f < 12; f++) {
      for (let i = 0; i < 576; i++) {
        ctx.visdataUnsigned[i] = Math.max(0, 160 - i + ((f * 37 + i * 11) % 50));
        ctx.visdataUnsigned[576 + i] = ctx.visdataUnsigned[i];
      }
      ctx.isBeat = f % 5 === 2;
      fb.fill(0x202020);
      assert.equal(eff.render(ctx, fb, out), 0);
    }
    assert.ok(out.every((p) => p === 0x5a5a5a));
    return fb;
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  let drawn = 0;
  for (const p of a) {
    if (p !== 0x202020) {
      drawn++;
      assert.equal(p & 0x010101, 0x010101);
    }
  }
  assert.ok(drawn > 200, `drawn ${drawn}`);
});

test("render: silence and default config still draw the six balls in the default colour", () => {
  const w = 80, h = 60;
  const eff = ape.create(new Uint8Array(0)) as Metaballs3D;
  const ctx = makeCtx(w, h);
  const fb = new Int32Array(w * h);
  for (let f = 0; f < 3; f++) eff.render(ctx, fb, fb);
  // no audio, no beat: radii stay 0, every ball sits at the origin → one sphere
  assert.deepEqual(Array.from(eff.radius), [0, 0, 0, 0, 0, 0]);
  assert.ok(eff.nt > 0);
  const centre = fb[30 * w + 40];
  assert.notEqual(centre, 0);
  // the default colour 0x007FFF has no red: red is the specular term alone, blue is diffuse + specular
  assert.ok((centre & 0xff) > ((centre >> 16) & 0xff));
});
