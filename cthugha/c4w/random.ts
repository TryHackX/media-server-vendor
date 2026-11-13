/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; based on Cthugha by Kevin "Zaph" Burfitt and
 * Cthugha-L by Harald Deischinger; free for personal use (vis_sh.txt); never committed.
 *
 * The C runtime's rand() that Vis_sh.dll linked (MSVC 5 LIBCMT, 1000FF30): per thread,
 * holdrand × 214013 + 2531011, bits 16–30; a new thread starts from 1.
 */
export class MsRandom {
  private hold: number;

  constructor(seed = 1) {
    this.hold = seed >>> 0;
  }

  srand(seed: number): void {
    this.hold = seed >>> 0;
  }

  rand(): number {
    this.hold = (Math.imul(this.hold, 214013) + 2531011) >>> 0;
    return (this.hold >>> 16) & 0x7fff;
  }
}
