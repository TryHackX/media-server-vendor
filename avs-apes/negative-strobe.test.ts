import assert from "node:assert/strict";
import test from "node:test";

import { ape, invertInto, NEGATIVE_STROBE_DEFAULTS, parseNegativeStrobeConfig, strobeStep, type ApeContext } from "./negative-strobe.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

function ctxOf(w: number, h: number, isBeat = false): ApeContext {
  return {
    w, h, isBeat,
    visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: () => 0, makeRand: () => () => 0,
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer: () => null,
    now: () => 0
  };
}

/** Which of the first `frames` renders invert (1) or pass (0). */
function pattern(config: Uint8Array, frames: number, beats = false): string {
  const effect = ape.create(config);
  const fb = new Int32Array([0x00123456]);
  let out = "";
  for (let k = 0; k < frames; k += 1) {
    const fbout = new Int32Array(1);
    out += String(effect.render(ctxOf(1, 1, beats && k % 2 === 0), fb, fbout));
  }
  return out;
}

test("config: defaults, short configs and the one preset's (enabled, speed 16)", () => {
  assert.deepEqual(NEGATIVE_STROBE_DEFAULTS, { enabled: 1, speed: 1 });
  assert.deepEqual(parseNegativeStrobeConfig(new Uint8Array(0)), { enabled: 1, speed: 1 });
  assert.deepEqual(parseNegativeStrobeConfig(hex("000000")), { enabled: 1, speed: 1 });
  assert.deepEqual(parseNegativeStrobeConfig(hex("00000000")), { enabled: 0, speed: 1 });
  assert.deepEqual(parseNegativeStrobeConfig(hex("0100000010000000")), { enabled: 1, speed: 16 });
});

test("the counter: speed frames inverted out of every 2*speed + 1, the first cycle one short", () => {
  // speed 1: counter 1, 2, 0, 1, 2, 0 … inverts only at 0.
  assert.equal(pattern(hex("0100000001000000"), 9), "001001001");
  // speed 3: counter 1..6, then 0..6: inverts at 1, 2 (first cycle), then at 0, 1, 2 of every 7.
  assert.equal(pattern(hex("0100000003000000"), 14), "11000011100001");
  // The preset's speed 16: 15 on, 17 off, then 16 on, 17 off.
  const p = pattern(hex("0100000010000000"), 15 + 17 + 16 + 17);
  assert.equal(p, "1".repeat(15) + "0".repeat(17) + "1".repeat(16) + "0".repeat(17));
  // Beats change nothing.
  assert.equal(pattern(hex("0100000003000000"), 14, true), "11000011100001");
  assert.deepEqual(strobeStep(0, 16), { counter: 1, invert: true });
  assert.deepEqual(strobeStep(32, 16), { counter: 0, invert: true });
});

test("disabled: nothing drawn and the counter stands; speed 0 or less never inverts", () => {
  assert.equal(pattern(hex("0000000001000000"), 5), "00000");
  assert.equal(pattern(hex("0100000000000000"), 5), "00000");
  assert.equal(pattern(hex("01000000ffffffff"), 5), "00000");
});

test("every pixel's colour is flipped, the byte above it kept", () => {
  const fb = Int32Array.from([0x00000000, 0x00ffffff, 0x00123456, 0x7f000000 | 0x0000ff, -1]);
  const fbout = new Int32Array(fb.length);
  invertInto(fb, fbout, fb.length);
  assert.deepEqual(Array.from(fbout), [0x00ffffff, 0x00000000, 0x00edcba9, 0x7fffff00, -16777216]);
  // A render writes all of fbout and returns 1.
  const effect = ape.create(hex("0100000002000000"));
  const frame = new Int32Array(6).fill(0x00010203);
  const out = new Int32Array(6).fill(7);
  assert.equal(effect.render(ctxOf(3, 2), frame, out), 1);
  assert.deepEqual(Array.from(out), new Array(6).fill(0x00fefdfc));
});
