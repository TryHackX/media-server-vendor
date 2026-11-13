/**
 * Cthugha98 0.6a's flames (flamearray at 0x479110), translated from the executable.
 * Cthugha (c) 1993-1998 Kevin "Zaph" Burfitt, Torps Productions. Postcardware, non-commercial
 * use only, with credit. Never committed.
 *
 * Cthugha98 rewrote 5.3's assembler flames in C for any buffer size (BUFF_WIDTH × BUFF_HEIGHT):
 * each runs once over the buffer in place, a pixel at a time, and every one of them takes an
 * argument that doubles the step to three pixels; the program only ever passed 0 (its mode is 1,
 * the argument is `mode == 3`), so only that path is here. divsub[i] = i/4 − 1 (0 at least).
 * What C98 changed against 5.3: "Left Subtle" and "Right Subtle" are the same as their "Slow"
 * flames (the sums no longer wrap at 256); "Up Subtle" wraps only its three-pixel running sum
 * and runs one pixel more; "Water Subtle" is "Water", whose falling half now uses divsub as well;
 * "Skyline" takes divsub (not (sum − 1)/4) and keeps the buffer's top-left; "Weird" halves the
 * ORed neighbours instead of taking one off and clears no rows.
 * A flame reads at most one byte past W × H; the buffers are as large as the screen, so it reads
 * what an earlier, larger display left there, as the program did.
 */

import type { C98Host } from "./host";

/** divsub[1024] (init_pete, 0x408E70). */
const DIV = new Uint8Array(1024);
for (let i = 0; i < 1024; i += 1) DIV[i] = i >> 2 ? (i >> 2) - 1 : 0;

/** The two bottom rows less one pixel, cleared before most flames run (step 1). */
function clearBottom(b: Uint8Array, W: number, H: number, rows: number): void {
  const from = W * H - rows * W - 1;
  b.fill(0, Math.max(0, from), from + rows * W);
}

/** Slow Left (0x40AE02) and Left Subtle (0x40AF79): up and to the left. */
function slowLeft(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  for (let n = W * H - 2 * W, d = 0; n !== 0; n -= 1, d += 1) {
    b[d] = DIV[b[d + 1]! + b[d + W]! + b[d + W + 1]! + b[d + 2 * W]!]!;
  }
}

/** Left Fast (0x40B0E9): from the bottom up, the pixel below and to the right counted twice. */
function leftFast(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  for (let n = W * H - 2 * W, p = W * H - 2 * W; n !== 0; n -= 1, p -= 1) {
    b[p] = DIV[b[p]! + b[p + W + 1]! + b[p + W + 1]! + b[p + W]!]!;
  }
}

/** Up Slow (0x40A82E): a running sum of the three pixels below, plus the one under the middle. */
function upSlow(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  let src = W + 1;
  let dst = 0;
  let sum = b[src - 3]! + b[src - 2]! + b[src - 1]!;
  for (let n = W * H - 2 * W; n > 0; n -= 1) {
    sum = sum - b[src - 3]! + b[src]!;
    b[dst] = DIV[sum + b[src + W - 1]!]!;
    src += 1;
    dst += 1;
  }
}

/** Up Subtle (0x40AA40): the running sum kept in a byte, and one pixel more. */
function upSubtle(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  let src = W + 1;
  let dst = 0;
  let sum = (b[src - 3]! + b[src - 2]! + b[src - 1]!) & 255;
  for (let n = W * H - 2 * W; n >= 0; n -= 1) {
    sum = (sum - b[src - 3]! + b[src]!) & 255;
    b[dst] = DIV[sum + b[src + W - 1]!]!;
    src += 1;
    dst += 1;
  }
}

/** Up Fast (0x40AC7C): from the bottom up, itself and the three (new) pixels below. */
function upFast(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  for (let n = W * H - 2 * W, p = W * H - 2 * W; n > 0; n -= 1, p -= 1) {
    b[p] = DIV[b[p]! + b[p + W - 1]! + b[p + W + 1]! + b[p + W]!]!;
  }
}

/** Right Slow (0x40B272) and Right Subtle (0x40B3FA): the new left neighbour, two below, and down. */
function rightSlow(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  for (let n = W * H - 2 * W - 1, d = 1; n !== 0; n -= 1, d += 1) {
    b[d] = DIV[b[d - 1]! + b[d + W]! + b[d + W - 1]! + b[d + 2 * W]!]!;
  }
}

/** Right Fast (0x40B591): from the bottom up, the pixel below and to the left counted twice. */
function rightFast(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  for (let n = W * H - 2 * W, p = W * H - 2 * W; n !== 0; n -= 1, p -= 1) {
    b[p] = DIV[b[p]! + b[p + W - 1]! + b[p + W - 1]! + b[p + W]!]!;
  }
}

/** Water (0x40B716) and Water Subtle (0x40B8D1): the top half and a row rise, then the bottom half falls. */
function water(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 1);
  const half = Math.trunc((W * H) / 2);
  for (let n = half + W, src = W, dst = 0; n !== 0; n -= 1, src += 1, dst += 1) {
    b[dst] = DIV[b[src - 1]! + b[src]! + b[src + 1]! + b[src + W]!]!;
  }
  for (let n = half, src = (H - 2) * W, dst = (H - 1) * W; n !== 0; n -= 1, src -= 1, dst -= 1) {
    b[dst] = DIV[b[src - W + 1]! + b[src]! + b[src + 1]! + b[src - W]!]!;
  }
}

/** Skyline (0x40BA8C): the pixel below and to the right counted twice with its neighbours. */
function skyline(h: C98Host): void {
  const { b, W, H } = h;
  clearBottom(b, W, H, 2);
  for (let n = W * H - 2 * W, src = W + 1, dst = 0; n !== 0; n -= 1, src += 1, dst += 1) {
    b[dst] = DIV[b[src - 1]! + 2 * b[src]! + b[src + 1]!]!;
  }
}

/** Weird (0x40BBA4): the neighbours and the pixel below ORed, halved; no rows cleared. */
function weird(h: C98Host): void {
  const { b, W, H } = h;
  for (let n = W * H - 2 * W, src = W + 1, dst = 1; n !== 0; n -= 1, src += 1, dst += 1) {
    b[dst] = ((b[src - 1]! | b[src]! | b[src + 1]! | b[src + W]!) & 255) >> 1;
  }
}

/** flamearray[] in its order, with its names; all of them are chosen at random (`when` 255). */
export const FLAMES: readonly { name: string; when: number; run(h: C98Host): void }[] = [
  { name: "Slow Left", when: 255, run: slowLeft },
  { name: "Left Subtle", when: 255, run: slowLeft },
  { name: "Left Fast", when: 255, run: leftFast },
  { name: "Up Slow", when: 255, run: upSlow },
  { name: "Up Subtle", when: 255, run: upSubtle },
  { name: "Up Fast", when: 255, run: upFast },
  { name: "Right Slow", when: 255, run: rightSlow },
  { name: "Right Subtle", when: 255, run: rightSlow },
  { name: "Right Fast", when: 255, run: rightFast },
  { name: "Water", when: 255, run: water },
  { name: "Water Subtle", when: 255, run: water },
  { name: "Skyline", when: 255, run: skyline },
  { name: "Weird", when: 255, run: weird }
];
