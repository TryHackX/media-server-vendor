import assert from "node:assert/strict";
import test from "node:test";

import { ape, normalise, parseConfig } from "./normalise.ts";

test("config: one int, enabled; shorter keeps the default on", () => {
  assert.deepEqual(parseConfig(new Uint8Array([1, 0, 0, 0])), { enabled: true });
  assert.deepEqual(parseConfig(new Uint8Array([0, 0, 0, 0])), { enabled: false });
  assert.deepEqual(parseConfig(new Uint8Array([])), { enabled: true });
});

test("the 16-bit stretch: max to 255, one above the float table where the binary is", () => {
  // min 0, max 100 over the frame: scale floor(65535/100) = 655; c = 9 → (9·655) >> 8 = 23
  const frame = new Int32Array([0x000000, 0x646464, 0x090909, 0x000000]);
  normalise(frame, 4);
  // 100 · 655 = 65500 → >> 8 = 255: the maximum always reaches white
  assert.equal(frame[1], 0xffffff);
  assert.equal(frame[2], 23 * 0x010101);
});

test("odd pixel count: the last pixel is not scanned, and out-of-range wraps in 16 bits", () => {
  const frame = new Int32Array([0x000000, 0x646464, 0x656565]);
  normalise(frame, 3);
  // max 100 from the first pair; 101 · 655 = 66155 → & 0xFFFF = 619 → >> 8 = 2
  assert.equal(frame[2], 2 * 0x010101);
});

test("a frame of one value turns black; the top byte is cleared", () => {
  const frame = new Int32Array([0x7f404040, 0x7f404040]);
  normalise(frame, 2);
  assert.deepEqual([...frame], [0, 0]);
  const effect = ape.create(new Uint8Array([1, 0, 0, 0]));
  const full = new Int32Array([0x11000000, 0x00ffffff]);
  assert.equal(effect.render({ w: 2, h: 1 }, full, new Int32Array(2)), 0);
  assert.equal(full[0], 0);
  assert.equal(full[1], 0xffffff);
});
