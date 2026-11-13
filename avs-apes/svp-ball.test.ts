import assert from "node:assert/strict";
import test from "node:test";

import {
  BALL_BAND_STARTS, BALL_SIN_TABLE, ballBands, ballCircle, ballDraw, ballInitialState, ballLerp, ballRender, sinDeg, svp,
  type ApeContext, type BallLight, type SvpVisData
} from "./svp-ball.ts";

const ctx = {} as ApeContext;

function visData(spectrum = 0): SvpVisData {
  return {
    millSec: 0,
    waveform: [new Uint8Array(512), new Uint8Array(512)],
    spectrum: [new Uint8Array(256).fill(spectrum), new Uint8Array(256).fill(spectrum)]
  };
}

test("ball: integer-degree sine switch (constants copied bit-exactly)", () => {
  assert.equal(BALL_SIN_TABLE.length, 91);
  assert.equal(sinDeg(0), 0);
  assert.equal(sinDeg(30), 0.5);
  assert.equal(sinDeg(90), 1);
  assert.equal(sinDeg(180), 0);
  assert.equal(sinDeg(270), -1);
  assert.equal(sinDeg(-90), -1);
  assert.equal(sinDeg(450), 1);
  assert.equal(sinDeg(-1), -0.01745240643728351);
  assert.equal(sinDeg(181), -0.01745240643728351);
  assert.equal(sinDeg(15), 0.25881904510252074);
  assert.equal(sinDeg(-449), sinDeg(271));
  // the binary's constant for 5 degrees is one ulp above the correctly rounded sine
  assert.equal(sinDeg(5), 0.08715574274765818);
  assert.notEqual(sinDeg(5), Math.sin((5 * Math.PI) / 180));
});

test("ball: spectrum bands at ln(i) >= k, 2k, ... with k = ln(255) / 6 (0x10003250)", () => {
  // re-run the binary's loop: T starts at k, a new bin begins when T <= ln(i), then T += k
  const k = 5.541263545158426 / 6;
  let t = k;
  const starts = [1];
  for (let i = 1; i < 255; i++) {
    if (!(t > Math.log(i))) { starts.push(i); t += k; }
  }
  assert.deepEqual(starts, BALL_BAND_STARTS.slice(0, 6));
  const spectrum = new Uint8Array(256).map((_, i) => i & 255);
  const bands = ballBands(spectrum);
  assert.deepEqual([...bands], [1 + 2, 3 + 4 + 5 + 6, 99, 700, 4331, 27234]);
});

test("ball: colour blend with integer division per byte and carries", () => {
  assert.equal(ballLerp(0xff0000, 0xffff00, 360, 30), 0xff1500);
  assert.equal(ballLerp(0xff0000, 0xffff00, 360, 0), 0xff0000);
  assert.equal(ballLerp(0xff0000, 0xffff00, 360, 538), 0x01007d00);
  assert.equal(ballLerp(0x0000ff, 0x00ff00, 360, 538), 0x00017c82);
  assert.equal(ballLerp(0x01007d00, 0xff0000, 360, 30), 0x157200);
});

test("ball: circle positions and sizes", () => {
  assert.deepEqual(ballCircle(0, 100, 640, 480), [220, 240]);
  assert.deepEqual(ballCircle(90, 100, 640, 480), [320, 340]);
  assert.deepEqual(ballCircle(-30, 24, 320, 240), [139, 108]);
});

test("ball: shading of the first sphere (silence, 320 x 240, first frame)", () => {
  const w = 320;
  const h = 240;
  const frame = new Int32Array(w * h).fill(0x123456);
  svp.create().render(frame, w, h, w, visData(0), ctx);
  // band 0 / channel 0: radius 24 -> size 6, at (136, 120) swayed by +320/3 -> (29, 120); colour 0xFF1500
  assert.equal(frame[120 * w + 29], 0xc61000);
  assert.equal(frame[118 * w + 27], 0x7c0a00);
  assert.equal(frame[122 * w + 31], 0xf11300);
  assert.equal(frame[120 * w + 33], 0xffb876); // highlight
  assert.equal(frame[115 * w + 29], 0x890b00);
  assert.equal(frame[120 * w + 23], 0x123456); // dx = 6: outside (d^2 < r^2 only)
  assert.equal(frame[120 * w + 35], 0x123456);
  assert.equal(frame[0], 0x123456);
});

test("ball: a sphere never touches column 0 or row 0; NaN highlight test as the x87 does", () => {
  const w = 16;
  const h = 12;
  const light: BallLight = { lx: 8, ly: 6, lz: 5, vx: 8, vy: 6, vz: 4 };
  const frame = new Int32Array(w * h).fill(-1);
  ballDraw(frame, 2, 2, 5, 0x808080, w, h, w, light);
  for (let x = 0; x < w; x++) assert.equal(frame[x], -1);
  for (let y = 0; y < h; y++) assert.equal(frame[y * w], -1);
  assert.notEqual(frame[1 * w + 1], -1);
  // sphere centred under the viewer: V = 0 at its top -> 0/0 -> no highlight, plain diffuse colour
  const f2 = new Int32Array(320 * 240);
  ballDraw(f2, 160, 120, 40, 0x808080, 320, 240, 320, { lx: 160, ly: 120, lz: 106, vx: 160, vy: 120, vz: 80 });
  assert.equal(f2[120 * 320 + 160], 0x8e8e8e);
  assert.equal(f2[110 * 320 + 150], 0x6e6e6e);
  assert.equal(f2[125 * 320 + 140], 0x555555);
});

test("ball: phase advances 2 per call; at 360 the colour pairs move on", () => {
  const state = ballInitialState();
  const frame = new Int32Array(64 * 48);
  for (let i = 0; i < 179; i++) ballRender(state, frame, 64, 48, 64, visData(3));
  assert.equal(state.phase, 358);
  assert.equal(state.c58, 0xff0000);
  ballRender(state, frame, 64, 48, 64, visData(3));
  assert.equal(state.phase, 0);
  assert.equal(state.c1c, 0xff0000);
  assert.equal(state.c18, 0x0000ff);
  assert.equal(state.c58, 0x01007d00);
  assert.equal(state.c54, 0x00017c82);
});

test("ball: two effects share the DLL's state (one phase, advanced by every Render call); a load resets it", () => {
  const w = 96;
  const h = 72;
  const first = svp.create();
  const second = svp.create();
  const a = new Int32Array(w * h);
  const b = new Int32Array(w * h);
  first.render(a, w, h, w, visData(0), ctx); // phase 0
  second.render(b, w, h, w, visData(0), ctx); // phase 2
  const ref0 = new Int32Array(w * h);
  const ref2 = new Int32Array(w * h);
  const s = ballInitialState();
  ballRender(s, ref0, w, h, w, visData(0));
  ballRender(s, ref2, w, h, w, visData(0));
  assert.deepEqual(a, ref0);
  assert.deepEqual(b, ref2);
  assert.notDeepEqual(a, b);
  // a new load (OpenSettings + Initialize) resets the shared phase for everyone
  svp.create();
  const c = new Int32Array(w * h);
  first.render(c, w, h, w, visData(0), ctx);
  assert.deepEqual(c, ref0);
});
