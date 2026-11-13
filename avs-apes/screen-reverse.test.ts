import assert from "node:assert/strict";
import test from "node:test";

import { ape, parseScreenReverseConfig, reverseInto, SCREEN_REVERSE_DEFAULTS, type ApeContext } from "./screen-reverse.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

function ctxOf(w: number, h: number, isBeat: boolean): ApeContext {
  return {
    w, h, isBeat,
    visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: () => 0, makeRand: () => () => 0,
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null,
    now: () => 0
  };
}

/** A w x h frame whose pixel value encodes its (x, y): 0x00YYXX. */
function frame(w: number, h: number): Int32Array {
  const f = new Int32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) f[y * w + x] = (y << 8) | x;
  return f;
}

test("config parsing: defaults, short configs and the presets' configs", () => {
  assert.deepEqual(parseScreenReverseConfig(new Uint8Array(0)), SCREEN_REVERSE_DEFAULTS);
  assert.deepEqual(SCREEN_REVERSE_DEFAULTS, { horizontal: 1, vertical: 1, onBeat: 0 });
  assert.deepEqual(parseScreenReverseConfig(hex("00000000")), { horizontal: 0, vertical: 1, onBeat: 0 });
  assert.deepEqual(parseScreenReverseConfig(hex("0000000000000000010000")), { horizontal: 0, vertical: 0, onBeat: 0 });
  // The four instances in the collection: 2 x vertical, 1 x both, 1 x vertical on beat.
  assert.deepEqual(parseScreenReverseConfig(hex("000000000100000000000000")), { horizontal: 0, vertical: 1, onBeat: 0 });
  assert.deepEqual(parseScreenReverseConfig(hex("010000000100000000000000")), { horizontal: 1, vertical: 1, onBeat: 0 });
  assert.deepEqual(parseScreenReverseConfig(hex("000000000100000001000000")), { horizontal: 0, vertical: 1, onBeat: 1 });
});

test("pixel mapping on odd sizes: centre column/row stay, every fbout pixel is written", () => {
  const w = 5, h = 3;
  const fb = frame(w, h);
  const at = (f: Int32Array, x: number, y: number) => f[y * w + x]!;
  const out = new Int32Array(w * h).fill(-1);
  reverseInto(fb, out, w, h, true, false);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) assert.equal(at(out, x, y), (y << 8) | (w - 1 - x));
  assert.equal(at(out, 2, 1), (1 << 8) | 2, "centre column keeps its pixels");
  out.fill(-1);
  reverseInto(fb, out, w, h, false, true);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) assert.equal(at(out, x, y), ((h - 1 - y) << 8) | x);
  assert.deepEqual(Array.from(out.subarray(w, 2 * w)), Array.from(fb.subarray(w, 2 * w)), "centre row unchanged");
  out.fill(-1);
  reverseInto(fb, out, w, h, true, true);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) assert.equal(at(out, x, y), ((h - 1 - y) << 8) | (w - 1 - x));
  assert.equal(at(out, 2, 1), (1 << 8) | 2, "the centre pixel of an odd frame stays");
  assert.ok(!out.includes(-1));
});

test("render: returns 1 with the result in fbout; framebuffer untouched", () => {
  const fb = frame(4, 2);
  const before = Array.from(fb);
  const out = new Int32Array(8);
  const e = ape.create(hex("000000000100000000000000"));
  assert.equal(e.render(ctxOf(4, 2, false), fb, out), 1);
  assert.deepEqual(Array.from(out), [0x100, 0x101, 0x102, 0x103, 0, 1, 2, 3]);
  assert.deepEqual(Array.from(fb), before);
  // Both flags off: nothing, return 0.
  const none = ape.create(hex("000000000000000000000000"));
  const out2 = new Int32Array(8).fill(7);
  assert.equal(none.render(ctxOf(4, 2, true), fb, out2), 0);
  assert.deepEqual(Array.from(out2), new Array(8).fill(7));
});

test("on beat: off until the first beat, then toggled on every beat", () => {
  const e = ape.create(hex("000000000100000001000000"));
  const fb = frame(2, 2), out = new Int32Array(4);
  const seq = [false, false, true, false, false, true, false, true, true];
  const got = seq.map((beat) => e.render(ctxOf(2, 2, beat), fb, out));
  assert.deepEqual(got, [0, 0, 1, 1, 1, 0, 0, 1, 0]);
  // Without "on beat" a beat changes nothing.
  const always = ape.create(hex("010000000100000000000000"));
  assert.deepEqual(seq.map((beat) => always.render(ctxOf(2, 2, beat), fb, out)), new Array(seq.length).fill(1));
  // The toggle also runs while both flips are off (not observable, but the state carries on).
  const idle = ape.create(hex("000000000000000001000000"));
  assert.equal(idle.render(ctxOf(2, 2, true), fb, out), 0);
});
