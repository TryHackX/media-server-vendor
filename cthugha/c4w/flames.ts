/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; based on Cthugha by Kevin "Zaph" Burfitt and
 * Cthugha-L by Harald Deischinger; free for personal use (vis_sh.txt); never committed.
 *
 * The sixteen flames of Vis_sh.dll (records at 10022E18: function, flag, short and long name),
 * each translated from its machine code (10004400 … 10004A10).
 *
 * Render() swaps the two buffers just before the flame, so `cur` is the stale one and `other`
 * holds the last frame. A flame either writes `cur` from `other`, or swaps them back and works
 * on the last frame in place — which order it walks in then decides whether the flame climbs
 * one row a frame (top down: "Slow") or races up through what it has just written (bottom up:
 * "Fast"). Both buffers are (h + 2) rows (Init's malloc((h+2)·w)); R-Sl and Weird read one byte
 * past that, which the padding answers with 0.
 *
 * T4 (10046010): the mean of four neighbours less one, T4[i] = i ≥ 4 ? (i >> 2) − 1 : 0.
 * T2 (100C6838): the same for two, used by Zzz.
 */

export interface Buffers {
  readonly w: number;
  readonly h: number;
  /** 100CB534: what is drawn and shown this frame. */
  cur: Uint8Array;
  /** 100CAA38: the other one. */
  other: Uint8Array;
}

/** Bytes after the (h + 2) rows, for the reads one past the end. */
export const PAD = 8;

export const T4 = new Uint8Array(1024);
export const T2 = new Uint8Array(1024);
for (let i = 0; i < 1024; i += 1) {
  T4[i] = i & ~3 ? (i >> 2) - 1 : 0;
  T2[i] = i & ~1 ? (i >> 1) - 1 : 0;
}

export interface Flame {
  readonly name: string;
  readonly long: string;
  run(b: Buffers): void;
}

function swap(b: Buffers): void {
  const t = b.cur;
  b.cur = b.other;
  b.other = t;
}

/** Water and Water Subtle: the top half flames up, the bottom half down, out of place. */
function water(b: Buffers, wrap: boolean): void {
  const { w, h } = b;
  const out = b.cur;
  const L = b.other;
  const half = Math.trunc((w * h) / 2);
  const mask = wrap ? 255 : 1023;
  for (let k = 0, n = half + w; k < n; k += 1) {
    out[k] = T4[(L[k + 2 * w]! + L[k + w - 1]! + L[k + w]! + L[k + w + 1]!) & mask]!;
  }
  for (let o = w * h, n = half; n > 0; n -= 1, o -= 1) {
    out[o] = T4[(L[o - w + 1]! + L[o - 2 * w + 1]! + L[o - w]! + L[o - 2 * w]!) & mask]!;
  }
}

export const FLAMES: readonly Flame[] = [
  {
    name: "Clear",
    long: "Blank the buffer",
    // 10004420: only the w·h picture rows are cleared.
    run: (b) => b.cur.fill(0, 0, b.w * b.h)
  },
  {
    name: "Overwrite",
    long: "Write over buffer",
    run: swap
  },
  {
    name: "U-Sl",
    long: "Up Slow",
    // 10004450: a running sum of the three pixels below, plus the one two rows down.
    run: (b) => {
      swap(b);
      const { w, h } = b;
      const buf = b.cur;
      let p = w + 1;
      let sum = buf[p - 3]! + buf[p - 2]! + buf[p - 1]!;
      for (let n = w * h; n > 0; n -= 1) {
        sum += buf[p]! - buf[p - 3]!;
        buf[p - w - 1] = T4[buf[p + w - 1]! + sum]!;
        p += 1;
      }
    }
  },
  {
    name: "U-Fa",
    long: "Up Fast",
    run: (b) => {
      swap(b);
      const { w, h } = b;
      const buf = b.cur;
      for (let o = w * h; o > 0; o -= 1) buf[o] = T4[buf[o + w + 1]! + buf[o + w - 1]! + buf[o]! + buf[o + w]!]!;
    }
  },
  {
    name: "L-Sl",
    long: "Left Slow",
    run: (b) => {
      swap(b);
      const { w, h } = b;
      const buf = b.cur;
      for (let o = 0, n = w * h; o < n; o += 1) buf[o] = T4[buf[o + 2 * w]! + buf[o + 1]! + buf[o + w]! + buf[o + w + 1]!]!;
    }
  },
  {
    name: "L-Fa",
    long: "Left Fast",
    run: (b) => {
      swap(b);
      const { w, h } = b;
      const buf = b.cur;
      for (let o = w * h; o > 0; o -= 1) buf[o] = T4[2 * buf[o + w + 1]! + buf[o]! + buf[o + w]!]!;
    }
  },
  {
    name: "R-Sl",
    long: "Right Slow",
    // 10004610: out of place; out[0] keeps what the stale buffer had.
    run: (b) => {
      const { w, h } = b;
      const out = b.cur;
      const L = b.other;
      for (let o = 1, n = w * h; o <= n; o += 1) out[o] = T4[L[o - 1]! + L[o + 2 * w]! + L[o + w - 1]! + L[o + w]!]!;
    }
  },
  {
    name: "R-Fa",
    long: "Right Fast",
    run: (b) => {
      swap(b);
      const { w, h } = b;
      const buf = b.cur;
      for (let o = w * h; o > 0; o -= 1) buf[o] = T4[2 * buf[o + w - 1]! + buf[o]! + buf[o + w]!]!;
    }
  },
  { name: "Water", long: "Water", run: (b) => water(b, false) },
  { name: "Wa-s", long: "Water Subtle", run: (b) => water(b, true) },
  {
    name: "Skyline",
    long: "Skyline",
    run: (b) => {
      const { w, h } = b;
      const out = b.cur;
      const L = b.other;
      for (let k = 0, n = w * h; k < n; k += 1) out[k] = T4[L[k + w]! + 2 * L[k + w + 1]! + L[k + w + 2]!]!;
    }
  },
  {
    name: "Weird",
    long: "Weird",
    // 100048A0: the neighbours OR-ed, not added; out[0] keeps the stale byte.
    run: (b) => {
      const { w, h } = b;
      const out = b.cur;
      const L = b.other;
      for (let o = 1, n = w * h; o <= n; o += 1) out[o] = T4[L[o + 2 * w]! | L[o + w - 1]! | L[o + w]! | L[o + w + 1]!]!;
    }
  },
  {
    name: "Zzz",
    long: "Zzz",
    // 10004900: two neighbours summed in eight bits, through T2.
    run: (b) => {
      swap(b);
      const { w, h } = b;
      const buf = b.cur;
      for (let o = 0, n = w * h; o < n; o += 1) buf[o] = T2[(buf[o + 2 * w]! + buf[o + w - 1]!) & 255]!;
    }
  },
  {
    name: "Fade",
    long: "Fade away",
    // 10004960: dwords at byte offsets w·h down to 1, every byte −2 (not below 0) through two
    // 64K tables; stepping one byte at a time, each byte is taken four times (−8 a frame) —
    // fewer at the ends, and byte 0 never.
    run: (b) => {
      swap(b);
      const buf = b.cur;
      const n = b.w * b.h;
      for (let k = 1; k <= n + 3; k += 1) {
        const times = Math.min(k, 4, n + 4 - k);
        const v = buf[k]! - 2 * times;
        buf[k] = v > 0 ? v : 0;
      }
    }
  },
  {
    name: "Down",
    long: "Falling Down",
    run: (b) => {
      const { w, h } = b;
      const out = b.cur;
      out.fill(0, 0, w);
      out.set(b.other.subarray(0, (h - 1) * w), w);
    }
  },
  {
    name: "Test",
    long: "Test",
    // 10004A10: six neighbours over six, in place top down, no table.
    run: (b) => {
      swap(b);
      const { w, h } = b;
      const buf = b.cur;
      for (let p = w, end = w + w * h; p < end; p += 1) {
        buf[p] = Math.trunc((buf[p + w]! + buf[p - w]! + buf[p + 2]! + buf[p - 1]! + buf[p]! + buf[p + 1]!) / 6);
      }
    }
  }
];
