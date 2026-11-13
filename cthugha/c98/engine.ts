/**
 * Cthugha98 0.6a, one frame at a time: start-up (0x405E7B, 0x405A1C, 0x4054A3), the main step
 * (0x406198: a run, or a change, then the "no key" case with the pictures), the flame run
 * (0x40A58C), the special run (0x40F2D0), the palettes (0x4071A1, 0x40702B), the sound test
 * (0x40C4E2), the translation (0x408570), the text (0x40F03C) and the displays (0x40EA2B…).
 * Translated from Cthugha98.exe by static analysis (see SOURCE.md). Cthugha (c) 1993-1998
 * Kevin "Zaph" Burfitt, Torps Productions. Postcardware, non-commercial use only, with credit.
 * Never committed.
 *
 * The program ran its runs one after another as fast as the machine let it (no frame limit:
 * the title showed the frames a second); the scene steps it at a fixed rate. It drew into a
 * buffer of the screen's size over the display's divisors (640 × 480: 640 × 480, 640 × 240,
 * 320 × 240, 320 × 480), which the display copied — turned, split, mirrored — to the screen.
 * The 3Dfx build is the same engine with a 256 × 256 "screen" that Glide shows in 3D.
 *
 * Kept as the program had them (quirks, not bugs of this port): the "FFT" palette flashing is
 * never called (its toggle does nothing); palettes change at once (the fade's switch is off);
 * the pictures come with the general palette (the PCX reader's palette branch needs a video
 * mode the program never set); "Kaleidescope" repeats its left half on the right instead of
 * mirroring it; the translation tables are stretched over the whole screen whatever the
 * display's buffer; the silence text is turned about line 199 on every display but "Upwards";
 * the three "90deg" displays (never chosen at random) leave parts of the screen stale.
 */

import { BUILTIN, CHARSET, MAPS, PICTURES, STRINGS, TABLES } from "./data";
import { FLAMES } from "./flames";
import { type C98Host, makeSine, makeTable, MsRandom } from "./host";
import { C98Specials } from "./specials";
import { C98Waves } from "./waves";

/** MIN_TIME, RAND_TIME (0x448C0C, 0x448C10): a run lasts 200 + rand() % 750 frames. */
const MIN_TIME = 200;
const RAND_TIME = 750;
/** QUIET_CHANGE (0x448C14), MINNOISE (0x448BF0), PEAKLEVEL (0x47944C), PEAKFRAMES (0x479450). */
const QUIET_CHANGE = 1;
const MINNOISE = 4;
const PEAKLEVEL = 220;
const PEAKFRAMES = 64;
/** Room after the buffers: a flame reads a byte or two past them. */
const PAD = 4096;

/** disparray (0x479828) with the divisors of the screen it gives the buffer (0x479928). */
export const DISPLAYS: readonly { name: string; when: number; dx: number; dy: number }[] = [
  { name: "Upwards", when: 255, dx: 1, dy: 1 },
  { name: "Downwards", when: 255, dx: 1, dy: 1 },
  { name: "Hor. Split out", when: 255, dx: 1, dy: 2 },
  { name: "Hor. Split in", when: 255, dx: 1, dy: 2 },
  { name: "Kaleidescope", when: 255, dx: 2, dy: 2 },
  { name: "90deg rot. mirror", when: 0, dx: 2, dy: 1 },
  { name: "90deg rot. mirror 2", when: 0, dx: 2, dy: 1 },
  { name: "90deg Kaleidescope", when: 0, dx: 2, dy: 2 }
];

function decode(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

interface Library {
  /** The palettes as the start-up (0x4054A3) made them: 8 built-in, the general one, the picture slot, the maps. */
  palettes: Uint8Array[];
  pictureSlot: number;
  pictures: { name: string; w: number; h: number; pixels: Uint8Array }[];
  /** Each picture's palette as loaded: the slot's (the general palette). */
  pictureLuts: Uint8Array[];
  /** The tables: [0] is "none"; then HURR, ROTATE, SPIR-OUT (absolute offsets in 320 × 204). */
  tables: Uint16Array[];
  charset: Uint8Array;
}

let cache: Library | null = null;
function library(): Library {
  if (cache) return cache;
  const palettes = BUILTIN.map(decode);
  const general = new Uint8Array(768);
  let j = 0;
  for (let i = 0; i < 64; i += 1) { general[j++] = i * 4; general[j++] = 0; general[j++] = 0; }
  for (let i = 0; i < 128; i += 1) { general[j++] = 255; general[j++] = 0; general[j++] = i * 2; }
  for (let i = 0; i < 64; i += 1) { general[j++] = 255 - i * 4; general[j++] = 0; general[j++] = 255; }
  palettes.push(general);
  const pictureSlot = palettes.length;
  const pictures = PICTURES.map(([name, w, h, x, y, cw, ch, data]) => {
    const pixels = new Uint8Array(w * h);
    const part = decode(data);
    for (let r = 0; r < ch; r += 1) pixels.set(part.subarray(r * cw, (r + 1) * cw), (y + r) * w + x);
    return { name, w, h, pixels };
  });
  palettes.push(new Uint8Array(general));
  const pictureLuts = pictures.map(() => new Uint8Array(general));
  // Without pictures the slot is not counted (0x4058BD): the maps would take its place.
  if (!pictures.length) palettes.pop();
  for (const [, data] of MAPS) palettes.push(decode(data));
  const tables = [new Uint16Array(0), ...TABLES.map(([, data]) => {
    const bytes = decode(data);
    return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1);
  })];
  cache = { palettes, pictureSlot, pictures, pictureLuts, tables, charset: decode(CHARSET) };
  return cache;
}

export interface C98Settings {
  seed: number;
  /** The "screen": 640 × 480 for the 2D build, 256 × 256 for the 3Dfx build. */
  screenWidth: number;
  screenHeight: number;
  /** A display kept through the changes (a personal setting would keep one), or none. */
  display?: number;
}

/** What the screen shows after a frame: the buffer a display handed the blitter. */
export interface C98Blit {
  source: Uint8Array;
  /** "Downwards": the rows from the bottom up (the 3Dfx build takes it for its low camera). */
  flipped: boolean;
}

export class C98Engine implements C98Host {
  b: Uint8Array;
  W: number;
  H: number;
  readonly screenW: number;
  readonly screenH: number;
  readonly stereo = new Uint8Array(2048);
  readonly table = makeTable();
  curtable = 0;
  readonly sine = makeSine();
  /** The other buffer (0x481F7C): the translation's target, the displays' screen. */
  private b2: Uint8Array;
  private readonly random: MsRandom;
  private readonly lib = library();
  private readonly waves: C98Waves;
  readonly specials: C98Specials;
  /** The current palette (0x481B14), 8-bit RGB. */
  readonly palette = new Uint8Array(768);
  private curpal = 0;
  private flame = 0;
  private wave = 0;
  private wave0 = 0;
  private display = 0;
  private readonly fixedDisplay: number | undefined;
  /** 0x481F68: a special run (1…3) instead of the flame run. */
  special = 0;
  /** 0x4A2174: the translation table (0 none). */
  private translateTable = 0;
  private useFft = false;
  // main step
  private changeFlag = 0;
  private changed = 0;
  /** The palette when this main step began ([ebp-14h]), which a picture may go back to. */
  private stepPal = 0;
  private pcxcount = 0;
  private pcxev = 0;
  private actpcx = 0;
  private pcxHold = 0;
  // the run
  private inRun = false;
  private specialRun = false;
  private specialMode = 0;
  private count = 0;
  private frames = 0;
  private quiet = 0;
  private wasQuiet = false;
  private beats = 0;
  private loud = false;
  private curstr = 0;
  private row = 42;
  // translate()'s conversion (0x4A217C) and what it was made for
  private readonly conv: Int32Array;
  private lastTable = -1;
  private convW = 0;
  private convH = 0;
  /** The last frame's blit. */
  readonly blit: C98Blit;

  constructor(settings: C98Settings) {
    this.screenW = settings.screenWidth;
    this.screenH = settings.screenHeight;
    this.W = this.screenW;
    this.H = this.screenH;
    const size = this.screenW * this.screenH;
    this.b = new Uint8Array(size + PAD);
    this.b2 = new Uint8Array(size + PAD);
    this.conv = new Int32Array(size);
    this.blit = { source: this.b, flipped: false };
    this.random = new MsRandom(settings.seed);
    this.waves = new C98Waves(this);
    this.specials = new C98Specials(this);
    this.fixedDisplay = settings.display;
    // 0x405E7B (after srand): the first wave, flame and display.
    this.wave0 = this.rand();
    this.changeWave(this.wave0);
    this.flame = this.rand();
    this.changeFlame(this.flame);
    this.display = this.changeDisplay(this.rand() % 255);
    this.curpal %= this.lib.palettes.length;
    this.flame = this.changeFlame(this.flame);
    this.changeWave(this.wave0);
    this.display = this.changeDisplay(this.display);
    this.setPalette(this.curpal);
    this.pcxcount = this.rand() % 5;
  }

  rand(): number {
    return this.random.rand();
  }

  /** What is on now, like the title bar ("F%2d W%3d D%2d") with the names. */
  describe(): string {
    const parts = [
      `display=${DISPLAYS[this.display]!.name}`, `flame=${FLAMES[this.flame]!.name}`,
      `wave=${this.waves.list[this.wave]!.name}`, `palette=${this.curpal}`, `table=${this.curtable}`,
      `translate=${this.translateTable ? TABLES[this.translateTable - 1]![0] : "none"}`,
      `count=${this.count}`, `buffer=${this.W}x${this.H}`
    ];
    if (this.specialRun) parts.push(`special=${this.specials.describe()}`);
    if (this.pcxHold > 0) parts.push(`picture=${this.lib.pictures[this.actpcx]!.name}`);
    return parts.join(" ");
  }

  // --- the tables of effects ----------------------------------------------------------------

  /** 0x41105F and its twins: from n on, the first entry chosen at random (`when` ≠ 0). */
  private static allowed(list: readonly { when: number }[], n: number): number {
    const count = list.length;
    while (n < 0) n += count;
    n %= count;
    const start = n;
    while (list[n]!.when === 0) {
      n = (n + 1) % count;
      if (n === start) break;
    }
    return n;
  }

  /** change_flame (0x40A1F0). */
  private changeFlame(n: number): number {
    return C98Engine.allowed(FLAMES, n % FLAMES.length);
  }

  /** change_wave (0x40E8B7). */
  private changeWave(n: number): void {
    this.wave = C98Engine.allowed(this.waves.list, n % this.waves.list.length);
  }

  /** change_display (0x40E995): the display and the buffer's size it asks for. */
  private changeDisplay(n: number): number {
    let d = C98Engine.allowed(DISPLAYS, n % DISPLAYS.length);
    if (this.fixedDisplay !== undefined) d = this.fixedDisplay;
    this.W = Math.trunc(this.screenW / DISPLAYS[d]!.dx);
    this.H = Math.trunc(this.screenH / DISPLAYS[d]!.dy);
    return d;
  }

  // --- palettes ------------------------------------------------------------------------------

  /** set_palette (0x4071A1): at once, as the fade's switch (0x448C54) is on. */
  private setPalette(n: number): void {
    const count = this.lib.palettes.length;
    if (n >= 0) this.curpal = n % count;
    this.updatePalette();
  }

  /** update_palette (0x40702B), at the start of every frame. */
  private updatePalette(): void {
    this.palette.set(this.lib.palettes[this.curpal]!);
  }

  // --- one frame -----------------------------------------------------------------------------

  /** One frame; `stereo` holds this frame's samples. */
  step(): void {
    for (let guard = 0; !this.inRun && guard < 8; guard += 1) this.mainStep();
    if (this.specialRun) this.specialFrame();
    else this.flameFrame();
    if (this.count <= 0) {
      this.inRun = false;
      this.afterRun();
    }
  }

  /** 0x406198 up to the run: start one, or change everything and go on. */
  private mainStep(): void {
    this.stepPal = this.curpal;
    if (this.changeFlag === 0) {
      if (this.special) this.startSpecial(this.special - 1);
      else this.startFlames();
      return;
    }
    this.changeFlag = 0;
    // "Change Everything random" (no personal settings).
    this.curtable = this.rand() % 10;
    this.setPalette(this.rand() % this.lib.palettes.length);
    this.flame = this.changeFlame(this.rand());
    this.changeWave(this.rand() % this.waves.list.length);
    this.display = this.changeDisplay(this.rand() % DISPLAYS.length);
    this.special = this.rand() & 1 ? this.rand() & 3 : 0;
    const tables = this.lib.tables.length;
    if (tables && this.rand() % 5 === 0) this.translateTable = this.rand() % tables;
    else this.translateTable = 0;
    if (this.rand() % 5 === 0) this.useFft = !this.useFft;
    this.changed = 1;
    this.noKey();
  }

  /** The rest of the main step after a run. */
  private afterRun(): void {
    this.pcxcount -= 1;
    if (this.pcxcount <= 0) {
      if (this.lib.pictures.length) this.pcxev = 1;
      this.pcxcount = this.rand() % 5;
    }
    this.changed = 0;
    this.changeFlag = 0;
    this.noKey();
  }

  /** The key switch's case 0 (0x406618): change next time, or show a picture. */
  private noKey(): void {
    if (this.changed) {
      this.changeFlag = 0;
      this.changed = 0;
    } else {
      this.changeFlag = 1;
    }
    if (this.pcxev && this.lib.pictures.length) this.picture();
  }

  /** A picture (0x406659): a piece of it somewhere, or all of it from the top left. */
  private picture(): void {
    const lib = this.lib;
    this.pcxHold = (this.rand() % 90) + 30;
    this.changed = 0;
    this.changeFlag = 0;
    this.actpcx = this.rand() % lib.pictures.length;
    const pic = lib.pictures[this.actpcx]!;
    this.pcxev = this.rand() & 1;
    const { W, H, b } = this;
    if (this.pcxev === 0) {
      const xmin = this.rand() % pic.w;
      const ymin = this.rand() % pic.h;
      const xdest = this.rand() % (W - 50);
      const ydest = this.rand() % (H - 50);
      let w = (this.rand() % (W - 50)) + 50;
      let h = (this.rand() % (H - 50)) + 50;
      if (xmin + w >= pic.w) w = pic.w - 1 - xmin;
      if (ymin + h >= pic.h) h = pic.h - 1 - ymin;
      if (xdest + w >= W) w = W - 1 - xdest;
      if (ydest + h >= H) h = H - 1 - ydest;
      if (w % 2) w -= 1;
      for (let y = 0; y < h; y += 1) {
        const from = (ymin + y) * pic.w + xmin;
        b.set(pic.pixels.subarray(from, from + w), (ydest + y) * W + xdest);
      }
    }
    if (this.pcxev === 1) {
      // Whole: at the screen's width, whatever the display's buffer.
      const cols = Math.min(this.screenW, pic.w);
      const rows = Math.min(this.screenH, pic.h);
      for (let y = 0; y < rows; y += 1) b.set(pic.pixels.subarray(y * pic.w, y * pic.w + cols), y * this.screenW);
    }
    this.pcxev = 1;
    lib.palettes[lib.pictureSlot]!.set(lib.pictureLuts[this.actpcx]!);
    if (this.rand() % 3) {
      this.setPalette(lib.pictureSlot);
      this.pcxev = 0;
    }
    if (this.pcxev && this.rand() % 3 === 0) this.setPalette(lib.pictureSlot);
    if (!this.pcxev && this.rand() % 3 === 0) this.setPalette(this.stepPal);
  }

  // --- the flame run (0x40A58C) -------------------------------------------------------------

  private startFlames(): void {
    this.inRun = true;
    this.specialRun = false;
    this.count = (this.rand() % RAND_TIME) + MIN_TIME;
    this.b.fill(0, (this.H - 4) * this.W, this.H * this.W);
    this.frames = 0;
  }

  private flameFrame(): void {
    this.frames += 1;
    this.count -= 1;
    this.updatePalette();
    if (this.translateTable) this.translate();
    if (this.pcxHold > 0) this.pcxHold -= 1;
    else FLAMES[this.flame]!.run(this);
    if (this.getSound()) {
      this.waves.list[this.wave]!.draw();
      if (QUIET_CHANGE) {
        if (this.quiet > QUIET_CHANGE) {
          this.wasQuiet = true;
          this.quiet = 0;
        } else if (this.wasQuiet) {
          this.wasQuiet = false;
          this.count = 0;
        }
      }
      if (PEAKFRAMES > 0 && this.loud) {
        this.beats += 1;
        if (this.beats > PEAKFRAMES) {
          this.beats = 0;
          this.count = 0;
        }
      }
    } else {
      this.quiet += 1;
      if (this.quiet > 255) {
        const text = STRINGS[this.curstr]!;
        this.drawText(0, this.row, 2, this.tableAt(0), text);
        this.drawText(1, this.row + 1, 2, this.tableAt(this.quiet - 255), text);
        if (this.quiet > 512) {
          this.quiet = 0;
          this.curstr = this.rand() % 20;
          this.row = this.rand() % 80;
        }
      }
    }
    this.showDisplay();
  }

  /** table[curtable][i] read flat, as the code did; past the ten tables, 0. */
  private tableAt(i: number): number {
    const at = this.curtable * 256 + i;
    return at >= 0 && at < this.table.length ? this.table[at]! : 0;
  }

  // --- the special run (0x40F2D0) -----------------------------------------------------------

  private startSpecial(mode: number): void {
    this.inRun = true;
    this.specialRun = true;
    this.count = (this.rand() % RAND_TIME) + MIN_TIME;
    this.W = this.screenW;
    this.H = this.screenH;
    this.specialMode = this.specials.start(mode);
    this.frames = 0;
  }

  private specialFrame(): void {
    this.frames += 1;
    this.count -= 1;
    if (this.frames % 400 === 0) this.setPalette(this.rand() % this.lib.palettes.length);
    if (this.pcxHold > 0) this.pcxHold -= 1;
    const { b } = this;
    switch (this.specialMode) {
      case 1:
        if (this.translateTable) this.translate();
        break;
      case 2: {
        if (this.translateTable) this.translate();
        const buf = this.b;
        for (let i = 0, n = this.W * this.H; i < n; i += 1) if (buf[i]) buf[i] = buf[i]! - 1;
        break;
      }
      case 3:
        if (this.translateTable) this.translate();
        if (this.pcxHold === 0) FLAMES[this.flame]!.run(this);
        break;
      default:
        if (this.pcxHold === 0) b.fill(0, 0, this.W * this.H);
    }
    this.getSound();
    this.specials.draw();
    this.updatePalette();
    this.blit.source = this.b;
    this.blit.flipped = false;
  }

  // --- sound (0x40C4E2) ----------------------------------------------------------------------

  /** Noisy when a channel swings more than MINNOISE; loud past PEAKLEVEL. */
  private getSound(): boolean {
    let noisy = false;
    this.loud = false;
    const s = this.stereo;
    for (let c = 0; c < 2; c += 1) {
      let ln = 255;
      let hn = 0;
      for (let i = 0; i < 1024; i += 1) {
        const v = s[2 * i + c]!;
        if (v > hn) hn = v;
        if (v < ln) ln = v;
      }
      if (hn - ln > MINNOISE) noisy = true;
      if (!this.loud && PEAKFRAMES > 0 && hn - ln > PEAKLEVEL) this.loud = true;
    }
    return noisy;
  }

  // --- translate (0x408570) ------------------------------------------------------------------

  /**
   * The table is made for the whole screen, from its 320 × 200 offsets (every target pixel
   * takes the source of its nearest 320 × 200 pixel, scaled to the screen with the remainders
   * carried from pixel to pixel), then every screen pixel is fetched and the buffers swap.
   */
  private translate(): void {
    const tables = this.lib.tables;
    if (tables.length <= 1 || this.translateTable === 0) return;
    const sw = this.screenW;
    const sh = this.screenH;
    const size = sw * sh;
    const conv = this.conv;
    if (this.translateTable !== this.lastTable || this.convH !== sh || this.convW !== sw) {
      this.convH = sh;
      this.convW = sw;
      const fx = Math.fround(320 / sw);
      const fy = Math.fround(200 / sh);
      const table = tables[this.translateTable]!;
      let errx = 0;
      let erry = 0;
      let k = 0;
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const ix = Math.trunc(x * fx);
          const iy = Math.trunc(y * fy);
          const v = table[iy * 320 + ix] ?? 0;
          const tx = v % 320;
          const ty = Math.trunc(v / 320);
          const ex = Math.fround((tx * sw + errx) * Math.fround(1 / 320));
          const ey = Math.fround((ty * sh + erry) * Math.fround(1 / 200));
          const ox = Math.trunc(ex);
          const oy = Math.trunc(ey);
          errx = Math.fround(ex - ox);
          erry = Math.fround(ey - oy);
          let at = oy * sw + ox;
          if (at >>> 0 > size) at = 0;
          conv[k++] = at;
        }
      }
      this.lastTable = this.translateTable;
    }
    const src = this.b;
    const dst = this.b2;
    src[0] = 0;
    for (let i = 0; i < size; i += 1) dst[i] = src[conv[i]!]!;
    this.b = dst;
    this.b2 = src;
  }

  // --- text (0x40F03C) -----------------------------------------------------------------------

  /** draw_string: into the buffer (it burns), turned about line 199 unless the display is "Upwards". */
  private drawText(xpos: number, ypos: number, size: number, colour: number, text: string): void {
    const charset = this.lib.charset;
    const { b, W } = this;
    const value = colour & 255;
    for (const char of text) {
      const code = char.charCodeAt(0) & 255;
      let glyph = code * 14;
      for (let y = ypos; y <= ypos + size * 14 - 1; y += size) {
        let mask = 0x80;
        for (let x = xpos; x < xpos + size * 8; x += size) {
          if (charset[glyph]! & mask) {
            for (let i = 0; i < size; i += 1) {
              for (let j = 0; j < size; j += 1) {
                const row = this.display ? 199 - (y + i) : y + i;
                const at = row * W + x + j;
                if (at >= 0 && at < b.length - PAD) b[at] = value;
              }
            }
          }
          mask >>= 1;
        }
        glyph += 1;
      }
      xpos += size * 8;
    }
  }

  // --- the displays (0x40EA2B …) -------------------------------------------------------------

  /** The display: the buffer to the screen, through the second buffer when it is composed. */
  private showDisplay(): void {
    const { b, W, H, screenW: sw, screenH: sh } = this;
    const s = this.b2;
    this.blit.flipped = false;
    switch (this.display) {
      case 1: // Downwards
        this.blit.source = b;
        this.blit.flipped = true;
        return;
      case 2: { // Hor. Split out: the buffer upside down above, as it is below
        let at = 0;
        for (let y = H - 1; y >= 0; y -= 1, at += W) s.set(b.subarray(y * W, y * W + W), at);
        s.set(b.subarray(0, H * W), at);
        break;
      }
      case 3: { // Hor. Split in
        s.set(b.subarray(0, H * W), 0);
        let at = H * W;
        for (let y = H - 1; y >= 0; y -= 1, at += W) s.set(b.subarray(y * W, y * W + W), at);
        break;
      }
      case 4: { // Kaleidescope: each row twice (the second a pixel on), the bottom half mirrored
        let top = 0;
        let bottom = (sh - 1) * sw;
        for (let y = 0; y < H; y += 1) {
          const row = b.subarray(y * W, y * W + W);
          s.set(row, top);
          s.set(row, bottom);
          let src = y * W + W - 1;
          for (let k = W; k > 0; k -= 1, src += 1) {
            const v = b[src]!;
            s[top + W + (W - k)] = v;
            s[bottom + W + (W - k)] = v;
          }
          top += sw;
          bottom -= sw;
        }
        break;
      }
      case 5: { // 90deg rot. mirror: a column down and back up per screen row
        let at = 0;
        let src = 0;
        for (let y = 0; y < sh; y += 1) {
          for (let x = 0; x < W; x += 1, src += W) s[at++] = b[src]!;
          for (let x = 0; x < W; x += 1, src -= W) s[at++] = b[src]!;
          src += 1;
        }
        break;
      }
      case 6: { // 90deg rot. mirror 2: H rows of W pixels written one after another
        let at = 0;
        let src = W * H - 1;
        const half = Math.trunc(W / 2);
        for (let y = 0; y < H; y += 1) {
          for (let x = 0; x < half; x += 1, src -= W) s[at++] = src >= 0 ? b[src]! : 0;
          for (let x = half; x < W; x += 1, src += W) s[at++] = src >= 0 ? b[src]! : 0;
          src -= 1;
        }
        break;
      }
      case 7: { // 90deg Kaleidescope: from both ends of an H × H square
        let at = 0;
        let back = H * H - 1;
        let src = 0;
        const half = Math.trunc(W / 2);
        for (let y = 0; y < Math.trunc(H / 2); y += 1) {
          for (let x = 0; x < half; x += 1, src += W) {
            const v = b[src]!;
            s[at++] = v;
            if (back >= 0) s[back] = v;
            back -= 1;
          }
          for (let x = half; x < W; x += 1, src -= W) {
            const v = b[src]!;
            s[at++] = v;
            if (back >= 0) s[back] = v;
            back -= 1;
          }
          src += 1;
        }
        break;
      }
      default: // Upwards
        this.blit.source = b;
        return;
    }
    this.blit.source = s;
  }

  /**
   * The screen through DirectDraw's palette, as RGBA: entries 1…254 from the current palette;
   * 0 and 255 are the system's black and white (the palette was made without DDPCAPS_ALLOW256,
   * and the program set entries 0…254 only).
   */
  paint(rgba: Uint8ClampedArray): void {
    const p = this.palette;
    const colours = new Uint32Array(256);
    for (let i = 1; i < 255; i += 1) colours[i] = (255 << 24 | p[3 * i + 2]! << 16 | p[3 * i + 1]! << 8 | p[3 * i]!) >>> 0;
    colours[0] = 0xff000000;
    colours[255] = 0xffffffff;
    const out = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
    const { source, flipped } = this.blit;
    const sw = this.screenW;
    const sh = this.screenH;
    for (let y = 0; y < sh; y += 1) {
      const from = (flipped ? sh - 1 - y : y) * sw;
      const to = y * sw;
      for (let x = 0; x < sw; x += 1) out[to + x] = colours[source[from + x]!]!;
    }
  }
}
