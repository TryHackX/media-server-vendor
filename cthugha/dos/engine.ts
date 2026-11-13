/**
 * Cthugha 5.3 for DOS (CTHUGHA.C main(), FLAMES.C flame_cro(), AUDIO.C get_stereo(),
 * DISPLAY.C, TRANSLAT.C, PETE.C FFT(), FillLUTBuffer()), one frame at a time.
 * Cthugha (c) 1993-1995 Kevin "Zaph" Burfitt, Torps Productions. Non-commercial use only, with
 * credit (COPYING-cthugha-53.txt).
 *
 * The program ran in VGA mode 13h (320 × 200, 256 colours of a 6-bit DAC) on one 320 × 204
 * buffer. flame_cro() ran `count` frames (200 + rand() % 750, 70 a second), each: translation
 * table, flame (unless a picture has just come), then — when the sound was not quiet — the
 * "FFT" palette flashing and the wave, or after 255 quiet frames a silence string drawn into the
 * buffer; then the display. Between two runs main() changed everything at random, or showed one
 * of the pictures (whole, or a piece of it somewhere) every few runs. A frame that comes after
 * a silence, or the 17th very loud one, ends the run.
 *
 * Fixed here, as bugs that spoiled their effect (fomalhaut's list of 5.3's bugs has them too):
 * "Downwards" shifted the picture a line instead of turning it; both kaleidoscopes placed their
 * mirrored half a line or a pixel off, which left a seam; the built-in palettes were converted
 * to the DAC's 6 bits for their first 85 colours only; a picture larger than the screen showed
 * its top left corner (data.ts takes its middle).
 */

import { BUILTIN_PALETTES, CHARSET, MAP_PALETTES, PICTURES, TABLES } from "./data";
import { FLAMES, SEGMENT, WIDTH } from "./flames";
import { Waves } from "./waves";

const H = 204;
const BUFF_SIZE = WIDTH * H;
const NUMTABLES = 10;
const MIN_TIME = 200;
const RAND_TIME = 750;
const QUIET_CHANGE = 1;
const MINNOISE = 4;
const PEAKLEVEL = 220;
const PEAKFRAMES = 16;

/** stringtable[20] of FLAMES.C. */
const STRINGS = [
  " Wheres the music? ", "       JOLT !      ", "      Hey, You!!   ", " Turn The Music On ",
  "    Lets Party!!!  ", " Pink Floyd Rules  ", "Sounds of Silence ?", "     The Torps     ",
  "     Play QUAKE    ", "     Drink COKE    ", " Press F1 for help ", "Consume!           ",
  "Spooky Mulder....  ", "Wheres Cthugha 6.0?", "   Subliminal Ads  ", "Read a book        ",
  "     Get a life....", "      SMILE!       ", "    Cthugha 5.3    ", " Torps Productions "
];

/** disparray[] of DISPLAY.C. */
export const DISPLAYS = ["Upwards", "Downwards", "Hor. Split out", "Hor. Split in", "Kaleidescope", "90deg rot. mirror", "90deg rot. mirror 2", "90deg Kaleidescope"];

/** Microsoft C's rand(): holdrand × 214013 + 2531011, bits 16–30. */
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

function decode(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

interface Library {
  /** The palettes as pcx_and_palettes() left them, 6-bit, without the picture slot. */
  builtin: Uint8Array[];
  maps: Uint8Array[];
  pictures: { name: string; pixels: Uint8Array; palette: Uint8Array }[];
  tables: Uint16Array[];
  charset: Uint8Array;
}

let cache: Library | null = null;
function library(): Library {
  if (cache) return cache;
  const builtin = BUILTIN_PALETTES.map(([, data]) => {
    const pal = decode(data);
    // pcx_and_palettes() shifted only bytes 0–254 to the DAC's 6 bits; all of them here.
    for (let j = 0; j < 768; j += 1) pal[j] = pal[j]! >> 2;
    return pal;
  });
  // The general palette it made: red up, red to magenta, magenta to blue.
  const general = new Uint8Array(768);
  let j = 0;
  for (let i = 0; i < 64; i += 1) { general[j++] = i; general[j++] = 0; general[j++] = 0; }
  for (let i = 0; i < 128; i += 1) { general[j++] = 63; general[j++] = 0; general[j++] = i >> 1; }
  for (let i = 0; i < 64; i += 1) { general[j++] = 63 - i; general[j++] = 0; general[j++] = 63; }
  builtin.push(general);
  const tables = TABLES.map(([, data]) => {
    const bytes = decode(data);
    const deltas = new Int16Array(bytes.buffer, bytes.byteOffset, BUFF_SIZE);
    const table = new Uint16Array(BUFF_SIZE);
    for (let i = 0; i < BUFF_SIZE; i += 1) table[i] = (i + deltas[i]!) & 0xffff;
    return table;
  });
  cache = {
    builtin,
    maps: MAP_PALETTES.map(([, data]) => decode(data)),
    pictures: PICTURES.map(([name, , , pixels, palette]) => ({ name, pixels: decode(pixels), palette: decode(palette) })),
    tables,
    charset: decode(CHARSET)
  };
  return cache;
}

export interface DosSettings {
  seed: number;
  /** A display kept through the changes (a personal CTHUGHA.INI line would keep one), or none. */
  display?: number;
}

export class DosEngine {
  readonly screen = new Uint8Array(WIDTH * 200);
  readonly stereo = new Int32Array(2 * WIDTH);
  private buff = new Uint8Array(SEGMENT);
  private shadow = new Uint8Array(SEGMENT);
  private readonly table = new Int32Array(NUMTABLES * 256);
  private readonly waves: Waves;
  private readonly random = new MsRandom(1);
  private readonly lib = library();
  /** LUTfiles[]: built-in, the general one, the picture slot, the map files. */
  private readonly luts: Uint8Array[];
  private readonly pcxluts: number;
  /** LUTbuffer: what the DAC holds now (6 bits). */
  private readonly lut = new Uint8Array(768);
  private readonly rgba = new Uint32Array(256);
  private curpal = 0;
  private readonly oldpal = 0;
  private curflame = 0;
  private usewave = 0;
  private curdisplay = 0;
  private curtable = 0;
  private translate = 0;
  private useFft = false;
  private readonly fixedDisplay: number | undefined;
  // main() and flame_cro()
  private current = 0;
  private doit = 0;
  private inCro = false;
  private count = 0;
  private quiet = 0;
  private wasQuiet = false;
  private peaks = 0;
  private peaknoise = false;
  private showstring = 0;
  private linenum = 42;
  private pcxcount = 0;
  private pcxev = 0;
  private pcxtime = 0;
  private actpcx = 0;
  /** FFT()'s slab. */
  private readonly slab = new Uint32Array(WIDTH);

  constructor(settings: DosSettings) {
    this.fixedDisplay = settings.display;
    this.waves = new Waves(this.buff, this.stereo, this.table);
    const lib = this.lib;
    this.pcxluts = lib.builtin.length;
    const pictureSlot = new Uint8Array(lib.builtin[lib.builtin.length - 1]!);
    this.luts = [...lib.builtin, pictureSlot, ...lib.maps];
    for (let j = 0; j < NUMTABLES; j += 1) {
      for (let i = 0; i < 256; i += 1) {
        const d = Math.abs(128 - i);
        const values = [d * 2, 255 - d * 2, i, 255 - i, d + 127, 255 - d + 127, d + 127, d < 64 ? 255 : d * 4, d, 255 - d];
        this.table[j * 256 + i] = values[j]!;
      }
    }
    // main(): the first wave, flame and display come before srand(), so always the same ones.
    this.usewave = this.random.rand() % this.waves.list.length;
    this.curflame = this.random.rand() % FLAMES.length;
    this.curdisplay = (this.random.rand() % 255) % DISPLAYS.length;
    this.random.srand(settings.seed);
    if (this.fixedDisplay !== undefined) this.curdisplay = this.fixedDisplay;
    this.fillLut(0);
    this.pcxcount = this.rand() % 5;
  }

  private rand(): number {
    return this.random.rand();
  }

  /** What is on now, as Cthugha's status line would name it (for testing). */
  describe(): string {
    return [
      `display=${DISPLAYS[this.curdisplay]}`, `flame=${FLAMES[this.curflame]!.name}`,
      `wave=${this.waves.list[this.usewave]!.name}`, `palette=${this.curpal}`, `table=${this.curtable}`,
      `translate=${this.translate ? TABLES[this.translate - 1]![0] : "none"}`, `fft=${this.useFft ? 1 : 0}`,
      `count=${this.count}`, this.pcxtime > 0 ? `picture=${this.lib.pictures[this.actpcx]!.name}` : ""
    ].join(" ").trim();
  }

  /** FillLUTBuffer(pal): a palette to the DAC. */
  private fillLut(pal: number): void {
    this.curpal = pal % this.luts.length;
    this.lut.set(this.luts[this.curpal]!);
  }

  /** One frame (70 a second); `stereo` holds this frame's samples. */
  step(): void {
    for (let guard = 0; !this.inCro && guard < 16; guard += 1) this.mainLoop();
    this.frame();
    if (this.count <= 0) {
      this.inCro = false;
      this.afterCro();
    }
  }

  /** One turn of main()'s loop, up to the start of the next flame_cro(). */
  private mainLoop(): void {
    if (this.current === 0) {
      this.buff.fill(0, 201 * WIDTH, 203 * WIDTH);
      this.count = (this.rand() % RAND_TIME) + MIN_TIME;
      this.buff.fill(0, 200 * WIDTH, 204 * WIDTH);
      this.inCro = true;
      return;
    }
    this.changeAll();
    this.doit = 1;
    this.keys();
  }

  /** The rest of case 0 after flame_cro(), and the keyboard's Z_NOKEY. */
  private afterCro(): void {
    this.pcxcount -= 1;
    if (this.pcxcount <= 0) {
      if (this.lib.pictures.length) this.pcxev = 1;
      this.pcxcount = this.rand() % 5;
    }
    this.doit = 0;
    this.keys();
  }

  private keys(): void {
    if (this.doit) {
      this.current = 0;
      this.doit = 0;
    } else {
      this.current = (this.rand() % 1) + 1;
    }
    if (this.pcxev && this.lib.pictures.length) this.picture();
  }

  /** Change everything (In Theory). */
  private changeAll(): void {
    this.curtable = this.rand() % NUMTABLES;
    this.fillLut(this.rand() % this.luts.length);
    this.curflame = this.rand() % FLAMES.length;
    this.usewave = (this.rand() % this.waves.list.length) % this.waves.list.length;
    const display = this.rand() % DISPLAYS.length;
    this.curdisplay = this.fixedDisplay ?? display;
    const tables = this.lib.tables.length + 1;
    if (tables && !(this.rand() % 5)) this.translate = this.rand() % tables;
    if (this.rand() % 5 === 0) this.useFft = !this.useFft;
  }

  /** A picture: all of it, or a piece somewhere, and maybe its colours. */
  private picture(): void {
    const pictures = this.lib.pictures;
    this.pcxtime = 5 + (this.rand() % 20);
    this.current = 0;
    this.doit = 0;
    if (this.rand() % 2) this.actpcx = this.rand() % pictures.length;
    const pic = pictures[this.actpcx]!;
    this.pcxev = this.rand() % 2;
    if (this.pcxev === 0) {
      const xmin = this.rand() % (WIDTH - 50);
      const ymin = this.rand() % (H - 50);
      const xdest = this.rand() % (WIDTH - 50);
      const ydest = this.rand() % (H - 50);
      let b = 50 + (this.rand() % (WIDTH - 50));
      let h = 50 + (this.rand() % (H - 50));
      if (xmin + b >= WIDTH) b = WIDTH - 1 - xmin;
      if (ymin + h >= H) h = H - 1 - ymin;
      if (xdest + b >= WIDTH) b = WIDTH - 1 - xdest;
      if (ydest + h >= H) h = H - 1 - ydest;
      if (b % 2) b -= 1;
      for (let y = 0; y < h; y += 1) {
        const from = (ymin + y) * WIDTH + xmin;
        this.buff.set(pic.pixels.subarray(from, from + b), (ydest + y) * WIDTH + xdest);
      }
    }
    if (this.pcxev === 1) this.buff.set(pic.pixels.subarray(0, BUFF_SIZE));
    this.pcxev = 1;
    this.luts[this.pcxluts]!.set(pic.palette);
    if (this.rand() % 3) {
      this.fillLut(this.pcxluts);
      this.pcxev = 0;
    }
    if (this.pcxev) {
      if (!(this.rand() % 3)) this.fillLut(this.pcxluts);
    }
    if (!this.pcxev) {
      if (!(this.rand() % 3)) this.fillLut(this.oldpal);
    }
  }

  /** One turn of flame_cro()'s loop. */
  private frame(): void {
    this.count -= 1;
    if (this.translate) this.translateScreen();
    if (this.pcxtime > 0) this.pcxtime -= 1;
    else FLAMES[this.curflame]!.run(this.buff);
    if (this.getStereo()) {
      if (this.useFft) this.fft();
      this.waves.b = this.buff;
      this.waves.list[this.usewave]!.draw(this.curtable);
      if (this.quiet > QUIET_CHANGE) {
        this.wasQuiet = true;
        this.quiet = 0;
      } else if (this.wasQuiet) {
        this.wasQuiet = false;
        this.count = 0;
      }
      if (this.peaknoise) {
        this.peaks += 1;
        if (this.peaks > PEAKFRAMES) {
          this.peaks = 0;
          this.count = 0;
        }
      }
    } else {
      this.quiet += 1;
      if (this.quiet > 255) {
        const text = STRINGS[this.showstring]!;
        this.drawText(0, this.linenum, 2, this.tableAt(0), text);
        this.drawText(1, this.linenum + 1, 2, this.tableAt(this.quiet - 255), text);
        if (this.quiet > 512) {
          this.quiet = 0;
          this.showstring = this.rand() % STRINGS.length;
          this.linenum = this.rand() % 80;
        }
      }
    }
    this.display();
  }

  private tableAt(i: number): number {
    const at = this.curtable * 256 + i;
    return at < this.table.length ? this.table[at]! : 0;
  }

  /** get_stereo(): the sound is noisy when either channel swings more than minnoise. */
  private getStereo(): boolean {
    let noisy = false;
    this.peaknoise = false;
    for (let y = 0; y < 2; y += 1) {
      let ln = 255;
      let hn = 0;
      for (let x = 0; x < WIDTH; x += 1) {
        const v = this.stereo[2 * x + y]!;
        if (v > hn) hn = v;
        if (v < ln) ln = v;
      }
      if (hn - ln > MINNOISE) noisy = true;
      if (!this.peaknoise && hn - ln > PEAKLEVEL) this.peaknoise = true;
    }
    return noisy;
  }

  /** translate_screen(): every pixel from where the table says, then the buffers swap. */
  private translateScreen(): void {
    const table = this.lib.tables[this.translate - 1];
    if (!table) return;
    const src = this.buff;
    const dst = this.shadow;
    src[0] = 0;
    for (let i = 0; i < BUFF_SIZE; i += 1) dst[i] = src[table[i]!]!;
    this.buff = dst;
    this.shadow = src;
  }

  /** FFT(): not a transform but the palette flashing with the shape of the wave. */
  private fft(): void {
    const slab = this.slab;
    slab.fill(0);
    let lastgot = 128;
    let lens = 0;
    let lastd = 1;
    let lastcapc = 128;
    let nextonec = 1;
    for (let channel = 0; channel < 2; channel += 1) {
      for (let i = 0; i < WIDTH; i += 1) {
        const got = this.stereo[2 * i + channel]!;
        const dir = got - lastgot;
        const currentd = dir > 1 ? 1 : dir < -1 ? -1 : lastd;
        if (currentd !== lastd) {
          if (lens > 255) lens = 255;
          lens >>= 3;
          slab[lens] = slab[lens]! + (lens >> 1);
          lens = 0;
          if (nextonec === 1) {
            nextonec = 0;
            lastcapc = got;
          } else {
            nextonec = 1;
            let amt = Math.abs(lastcapc - got);
            if (amt > 127) amt = 127;
            slab[amt >> 2] = slab[amt >> 2]! + 1;
          }
        } else {
          lens += 1;
        }
        lastd = currentd;
        lastgot = got;
      }
    }
    for (let i = 0; i < 256; i += 1) {
      let temp = slab[(255 - i) >> 3]!;
      if (temp > 6) temp = 6;
      const q = this.luts[(this.curpal + temp) % this.luts.length]!;
      this.lut[3 * i] = q[3 * i]!;
      this.lut[3 * i + 1] = q[3 * i + 1]!;
      this.lut[3 * i + 2] = q[3 * i + 2]!;
    }
  }

  /** draw_text(): into the buffer (it burns), upside down unless the display is "Upwards". */
  private drawText(xpos: number, ypos: number, size: number, colour: number, text: string): void {
    const charset = this.lib.charset;
    for (const char of text) {
      const code = char.charCodeAt(0) & 255;
      for (let row = 0; row < 14; row += 1) {
        const bits = charset[code * 14 + row]!;
        const y = ypos + row * size;
        for (let col = 0; col < 8; col += 1) {
          if (!(bits & (0x80 >> col))) continue;
          const x = xpos + col * size;
          for (let i = 0; i < size; i += 1) {
            for (let j = 0; j < size; j += 1) {
              const yy = this.curdisplay ? 199 - (y + i) : y + i;
              if (yy >= 0 && yy < H) this.buff[yy * WIDTH + x + j] = colour;
            }
          }
        }
      }
      xpos += size * 8;
    }
  }

  /** display(): the buffer to the screen. */
  private display(): void {
    const b = this.buff;
    const s = this.screen;
    switch (this.curdisplay) {
      case 1: // Downwards (DISPLAY.C copied each line one down; turned over here)
        for (let y = 0; y < 200; y += 1) s.set(b.subarray((199 - y) * WIDTH, (200 - y) * WIDTH), y * WIDTH);
        break;
      case 2: // Hor. Split out
        for (let y = 99, row = 0; y >= 0; y -= 1, row += 1) s.set(b.subarray((y + 100) * WIDTH, (y + 101) * WIDTH), row * WIDTH);
        s.set(b.subarray(100 * WIDTH, 200 * WIDTH), 100 * WIDTH);
        break;
      case 3: // Hor. Split in
        s.set(b.subarray(100 * WIDTH, 200 * WIDTH), 0);
        for (let y = 99, row = 100; y >= 0; y -= 1, row += 1) s.set(b.subarray((y + 100) * WIDTH, (y + 101) * WIDTH), row * WIDTH);
        break;
      case 4: // Kaleidescope (its lower half began a line too low; mirrored exactly here)
        for (let y = 0; y < 100; y += 1) {
          const src = (y + 100) * WIDTH;
          const top = y * WIDTH;
          const bottom = (199 - y) * WIDTH;
          for (let x = 0; x < 160; x += 1) {
            const v = b[src + x]!;
            const m = b[src + 159 - x]!;
            s[top + x] = v;
            s[bottom + x] = v;
            s[top + 160 + x] = m;
            s[bottom + 160 + x] = m;
          }
        }
        break;
      case 5: // 90deg rot. mirror
        for (let y = 0; y < 200; y += 1) {
          for (let x = 0; x < 160; x += 1) s[y * WIDTH + x] = b[x * WIDTH + y]!;
          for (let x = 160; x < 320; x += 1) s[y * WIDTH + x] = b[(320 - x) * WIDTH + y]!;
        }
        break;
      case 6: { // 90deg rot. mirror 2
        let puff = 64000;
        let at = 0;
        for (let y = 0; y < 200; y += 1) {
          for (let x = 0; x < 160; x += 1) {
            s[at++] = b[puff & 0xffff]!;
            puff -= WIDTH;
          }
          for (let x = 160; x < 320; x += 1) {
            s[at++] = b[puff & 0xffff]!;
            puff += WIDTH;
          }
          puff -= 1;
        }
        break;
      }
      case 7: { // 90deg Kaleidescope (its point-mirrored half began a pixel off; exact here)
        let puff = 0;
        let at = 0;
        let duff = 63999;
        for (let y = 0; y < 100; y += 1) {
          for (let x = 0; x < 160; x += 1) {
            const v = b[puff]!;
            s[at++] = v;
            s[duff--] = v;
            puff += WIDTH;
          }
          for (let x = 160; x < 320; x += 1) {
            const v = b[puff]!;
            s[at++] = v;
            s[duff--] = v;
            puff -= WIDTH;
          }
          puff += 1;
        }
        break;
      }
      default: // Upwards
        s.set(b.subarray(0, 64000), 0);
    }
  }

  /** The screen through the DAC: RGBA. */
  paint(rgba: Uint8ClampedArray): void {
    const lut = this.lut;
    const colours = this.rgba;
    for (let i = 0; i < 256; i += 1) {
      const r = lut[3 * i]! & 63;
      const g = lut[3 * i + 1]! & 63;
      const bl = lut[3 * i + 2]! & 63;
      colours[i] = (255 << 24 | ((bl << 2) | (bl >> 4)) << 16 | ((g << 2) | (g >> 4)) << 8 | ((r << 2) | (r >> 4))) >>> 0;
    }
    const out = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
    const screen = this.screen;
    const n = Math.min(out.length, screen.length);
    for (let i = 0; i < n; i += 1) out[i] = colours[screen[i]!]!;
  }
}
