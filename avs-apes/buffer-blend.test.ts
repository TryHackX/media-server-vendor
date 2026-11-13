import assert from "node:assert/strict";
import test from "node:test";

import { ape, blendBuffers, parseBufferBlendConfig, BUFFER_BLEND_DEFAULTS, type ApeContext } from "./buffer-blend.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** A context whose getNbuffer logs (n, create) calls and keeps 8 buffers. */
function makeCtx(w: number, h: number) {
  const buffers: (Int32Array | null)[] = new Array(8).fill(null);
  const calls: [number, boolean][] = [];
  const ctx: ApeContext = {
    w, h, isBeat: false,
    visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: () => 0, makeRand: () => () => 0,
    registers: new Float64Array(100), lineBlendMode: 0,
    globalBuffer(index: number, create: boolean) {
      calls.push([index, create]);
      if (index < 0 || index > 7) return null;
      if (!buffers[index] && create) buffers[index] = new Int32Array(w * h);
      return buffers[index] ?? null;
    },
    now: () => 0
  };
  return { ctx, buffers, calls };
}

function u32(x: number): number { return x >>> 0; }

test("config parsing: defaults, partial lengths, and every config found in the presets", () => {
  assert.deepEqual(parseBufferBlendConfig(new Uint8Array(0)), BUFFER_BLEND_DEFAULTS);
  assert.deepEqual(BUFFER_BLEND_DEFAULTS, { enabled: 1, bufferB: 0, bufferA: 8, mode: 10 });
  // 3 bytes: nothing read; 4: enabled; 7: still only enabled; 12: three fields.
  assert.deepEqual(parseBufferBlendConfig(hex("000000")), BUFFER_BLEND_DEFAULTS);
  assert.deepEqual(parseBufferBlendConfig(hex("00000000")), { enabled: 0, bufferB: 0, bufferA: 8, mode: 10 });
  assert.deepEqual(parseBufferBlendConfig(hex("00000000030000")), { enabled: 0, bufferB: 0, bufferA: 8, mode: 10 });
  assert.deepEqual(parseBufferBlendConfig(hex("010000000300000005000000")), { enabled: 1, bufferB: 3, bufferA: 5, mode: 10 });
  // All 18 distinct 16-byte configs of the 31 instances in the collection (every one is 16 bytes).
  const seen: [string, number, number, number][] = [
    ["0100000000000000080000000a000000", 0, 8, 10],
    ["01000000000000000800000008000000", 0, 8, 8],
    ["01000000000000000800000000000000", 0, 8, 0],
    ["01000000000000000800000005000000", 0, 8, 5],
    ["0100000001000000080000000a000000", 1, 8, 10],
    ["01000000000000000800000004000000", 0, 8, 4],
    ["01000000000000000100000008000000", 0, 1, 8],
    ["0100000008000000010000000a000000", 8, 1, 10],
    ["0100000002000000000000000a000000", 2, 0, 10],
    ["01000000080000000200000002000000", 8, 2, 2],
    ["0100000002000000080000000a000000", 2, 8, 10],
    ["01000000010000000800000004000000", 1, 8, 4],
    ["01000000010000000800000001000000", 1, 8, 1],
    ["01000000000000000800000001000000", 0, 8, 1],
    ["01000000070000000000000004000000", 7, 0, 4],
    ["01000000000000000800000003000000", 0, 8, 3],
    ["01000000010000000800000003000000", 1, 8, 3],
    ["01000000000000000800000006000000", 0, 8, 6]
  ];
  for (const [h, bufferB, bufferA, mode] of seen) {
    assert.deepEqual(parseBufferBlendConfig(hex(h)), { enabled: 1, bufferB, bufferA, mode }, h);
  }
  // Trailing bytes beyond 16 are ignored; the parser works on a subarray view too.
  const padded = hex("ff0100000005000000020000000600000099");
  assert.deepEqual(parseBufferBlendConfig(padded.subarray(1, 17)), { enabled: 1, bufferB: 5, bufferA: 2, mode: 6 });
});

test("per-byte arithmetic of every mode on chosen pixels (all four bytes, top byte included)", () => {
  const A = [0x00ff8040, 0x7f0110c8, 0x12345678, 0x80808080];
  const B = [0x00408080, 0xff02f040, 0x87654321, 0x7f7f7f81];
  const run = (mode: number) => {
    const a = Int32Array.from(A), b = Int32Array.from(B);
    blendBuffers(mode, a, b, 4);
    assert.deepEqual(Array.from(b), B.map((x) => x | 0), "b is never written");
    return Array.from(a, u32);
  };
  assert.deepEqual(run(0), B.map(u32));
  // paddusb
  assert.deepEqual(run(1), [0x00ffffc0, 0xff03ffff, 0x99999999, 0xffffffff]);
  // psubusb + paddb = max per byte
  assert.deepEqual(run(2), [0x00ff8080, 0xff02f0c8, 0x87655678, 0x80808081]);
  // (a+b)>>1 from the 9-bit word sum: 0x7f+0xff = 0x17e -> 0xbf, where (a>>1)+(b>>1) would be 0xbe;
  // 0x80+0x81 -> 0x80 (0x40+0x40 also 0x80), 0x01+0x02 -> 0x01.
  assert.deepEqual(run(3), [0x009f8060, 0xbf018084, 0x4c4c4c4c, 0x7f7f7f80]);
  // a - b saturating
  assert.deepEqual(run(4), [0x00bf0000, 0x00000088, 0x00001357, 0x01010100]);
  // b - a saturating
  assert.deepEqual(run(5), [0x00000040, 0x8001e000, 0x75310000, 0x00000001]);
  // (a*b)>>8 per byte (pmullw low word, psrlw 8): 0xff*0x40 = 0x3fc0 -> 0x3f, 0x7f*0xff -> 0x7e
  assert.deepEqual(run(6), [0x003f4020, 0x7e000f32, 0x0914160f, 0x3f3f3f40]);
  // "adjustable" with its never-set x = 0: pmulhw(b, 0x100) = (b*256)>>16 = 0 -> cleared.
  assert.deepEqual(run(7), [0, 0, 0, 0]);
  assert.deepEqual(run(8), A.map((x, i) => u32(x ^ B[i]!)));
  // a - (a - b) saturating = min per byte
  assert.deepEqual(run(9), [0x00408040, 0x7f011040, 0x12344321, 0x7f7f7f80]);
  // (a - b) + (b - a), both saturating = |a - b| per byte
  assert.deepEqual(run(10), [0x00bf0040, 0x8001e088, 0x75311357, 0x01010101]);
  // Unknown modes leave a alone.
  assert.deepEqual(run(11), A.map(u32));
  assert.deepEqual(run(-1), A.map(u32));
});

test("8-byte modes skip the last pixel of an odd w*h, per-pixel modes (3, 6, 7) do not", () => {
  for (let mode = 0; mode <= 10; mode += 1) {
    const a = Int32Array.from([0x10203040, 0x11223344, 0x01020304]);
    const b = Int32Array.from([0x40302010, 0x44332211, 0x00302010]);
    blendBuffers(mode, a, b, 3);
    const lastTouched = mode === 3 || mode === 6 || mode === 7;
    assert.equal(a[2] !== 0x01020304, lastTouched, `mode ${mode}`);
  }
});

test("render: b is read, a is written in place, 8 is the frame, buffers fetched b first with allocation", () => {
  // Buffer 1 -> Current, mode 1 (add): the frame gets buffer 1 added.
  {
    const { ctx, buffers, calls } = makeCtx(2, 2);
    const effect = ape.create(hex("01000000000000000800000001000000"));
    buffers[0] = Int32Array.from([0x010101, 0x020202, 0xffffff, 0x000000]);
    const fb = Int32Array.from([0x101010, 0x202020, 0x010203, 0x7f7f7f]);
    const fbout = new Int32Array(4).fill(0x55);
    assert.equal(effect.render(ctx, fb, fbout), 0);
    assert.deepEqual(Array.from(fb), [0x111111, 0x222222, 0xffffff, 0x7f7f7f]);
    assert.deepEqual(Array.from(fbout), [0x55, 0x55, 0x55, 0x55], "fbout untouched");
    assert.deepEqual(calls, [[0, true]]);
  }
  // Current -> Buffer 2, |a-b| (a preset's config): buffer 2 = |buffer 2 - frame|; getNbuffer allocates
  // it zeroed on first use, so the first frame copies the frame into it.
  {
    const { ctx, buffers, calls } = makeCtx(2, 1);
    const effect = ape.create(hex("0100000008000000010000000a000000"));
    const fb = Int32Array.from([0x00ff00ff, 0x00123456]);
    effect.render(ctx, fb, new Int32Array(2));
    assert.deepEqual(Array.from(buffers[1]!), [0x00ff00ff, 0x00123456]);
    assert.deepEqual(Array.from(fb), [0x00ff00ff, 0x00123456], "the frame is only read");
    assert.deepEqual(calls, [[1, true]]);
  }
  // Two global buffers (preset config 07 -> 00, a-b): getNbuffer(7) then getNbuffer(0).
  {
    const { ctx, buffers, calls } = makeCtx(2, 1);
    const effect = ape.create(hex("01000000070000000000000004000000"));
    buffers[0] = Int32Array.from([0x00808080, 0x00102030]);
    buffers[7] = Int32Array.from([0x00010203, 0x00203040]);
    const fb = Int32Array.from([1, 2]);
    effect.render(ctx, fb, new Int32Array(2));
    assert.deepEqual(calls, [[7, true], [0, true]]);
    assert.deepEqual(Array.from(buffers[0]!), [0x007f7e7d, 0x00000000]);
    assert.deepEqual(Array.from(buffers[7]!), [0x00010203, 0x00203040]);
    assert.deepEqual(Array.from(fb), [1, 2]);
  }
  // Disabled: no buffer is touched or allocated.
  {
    const { ctx, calls } = makeCtx(2, 1);
    const effect = ape.create(hex("00000000000000000800000001000000"));
    const fb = Int32Array.from([5, 6]);
    assert.equal(effect.render(ctx, fb, new Int32Array(2)), 0);
    assert.deepEqual(calls, []);
    assert.deepEqual(Array.from(fb), [5, 6]);
  }
  // Defaults (empty config): Buffer 1 -> Current, |a-b|.
  {
    const { ctx, buffers, calls } = makeCtx(2, 1);
    const effect = ape.create(new Uint8Array(0));
    const fb = Int32Array.from([0x00102030, 0x00ffffff]);
    effect.render(ctx, fb, new Int32Array(2));
    assert.deepEqual(calls, [[0, true]]);
    assert.deepEqual(Array.from(buffers[0]!), [0, 0]);
    assert.deepEqual(Array.from(fb), [0x00102030, 0x00ffffff]);
  }
  // An out-of-range buffer index (no preset has one): the port does nothing instead of crashing.
  {
    const { ctx, calls } = makeCtx(2, 1);
    const effect = ape.create(hex("01000000090000000800000000000000"));
    const fb = Int32Array.from([5, 6]);
    assert.equal(effect.render(ctx, fb, new Int32Array(2)), 0);
    assert.deepEqual(calls, [[9, true]]);
    assert.deepEqual(Array.from(fb), [5, 6]);
  }
});
