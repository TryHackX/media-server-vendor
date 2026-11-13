import assert from "node:assert/strict";
import test from "node:test";

import {
  BP_CONST, BP_FACES, BP_VERTS, bpBackground, bpBlend, bpCos, bpInitialize, bpLength, bpLightVertices, bpLine,
  bpRender, bpTriangle, bpUpdateMesh, svp,
  type ApeContext, type BpSurface, type SvpVisData
} from "./svp-beatpipe.ts";

const ctx = {} as ApeContext;

function visData(spectrum = 0): SvpVisData {
  return {
    millSec: 0,
    waveform: [new Uint8Array(512), new Uint8Array(512)],
    spectrum: [new Uint8Array(256).fill(spectrum), new Uint8Array(256).fill(spectrum)]
  };
}

function hexOf(value: number): string {
  return Buffer.from(new Float64Array([value]).buffer).toString("hex");
}

function surface(w: number, h: number, fill = 0x12345678): BpSurface {
  return { video: new Int32Array(w * h).fill(fill), width: w, height: h, pitch: w };
}

test("beatpipe: .rdata doubles are the binary's bit patterns", () => {
  assert.equal(hexOf(BP_CONST.angle), "1f85eb51b81e1940"); // 0x100230D8
  assert.equal(hexOf(BP_CONST.spectrumScale), "2d431cebe2361a3f"); // 0x100230E0
  assert.equal(hexOf(BP_CONST.radiusBase), "0000000000000440"); // 0x100230E8
  assert.equal(hexOf(BP_CONST.dt1), "8e0585419946ab3f"); // 0x100230F0
  assert.equal(hexOf(BP_CONST.dt2), "96b377465b95ac3f"); // 0x100230F8
  assert.equal(hexOf(BP_CONST.dt3), "e525ff93bf7bb13f"); // 0x10023100
});

test("beatpipe: Initialize builds a 15 x 25 half pipe and 672 triangles", () => {
  const st = bpInitialize();
  assert.equal(BP_VERTS, 375);
  assert.equal(BP_FACES, 672);
  assert.deepEqual([...st.vert.subarray(0, 6)], [-24, 2, -0, 0, 1, -0]);
  const th = ((14 * 6.28) / 15) / 2;
  assert.deepEqual([...st.vert.subarray(374 * 6, 375 * 6)], [24, Math.cos(th) * 2, -Math.sin(th) * 2, 0, Math.cos(th), -Math.sin(th)]);
  assert.deepEqual([...st.face.subarray(0, 6)], [0, 25, 1, 25, 26, 1]);
  assert.deepEqual([...st.face.subarray(671 * 3)], [373, 374, 349]);
  assert.ok(st.color.every((c) => c === 0x8888ff));
  assert.equal(st.scene.lights.length, 3);
});

test("beatpipe: colour blend (0x100011D6) and its alpha", () => {
  assert.equal(bpBlend(0xff0000, 0x0000ff, 128), (0xff7f007f | 0));
  assert.equal(bpBlend(0x123456, 0xabcdef, 0), (0xffabcdef | 0));
  assert.equal(bpBlend(0x123456, 0xabcdef, 256), (0xff123456 | 0));
  assert.equal(bpBlend(0x102030, 0x405060, 64), (0xff344454 | 0));
});

test("beatpipe: line runs from cB at the first point to cA at the last; plain colour when equal", () => {
  const s = surface(8, 4, 0);
  bpLine(s, 0, 1, 4, 1, 0xff0000, 0x0000ff);
  assert.equal(s.video[1 * 8 + 0], (0xff0000ff | 0));
  assert.equal(s.video[1 * 8 + 4], (0xffff0000 | 0));
  assert.equal(s.video[1 * 8 + 2], bpBlend(0xff0000, 0x0000ff, 128));
  const s2 = surface(8, 4, 0);
  bpLine(s2, 6, 3, 1, 0, 0x00ff00, 0x00ff00);
  let lit = 0;
  for (const v of s2.video) if (v === 0x00ff00) lit++;
  assert.equal(lit, 6);
  const s3 = surface(4, 4, 0);
  bpLine(s3, 2, 2, 2, 2, 0x112233, 0x445566);
  assert.equal(s3.video[2 * 4 + 2], (0xff112233 | 0));
});

test("beatpipe: triangles are culled by winding and filled with Gouraud steps", () => {
  const s = surface(16, 16, 0);
  assert.equal(bpTriangle(s, 0, 0, 0, 10, 10, 0, 0xff0000, 0xff0000, 0xff0000), false);
  assert.ok(s.video.every((v) => v === 0));
  assert.equal(bpTriangle(s, 2, 2, 12, 2, 2, 12, 0xff0000, 0x00ff00, 0x0000ff), true);
  let drawn = 0;
  for (const v of s.video) if (v !== 0) drawn++;
  assert.equal(drawn, 66);
  assert.equal(s.video[2 * 16 + 2], (0xffff0000 | 0));
  assert.equal(s.video[12 * 16 + 2] >>> 24, 0xff);
  assert.equal(s.video[1 * 16 + 2], 0);
  assert.equal(s.video[13 * 16 + 2], 0);
});

test("beatpipe: vector helpers", () => {
  assert.equal(bpCos(1, 0, 0, 0, 1, 0), 0);
  assert.equal(bpCos(0, 0, 0, 1, 2, 3), 0);
  assert.equal(bpCos(2, 0, 0, 5, 0, 0), 1);
  assert.equal(bpLength(3, 4, 12), 13);
});

test("beatpipe: vertex projection and lighting at the first frame's light positions", () => {
  const st = bpInitialize();
  st.scene.lights[0]!.x = 50;
  st.scene.lights[0]!.y = 50;
  st.scene.lights[0]!.z = 50;
  const px = new Float64Array(BP_VERTS);
  const py = new Float64Array(BP_VERTS);
  const pc = new Int32Array(BP_VERTS);
  bpLightVertices(st, px, py, pc);
  assert.equal(px[0], -0.8888888888888888);
  assert.equal(py[0], 0.07407407407407407);
  assert.equal(pc[0], 0x331a31);
  assert.equal(pc[7 * 25 + 12], 0x352151);
  assert.equal(pc[14 * 25 + 24], 0x0d2864);
  assert.equal(pc[3 * 25 + 5], 0x40101e);
});

test("beatpipe: the ring profile scrolls one point per call and follows the spectrum energy", () => {
  const st = bpInitialize();
  bpUpdateMesh(st, visData(0));
  assert.equal(st.radius, 1.25);
  assert.equal(st.vert[1], 1.25); // head of ring 0
  assert.equal(st.vert[6 + 1], 2); // the old head moved one point on
  assert.equal(st.vert[6 + 3], 0); // slope (2 - 2) / 2
  bpUpdateMesh(st, visData(0));
  assert.equal(st.radius, 1.875);
  assert.equal(st.vert[6 + 1], 1.25);
  assert.equal(st.vert[6 + 3], -0.375); // (1.25 - 2) / 2
  assert.equal(st.vert[2 * 6 + 3], 0);
  const loud = bpInitialize();
  bpUpdateMesh(loud, visData(100));
  assert.equal(loud.radius, (51200 * 0.0001 + 2.5) / 2);
});

test("beatpipe: Render replaces the frame (checkerboard) and draws the pipe", () => {
  const w = 160;
  const h = 120;
  const back = surface(w, h, -1);
  bpBackground(back);
  assert.equal(back.video[0], 0);
  assert.equal(back.video[10], 0x303030);
  assert.equal(back.video[10 * w], 0x303030);
  assert.equal(back.video[10 * w + 10], 0);
  const effect = svp.create();
  const frame = new Int32Array(w * h).fill(0x7f00ff00);
  effect.render(frame, w, h, w, visData(40), ctx);
  assert.ok(frame.every((v) => v !== 0x7f00ff00));
  let pipe = 0;
  for (const v of frame) if (v >>> 24 === 0xff) pipe++;
  assert.ok(pipe > 500, `pipe pixels ${pipe}`);
  assert.equal(frame[0], 0); // corner stays background
  // deterministic: a fresh instance fed the same input draws the same frame
  const st = bpInitialize();
  const again = new Int32Array(w * h);
  bpRender(st, again, w, h, w, visData(40));
  assert.deepEqual(again, frame);
  assert.equal(st.t1, BP_CONST.dt1);
});
