/**
 * Cthugha98 0.6a (Kevin "Zaph" Burfitt, Torps Productions, 1998): what its drawing functions
 * share, as the globals of the program held it. Ported from the executable by static analysis
 * (see SOURCE.md); postcardware, non-commercial use only, with credit. Never committed.
 *
 * Addresses are those of Cthugha98.exe 0.6a (the 2D build).
 */

/** The program's state that the flames, waves and displays read and write. */
export interface C98Host {
  /** buff (0x481F78): the buffer drawn into, `W × H` bytes, rows top to bottom. */
  b: Uint8Array;
  /** BUFF_WIDTH, BUFF_HEIGHT (0x448C3C, 0x448C40): the screen's size over the display's divisors. */
  W: number;
  H: number;
  /** The screen (0x448C48, 0x448C4C): 640 × 480. */
  readonly screenW: number;
  readonly screenH: number;
  /** The sound (0x47D130): 1024 stereo samples, unsigned 8-bit, [L0, R0, L1, R1, …]. */
  readonly stereo: Uint8Array;
  /** table[10][256] (0x47DDB8): the waves' colours. */
  readonly table: Int32Array;
  /** curtable (0x481F48): which of the ten. */
  curtable: number;
  /** sine[640] (0x4A32B8): trunc(sin(i × 0.03927) × 128). */
  readonly sine: Int32Array;
  /** The C runtime's rand() (MSVC: holdrand × 214013 + 2531011, bits 16–30). */
  rand(): number;
}

/** MSVC's rand()/srand(). */
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

/** sine[] as init_pete() (0x408E70) filled it. */
export function makeSine(): Int32Array {
  const sine = new Int32Array(640);
  for (let i = 0; i < 640; i += 1) sine[i] = Math.trunc(Math.sin(i * 0.03927) * 128);
  return sine;
}

/** table[10][256] as the start-up (0x405B7B) filled it. */
export function makeTable(): Int32Array {
  const table = new Int32Array(10 * 256);
  for (let j = 0; j < 10; j += 1) {
    for (let i = 0; i < 256; i += 1) {
      const d = Math.abs(128 - i);
      const values = [d * 2, 255 - d * 2, i, 255 - i, d + 127, 255 - d + 127, d + 127, d < 64 ? 255 : d * 4, d, 255 - d];
      table[j * 256 + i] = values[j]!;
    }
  }
  return table;
}
