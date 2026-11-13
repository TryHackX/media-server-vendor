/**
 * Cthugha-L 1.4, ported to TypeScript for "Klasyka retro" (the player's retro visualizer).
 *
 * Cthugha - Audio Seeded Image Processing: Kevin "Zaph" Burfitt, Torps Productions 1993-1995.
 * Cthugha-L: Copyright 1995-97 Harald Deischinger. Ported from the C source of Cthugha-L 1.4
 * under its licence (COPYING-cthugha-L.txt): free for non-commercial use, with credit to
 * Cthugha, Torps Productions and Harald Deischinger. Not for commercial use without permission.
 *
 * context.ts: what the C source kept in globals — the two image buffers with their three-line
 * borders (CthughaBuffer.cc), the sound data (SoundDevice.h) and its analysis (SoundAnalyze.cc),
 * the colour tables (sound_tables.cc), the sine tables (imath.cc) and rand().
 */

/** C's rand(): 0 … 2^31 − 1, here a seeded xorshift so a scene runs the same every time. */
export class CRandom {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x2545f491;
  }

  rand(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state >>> 1;
  }

  /** imath.cc's Random(range): 0 … range − 1, or 0. */
  random(range: number): number {
    return range > 0 ? this.rand() % range : 0;
  }
}

/**
 * The sound of one frame as SoundDevice held it: char2 data[1024], stereo, signed 8-bit, where
 * [i][0] is the second sample of a frame read (the right channel) and [i][1] the first (left) —
 * flat here: data[2i] and data[2i + 1]. `proc` is dataProc, after the sound process.
 */
export class SoundData {
  readonly data = new Int8Array(2048);
  readonly proc = new Int8Array(2048);
}

/** SoundAnalyze: what Cthugha-L made of the sound of a frame (SoundAnalyze.cc). */
export class SoundAnalysis {
  amplitude = 0;
  /** RMS of data[i][0] and of data[i][1] (the names are the C source's). */
  amplitudeLeft = 0;
  amplitudeRight = 0;
  noisy = false;
  attackLevel = 0;
  fire = 0;
  fireLevel = 0;
  intensity = 0;
  lastAmplitude = 0;

  /** SoundAnalyze::operator()(). */
  run(sound: SoundData, minNoise: number): void {
    const d = sound.data;
    let al = 0;
    let ar = 0;
    for (let i = 0; i < 2048; i += 2) {
      al += d[i]! * d[i]!;
      ar += d[i + 1]! * d[i + 1]!;
    }
    al = Math.trunc(Math.sqrt(al / 1024));
    ar = Math.trunc(Math.sqrt(ar / 1024));
    let amplitude = Math.trunc((al + ar) / 2);
    this.amplitudeLeft = al;
    this.amplitudeRight = ar;
    const last = this.lastAmplitude;
    // Ignore such a small decrease.
    if (amplitude < last - 9) amplitude = last - 9;
    if (amplitude > last) this.attackLevel += amplitude - last;
    // If the attack is finally over, then fire at the intensity of the attack.
    if (amplitude < last) {
      this.fire = this.attackLevel;
      this.attackLevel = 0;
    } else {
      this.fire = 0;
    }
    this.fireLevel += this.fire;
    this.amplitude = amplitude;
    this.lastAmplitude = amplitude;
    this.noisy = al >= minNoise || ar >= minNoise;
    this.intensity = this.intensity * 0.95 + (amplitude / 128) * 0.05;
  }
}

/** The palette of a frame: 256 RGB triples, 0–255. */
export type Palette = Uint8Array;

/**
 * The buffers: BUFF_WIDTH × BUFF_HEIGHT bytes with three lines of border above and below, which
 * the flames read and the border option fills (CthughaBuffer::init). `active` is the buffer
 * being drawn, `passive` the one on screen; pixel (x, y) is at BASE + y × W + x. The screen
 * (CthughaDisplay's buffer) is 2W × 2H palette indices.
 */
export class Context {
  readonly W: number;
  readonly H: number;
  readonly SIZE: number;
  readonly BASE: number;
  readonly LENGTH: number;
  active: Uint8Array;
  passive: Uint8Array;
  readonly screen: Uint8Array;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly sound = new SoundData();
  readonly analysis = new SoundAnalysis();
  readonly random: CRandom;
  /** sine[320]: 128 sin, in 1/320 of a turn; bsine[W]: in 1/W; sin360[360]. */
  readonly sine = new Int32Array(320);
  readonly bsine: Int32Array;
  readonly sin360 = new Float64Array(360);
  /** tables[10][256] (sound_tables.cc), flat: a read past one table's end reads the next, as in C. */
  readonly tables = new Uint8Array(2560);
  /** The frame rate the waves and the palette smoothing assume (Cthugha-L ran at 25). */
  fps = 25;
  /** A translation was done by a flame this frame (done_translate). */
  doneTranslate = false;

  constructor(width: number, height: number, random: CRandom) {
    this.W = width;
    this.H = height;
    this.SIZE = width * height;
    this.BASE = 3 * width;
    this.LENGTH = this.SIZE + 6 * width;
    this.active = new Uint8Array(this.LENGTH);
    this.passive = new Uint8Array(this.LENGTH);
    this.screenWidth = 2 * width;
    this.screenHeight = 2 * height;
    this.screen = new Uint8Array(4 * this.SIZE);
    this.random = random;
    for (let i = 0; i < 320; i += 1) this.sine[i] = Math.trunc(128 * Math.sin(i * 0.03927));
    for (let i = 0; i < 360; i += 1) this.sin360[i] = Math.sin(i * ((2 * Math.PI) / 360));
    this.bsine = new Int32Array(Math.max(width, 1));
    for (let i = 0; i < width; i += 1) this.bsine[i] = Math.trunc(128 * Math.sin((i / width) * 2 * Math.PI));
    for (let i = 0; i < 256; i += 1) {
      const d = Math.abs(128 - i);
      // Stored in unsigned chars: 256 is 0, as it was.
      this.tables[i] = (d * 2) & 255;
      this.tables[256 + i] = (255 - d * 2) & 255;
      this.tables[512 + i] = i;
      this.tables[768 + i] = 255 - i;
      this.tables[1024 + i] = (d + 127) & 255;
      this.tables[1280 + i] = (255 - d + 127) & 255;
      this.tables[1536 + i] = random.rand() % 256;
      this.tables[1792 + i] = d < 64 ? 255 : (d * 4) & 255;
      this.tables[2048 + i] = d;
      this.tables[2304 + i] = 255 - d;
    }
  }

  /** The PTR macro, the translation and the end of CthughaBuffer::run: the buffers trade places. */
  swap(): void {
    const buffer = this.active;
    this.active = this.passive;
    this.passive = buffer;
  }

  /** imath.cc's isin(deg), in degrees. */
  isin(deg: number): number {
    let d = Math.trunc(deg) % 360;
    if (d < 0) d += 360;
    return this.sin360[d]!;
  }

  icos(deg: number): number {
    return this.isin(Math.trunc(deg) + 90);
  }
}

/** divsub[i] = i/4 − 1 (0 at least), divsub2 = i/2 − 1 (an unsigned char), divsub4 = i − 2 (init_flames). */
export const DIVSUB = new Uint8Array(1024);
export const DIVSUB2 = new Uint8Array(1024);
export const DIVSUB4 = new Uint8Array(256);
for (let i = 0; i < 1024; i += 1) {
  DIVSUB[i] = i >> 2 ? (i >> 2) - 1 : 0;
  DIVSUB2[i] = i >> 1 ? ((i >> 1) - 1) & 255 : 0;
}
for (let i = 0; i < 256; i += 1) DIVSUB4[i] = i <= 2 ? 0 : i - 2;
