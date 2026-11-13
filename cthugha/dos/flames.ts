/**
 * Cthugha 5.3's flames (FLAMES.C), translated from their x86 assembler instruction by
 * instruction. Cthugha (c) 1993-1995 Kevin "Zaph" Burfitt, Torps Productions. Non-commercial
 * use only, with credit (COPYING-cthugha-53.txt).
 *
 * Every flame runs in place over the one 320 × 204 buffer (buff, segment offset 0), as the
 * 16-bit code did:
 * - two pixels a turn of the loop, their bytes kept in DL and DH and stored together as one
 *   word after both are worked out: a flame that reads its left neighbour sees the first pixel
 *   of a pair already new and the second still old;
 * - the loop counts as written, including those whose body decrements CX as well as LOOP does
 *   (half as many turns as the count);
 * - sums in AX (or only in AL: the "subtle" flames, whose sums wrap at 256), DIVSUB as
 *   init_pete() built it, and the shifts, ORs and zero tests of the code.
 */

/** The buffer the flames work on: 64 KB, as the segment. */
export const SEGMENT = 65536;
export const WIDTH = 320;

/** divsub[i] = i/4 − 1, 0 at least (init_pete). */
const DIVSUB = new Uint8Array(1024);
for (let i = 0; i < 1024; i += 1) DIVSUB[i] = i >> 2 ? (i >> 2) - 1 : 0;

/** Up Slow: each pixel from itself, its neighbours and the one below, into the row above. */
function upSlow(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    const dl = DIVSUB[b[di - 1]! + b[di]! + b[di + 1]! + b[di + WIDTH]!]!;
    di += 1;
    const dh = DIVSUB[b[di - 1]! + b[di]! + b[di + 1]! + b[di + WIDTH]!]!;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
  }
}

/** Up Subtle: the same, added in AL. */
function upSubtle(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    const dl = DIVSUB[(b[di - 1]! + b[di]! + b[di + 1]! + b[di + WIDTH]!) & 255]!;
    di += 1;
    const dh = DIVSUB[(b[di - 1]! + b[di]! + b[di + 1]! + b[di + WIDTH]!) & 255]!;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
  }
}

/** Slow Left: from the pixel up and to the right, itself, its right neighbour and below. */
function leftSlow(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    const dl = DIVSUB[b[di - (WIDTH - 1)]! + b[di]! + b[di + 1]! + b[di + WIDTH]!]!;
    di += 1;
    const dh = DIVSUB[b[di - (WIDTH - 1)]! + b[di]! + b[di + 1]! + b[di + WIDTH]!]!;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
  }
}

/** Left Subtle: the same, added in AL. */
function leftSubtle(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    const dl = DIVSUB[(b[di - (WIDTH - 1)]! + b[di]! + b[di + 1]! + b[di + WIDTH]!) & 255]!;
    di += 1;
    const dh = DIVSUB[(b[di - (WIDTH - 1)]! + b[di]! + b[di + 1]! + b[di + WIDTH]!) & 255]!;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
  }
}

/** Right Slow: from up-left, itself, its left neighbour (new for the first of a pair) and below. */
function rightSlow(b: Uint8Array): void {
  let di = WIDTH + 1;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    const dl = DIVSUB[b[di - (WIDTH + 1)]! + b[di]! + b[di - 1]! + b[di + WIDTH]!]!;
    di += 1;
    const dh = DIVSUB[b[di - (WIDTH + 1)]! + b[di]! + b[di - 1]! + b[di + WIDTH]!]!;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
  }
}

/** Right Subtle: the same in AL; CX counts both pixels (64636 → 32318 turns). */
function rightSubtle(b: Uint8Array): void {
  let di = WIDTH + 1;
  for (let cx = 64636; cx !== 0;) {
    const dl = DIVSUB[(b[di - (WIDTH + 1)]! + b[di]! + b[di - 1]! + b[di + WIDTH]!) & 255]!;
    di += 1;
    cx -= 1;
    const dh = DIVSUB[(b[di - (WIDTH + 1)]! + b[di]! + b[di - 1]! + b[di + WIDTH]!) & 255]!;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
    cx -= 1;
  }
}

/** Water: the top half rises as Up Slow does; then the bottom half falls, a quarter without −1. */
function water(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318 + WIDTH; cx !== 0;) {
    const dl = DIVSUB[b[di - 1]! + b[di]! + b[di + 1]! + b[di + WIDTH]!]!;
    di += 1;
    cx -= 1;
    const dh = DIVSUB[b[di - 1]! + b[di]! + b[di + 1]! + b[di + WIDTH]!]!;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
    cx -= 1;
  }
  di = 64320 - 1;
  for (let cx = 32318; cx !== 0;) {
    const dh = (b[di - (WIDTH - 1)]! + b[di]! + b[di + 1]! + b[di - WIDTH]!) >> 2;
    di -= 1;
    cx -= 1;
    const dl = (b[di - (WIDTH - 1)]! + b[di]! + b[di + 1]! + b[di - WIDTH]!) >> 2;
    b[di + WIDTH] = dl;
    b[di + WIDTH + 1] = dh;
    di -= 1;
    cx -= 1;
  }
}

/** Water Subtle: a byte at a time, added in AL; the top half a quarter less one, the bottom a quarter. */
function waterSubtle(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318 + WIDTH; cx !== 0; cx -= 1) {
    let al = ((b[di - 1]! + b[di]! + b[di + 1]! + b[di + WIDTH]!) & 255) >> 2;
    if (al !== 0) al -= 1;
    b[di - WIDTH] = al;
    di += 1;
  }
  di = 64636;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    b[di + WIDTH] = ((b[di - (WIDTH - 1)]! + b[di]! + b[di + 1]! + b[di - WIDTH]!) & 255) >> 2;
    di -= 1;
  }
}

/** Skyline: the pixel counted twice with its neighbours; (sum − 1) / 4, 0 stays 0. */
function skyline(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    let ax = b[di - 1]! + b[di]! + b[di + 1]! + b[di]!;
    const dl = ax === 0 ? 0 : (ax - 1) >> 2;
    di += 1;
    ax = b[di - 1]! + b[di]! + b[di + 1]! + b[di]!;
    const dh = ax === 0 ? 0 : (ax - 1) >> 2;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
  }
}

/** Up Fast: downwards through the buffer, each pixel from itself and the (new) row below. */
function upFast(b: Uint8Array): void {
  let di = 64000 + WIDTH - 1;
  for (let cx = 64000 + WIDTH; cx !== 0;) {
    const dh = DIVSUB[b[di]! + b[di + WIDTH - 1]! + b[di + WIDTH + 1]! + b[di + WIDTH]!]!;
    di -= 1;
    cx -= 1;
    const dl = DIVSUB[b[di]! + b[di + WIDTH - 1]! + b[di + WIDTH + 1]! + b[di + WIDTH]!]!;
    b[di] = dl;
    b[di + 1] = dh;
    di -= 1;
    cx -= 1;
  }
}

/** Left Fast: the pixel below and to the right counted twice. */
function leftFast(b: Uint8Array): void {
  let di = 64000 + WIDTH;
  for (let cx = 64000 + WIDTH; cx !== 0;) {
    const dh = DIVSUB[b[di]! + b[di + WIDTH + 1]! + b[di + WIDTH + 1]! + b[di + WIDTH]!]!;
    di -= 1;
    cx -= 1;
    const dl = DIVSUB[b[di]! + b[di + WIDTH + 1]! + b[di + WIDTH + 1]! + b[di + WIDTH]!]!;
    b[di] = dl;
    b[di + 1] = dh;
    di -= 1;
    cx -= 1;
  }
}

/** Right Fast: the pixel below and to the left counted twice. */
function rightFast(b: Uint8Array): void {
  let di = 64000 + WIDTH;
  for (let cx = 64000 + WIDTH; cx !== 0;) {
    const dh = DIVSUB[b[di]! + b[di + WIDTH - 1]! + b[di + WIDTH - 1]! + b[di + WIDTH]!]!;
    di -= 1;
    cx -= 1;
    const dl = DIVSUB[b[di]! + b[di + WIDTH - 1]! + b[di + WIDTH - 1]! + b[di + WIDTH]!]!;
    b[di] = dl;
    b[di + 1] = dh;
    di -= 1;
    cx -= 1;
  }
}

/** Weird: the neighbours ORed, less one (no division). */
function weird(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    let al = b[di]! | b[di - 1]! | b[di + 1]! | b[di + WIDTH]!;
    const dl = al === 0 ? 0 : al - 1;
    di += 1;
    al = b[di]! | b[di - 1]! | b[di + 1]! | b[di + WIDTH]!;
    const dh = al === 0 ? 0 : al - 1;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
  }
}

/** Fade: every byte from the second row on two less, 0 at least. */
function fade(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 32318; cx !== 0; cx -= 1) {
    const al = b[di]!;
    const ah = b[di + 1]!;
    b[di] = al > 2 ? al - 2 : 0;
    b[di + 1] = ah > 2 ? ah - 2 : 0;
    di += 2;
  }
}

/** Zzz: the left neighbour and the pixel below, added in AL, halved, less one. */
function zzz(b: Uint8Array): void {
  let di = WIDTH;
  for (let cx = 64636; cx !== 0;) {
    let al = ((b[di - 1]! + b[di + WIDTH]!) & 255) >> 1;
    const dl = al === 0 ? 0 : al - 1;
    di += 1;
    cx -= 1;
    al = ((b[di - 1]! + b[di + WIDTH]!) & 255) >> 1;
    const dh = al === 0 ? 0 : al - 1;
    b[di - WIDTH - 1] = dl;
    b[di - WIDTH] = dh;
    di += 1;
    cx -= 1;
  }
}

/** flamearray[], in its order and with its names. */
export const FLAMES: readonly { name: string; run(b: Uint8Array): void }[] = [
  { name: "Slow Left", run: leftSlow },
  { name: "Left Subtle", run: leftSubtle },
  { name: "Left Fast", run: leftFast },
  { name: "Up Slow", run: upSlow },
  { name: "Up Subtle", run: upSubtle },
  { name: "Up Fast", run: upFast },
  { name: "Right Slow", run: rightSlow },
  { name: "Right Subtle", run: rightSubtle },
  { name: "Right Fast", run: rightFast },
  { name: "Water", run: water },
  { name: "Water Subtle", run: waterSubtle },
  { name: "Skyline", run: skyline },
  { name: "Weird", run: weird },
  { name: "Zzz", run: zzz },
  { name: "Fade", run: fade }
];
