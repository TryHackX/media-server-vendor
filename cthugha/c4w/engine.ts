/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; based on Cthugha by Kevin "Zaph" Burfitt and
 * Cthugha-L by Harald Deischinger; free for personal use (vis_sh.txt); never committed.
 *
 * Vis_sh.dll's Init (10009930) and Render (1000A880), one Render per step, with the random
 * changer (1000BCD0), the displays (1000BE50), the palettes (palettes.cpp), the pictures
 * (pics.cpp), the translations (translations.cpp) and the song title: the 3D letters spelling it
 * at the start of a song and the title written into the flames on the beat.
 *
 * A frame (Render): Justin Frankel's beat detection — the loudest of the first eight spectrum
 * bins of both channels rising through Beat_detection_sensitivity (200) — counts beats: every
 * 8th changes the effect at random, every 16th writes a part of the title into the buffer in
 * one of four fonts, every 32nd shows a picture. Then the buffers swap, the flame runs, then the
 * translation, the picture, the wave, the title; the display copies the buffer to the 8-bit
 * screen, whose palette the changer set.
 *
 * Kept as it ran: the effect, palette and translation chosen with the C runtime's rand() after
 * srand(seed) (time(0) in the plug-in); the translation that comes on is the one loaded at the
 * previous change; a translation always comes with the Clear flame; the letters' interval is
 * Frequency_Random_Change · 8 + 492 ms; the forbidden-effects test lets the last field of an
 * entry decide; a title that fits only at 8 pixels is not written at all.
 */

import { textMask, type TextFace } from "../../../src/shared/visualizations/retro/cthughalike/lettering";
import { hasLocalFont, localTextMask } from "../../../src/shared/visualizations/retro/cthughalike/local-font";
import { LETTERS, PALETTES, PICTURES, WAVE_TAIL } from "./data";
import { GDI_FONTS } from "./gdi-fonts";
import { FLAMES, PAD, type Buffers } from "./flames";
import { decodeGif } from "./gif";
import { MsRandom } from "./random";
import { builtInTabs, convertTable, extraTabs, ftol, LazyTab, rawTable, type TabSource } from "./tabs";
import { colourTables, OBJECTS_WAVE, WAVE_NAMES, WaveFault, Waves } from "./waves";

/** The display table (records at 10025098: no function, the 8-bit code switches on the index). */
export const DISPLAYS: readonly string[] = ["Normal 1x1", "Kaleidoscope 2x2", "Weidth 2x1", "Height 1x2"];

/** The Resolution setting's sizes (100026B0) with the title surface (100CB538 × 100CAA30). */
export const RESOLUTIONS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "640x480": [640, 480, 300, 150],
  "640x400": [640, 400, 300, 150],
  "320x240": [320, 240, 150, 75],
  "320x200": [320, 200, 150, 75],
  "160x120": [160, 120, 100, 60]
};

/**
 * The fonts of 10007E70 (CreateFont with a cell height, FW_NORMAL, DEFAULT_QUALITY), with GDI's own
 * metrics and advances (gdi-fonts.ts). The TrueType three are drawn in the viewer's own copy when
 * the browser has it (local-font.ts: no font ships), as GDI drew on the plug-in's 8-bit surface —
 * without smoothing; Script (Windows' vector font, which browsers do not draw) and any font the
 * viewer lacks, in a stroke face of ours with the font's capital height (H over the em, from GDI).
 */
const FONTS: readonly { name: string; face: TextFace; cap: number; local: "Arial" | "Courier New" | "Times New Roman" | null }[] = [
  { name: "Arial", face: "sans", cap: 0.714, local: "Arial" },
  { name: "Courier New", face: "mono", cap: 0.578, local: "Courier New" },
  { name: "Script", face: "italic", cap: 0.651, local: null },
  { name: "Times New Roman", face: "serif", cap: 0.667, local: "Times New Roman" }
];

const parsedAdvances = new Map<string, { ascii: number[]; latin: number[] | null }>();

/** GDI's advance of each character of `text` in `font` at a requested cell `height` (48…16), as GetTextExtentPoint sums them; null for another height. */
function advances(text: string, font: (typeof FONTS)[number], height: number): number[] | null {
  const size = GDI_FONTS[font.name]?.[height];
  if (!size) return null;
  const key = `${font.name}|${height}`;
  let table = parsedAdvances.get(key);
  if (!table) {
    table = { ascii: size.ascii.split(" ").map(Number), latin: size.latin ? size.latin.split(" ").map(Number) : null };
    parsedAdvances.set(key, table);
  }
  const { ascii, latin } = table;
  return [...text].map((char) => {
    const code = char.codePointAt(0) ?? 63;
    if (code >= 0x20 && code <= 0x7e) return ascii[code - 0x20]!;
    if (latin && code >= 0xa0 && code < 0x180) return latin[code - 0xa0]!;
    // Elsewhere the letter without its accent, else "?" (what an ANSI title showed).
    const base = char.normalize("NFD").codePointAt(0) ?? 63;
    return ascii[(base >= 0x20 && base <= 0x7e ? base : 63) - 0x20]!;
  });
}

/** GetTextExtentPoint's width of `text` in a font `cell` pixels high (0 below 16: never drawn). */
function textWidth(text: string, font: (typeof FONTS)[number], cell: number): number {
  return (advances(text, font, cell) ?? []).reduce((sum, advance) => sum + advance, 0);
}

/** Spectrum (2 × 576), waveform (2 × 576), then the DLL's .data the waves read past the end. */
export const SPECTRUM_AT = 0;
export const WAVEFORM_AT = 1152;

export interface C4wSettings {
  seed: number;
  /** The Resolution setting; 640 × 480 (8-bit full screen) by default, as the plug-in came. */
  resolution?: string;
  /** Wave, Flame, Palette and Transformation at start (the registry's), by name or number. */
  wave?: number;
  flame?: number;
  palette?: string;
  translation?: string;
  /** A display kept through the changes (Display_mode with D; the changer would change it). */
  display?: number;
  /** "Random choice of efects with beat detection" (L); on by default. */
  random?: boolean;
  /** Input: the scope (default) or the analyzer (I). */
  analyzer?: boolean;
  /** WaveScale (H), 1 by default. */
  scale?: number;
  /** Beat_detection_sensitivity, 200 by default. */
  sensitivity?: number;
  /** Show_ID3 (title text on the beat) and Show_3D_song_intro; both on by default. */
  titles?: boolean;
  intro?: boolean;
  /** pics\*.gif shown every 32 beats; on by default (the archive installs two). */
  pictures?: boolean;
  /** Add the tables the \tabs generators make with their default parameters. */
  extraTabs?: boolean;
}

function decode(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

interface Library {
  palettes: { name: string; rgb: Uint8Array }[];
  letters: Map<string, Int32Array>;
  tail: Uint8Array;
}

let cache: Library | null = null;
function library(): Library {
  if (cache) return cache;
  const letters = new Map<string, Int32Array>();
  for (const [key, flat] of Object.entries(LETTERS)) letters.set(key, Int32Array.from(flat));
  cache = {
    palettes: PALETTES.map(([name, data]) => ({ name, rgb: decode(data) })),
    letters,
    tail: decode(WAVE_TAIL)
  };
  return cache;
}

/** 1000C620 / 10008010: Winamp's window title cut at every '-' and '.'. */
function titleParts(title: string): string[] {
  return title.split(/[-.]/);
}

export class C4wEngine {
  readonly w: number;
  readonly h: number;
  private readonly textW: number;
  private readonly textH: number;
  /** Winamp's visdata as the module struct held it (see SPECTRUM_AT, WAVEFORM_AT). */
  readonly mem: Uint8Array;
  private readonly lib = library();
  private readonly random = new MsRandom(1);
  private readonly buffers: Buffers;
  private readonly waves: Waves;
  private readonly screen: Uint8Array;
  private readonly rgba = new Uint32Array(256);
  private readonly settings: C4wSettings;
  // The plug-in's state, named after what it held.
  private wave: number;
  private flame: number;
  private display = 0;
  private palette = 0;
  private tab = 0;
  private nextTab = 0;
  private readonly tabNames: string[];
  private readonly rawTabs: TabSource[];
  private table: Uint32Array;
  private preloaded: Uint32Array;
  private readonly randomOff: boolean;
  private readonly analyzer: boolean;
  private readonly sensitivity: number;
  private readonly frequencyRandom = 8;
  private readonly frequencyId3 = 16;
  private readonly frequencyPic = 32;
  private readonly letterMs: number;
  private countRandom: number;
  private countId3: number;
  private countPic: number;
  private previousMax = 0;
  private picturePending = false;
  private picture = 0;
  private pictureData: Uint8Array | null = null;
  private readonly pictureNames: string[];
  private readonly decodedPictures = new Map<number, Uint8Array>();
  private textPending = false;
  private readonly textSurface: Uint8Array;
  private introOn = false;
  private letterIndex = 0;
  /**
   * The last letter's and the last FPS count's GetTickCount(): 0 at start while the clock read
   * the milliseconds since Windows started, so the first Render already passes both tests.
   */
  private lastLetterMs = -1e9;
  private introTitle = "";
  /** Milliseconds of the plug-in's clock (GetTickCount): 25 a frame. */
  private clock = 0;
  private frames = 0;
  private fpsMs = -1e9;
  private fps = 0;
  /** What Winamp's main window said, and the song's position in seconds. */
  private windowTitle = "Winamp";
  private position = 0;
  private faults = 0;
  /** The last title text and picture, for describe() (clock ms). */
  private textAt = -1;
  private textFont = "";
  private pictureAt = -1;

  constructor(settings: C4wSettings) {
    this.settings = settings;
    const [w, h, textW, textH] = RESOLUTIONS[settings.resolution ?? "640x480"] ?? RESOLUTIONS["640x480"]!;
    this.w = w;
    this.h = h;
    this.textW = textW;
    this.textH = textH;
    const lib = this.lib;
    this.mem = new Uint8Array(WAVEFORM_AT + 1152 + lib.tail.length);
    this.mem.set(lib.tail, WAVEFORM_AT + 1152);
    // Init: the tables the first start wrote come before srand(), then srand(time(0)).
    const tabs = builtInTabs();
    this.tabNames = [...tabs.names];
    this.rawTabs = [...tabs.tables];
    if (settings.extraTabs) {
      const more = extraTabs(settings.seed);
      this.tabNames.push(...more.names);
      this.rawTabs.push(...more.tables);
    }
    this.random.srand(settings.seed);
    const colours = colourTables(this.random);
    const size = (h + 2) * w + PAD;
    this.buffers = { w, h, cur: new Uint8Array(size), other: new Uint8Array(size) };
    this.waves = new Waves(this.random, colours, this.mem);
    this.waves.setSize(w, h);
    this.waves.scale = settings.scale ?? 1;
    this.screen = new Uint8Array(w * h);
    this.textSurface = new Uint8Array(textW * textH);
    this.table = new Uint32Array(w * h);
    this.preloaded = new Uint32Array(w * h);
    this.pictureNames = settings.pictures === false ? [] : PICTURES.map(([name]) => name);
    const paletteName = settings.palette ?? "VOLCANO.MAP";
    this.palette = Math.max(0, lib.palettes.findIndex((entry) => entry.name === paletteName));
    this.randomOff = settings.random === false;
    this.analyzer = settings.analyzer === true;
    this.waves.centre = this.analyzer ? 0 : 128;
    this.sensitivity = settings.sensitivity ?? 200;
    this.wave = settings.wave ?? 2;
    this.flame = settings.flame ?? 3;
    this.display = settings.display ?? 0;
    this.countRandom = this.frequencyRandom;
    this.countId3 = this.frequencyId3;
    this.countPic = this.frequencyPic;
    this.letterMs = this.frequencyRandom * 8 + 492;
    const tabs2 = this.tabNames.length;
    this.nextTab = tabs2 ? (this.random.rand() % tabs2) + 1 : 0;
    const wanted = settings.translation ? this.tabNames.indexOf(settings.translation) + 1 : 0;
    this.tab = wanted;
    if (this.tab) convertTable(rawTable(this.rawTabs[this.tab - 1]!), w, h, this.table);
    if (this.nextTab) convertTable(rawTable(this.rawTabs[this.nextTab - 1]!), w, h, this.preloaded);
    if (this.tab) this.flame = 0;
    this.setPalette();
  }

  /** Winamp's state: the song "Title — Artist" and its position in seconds. */
  setTrack(title: string, position: number): void {
    const [name, artist] = title.split(" — ");
    const song = (name ?? "").trim();
    const who = (artist ?? "").trim();
    // The main window's caption, as Winamp wrote it: "1. Artist - Title - Winamp".
    this.windowTitle = song ? `1. ${who ? `${who} - ` : ""}${song} - Winamp` : "Winamp";
    this.position = position;
  }

  private rand(): number {
    return this.random.rand();
  }

  /** 10006020: the palette to the DirectDraw palette (here: to the RGBA lookup). */
  private setPalette(): void {
    const rgb = this.lib.palettes[this.palette]?.rgb;
    for (let i = 0; i < 256; i += 1) {
      const r = rgb ? rgb[3 * i]! : 0;
      const g = rgb ? rgb[3 * i + 1]! : 0;
      const b = rgb ? rgb[3 * i + 2]! : 0;
      this.rgba[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  }

  /** 1000BCD0: a new effect at random. */
  private change(): void {
    const palettes = this.lib.palettes.length;
    this.palette = palettes ? this.rand() % palettes : 0;
    for (;;) {
      this.wave = this.rand() % 20;
      this.flame = this.rand() & 15;
      const r = this.rand() % 6;
      this.display = r < 3 ? 0 : r - 2;
      if (this.allowed()) break;
    }
    if (this.settings.display !== undefined) this.display = this.settings.display;
    const tabs = this.tabNames.length;
    if ((this.rand() & 15) < 6 && tabs) {
      this.flame = 0;
      // The table loaded in the background at the last change comes on; the next is chosen.
      this.tab = this.nextTab;
      const r = this.rand() % tabs;
      const t = this.table;
      this.table = this.preloaded;
      this.preloaded = t;
      this.nextTab = r + 1;
      convertTable(rawTable(this.rawTabs[this.nextTab - 1]!), this.w, this.h, this.preloaded);
    } else {
      this.tab = 0;
    }
    this.setPalette();
  }

  /** 10004BC0 with the Forbidens list as installed: empty, so everything is allowed. */
  private allowed(): boolean {
    return true;
  }

  /** 1000C740: objs\<c>.obj, or false when there is no such file. */
  private loadLetter(char: string | undefined): boolean {
    if (!char) return false;
    const segments = this.lib.letters.get(char.toUpperCase());
    if (!segments) return false;
    this.waves.object = segments;
    return true;
  }

  /** 10007E70: a part of the title, white on black, on the title surface. */
  private makeText(text: string): void {
    const font = FONTS[this.rand() & 3]!;
    this.textAt = this.clock;
    this.textFont = `${font.name} "${text}"`;
    const surface = this.textSurface;
    surface.fill(0);
    // From 48 pixels down by 8 until it fits. The loop selects each font into the DC to measure
    // it; the font CreateFont() makes after the loop (8 smaller) is never selected, so TextOut()
    // writes in the last one measured — the size that fitted — unless that was 8 (then nothing).
    let height = 48;
    let width: number;
    do {
      width = textWidth(text, font, height);
      height -= 8;
    } while (width > this.textW && height > 0);
    if (!height) return;
    height += 8;
    const size = GDI_FONTS[font.name]![height]!;
    const em = size.height - size.internal;
    // Drawn at (0, 0): the baseline `ascent` below the cell's top, each letter where GDI put it.
    const pen = advances(text, font, height)!;
    if (font.local && hasLocalFont(font.local)) {
      const local = localTextMask(text, font.local, em, size.ascent, pen, this.textW, this.textH);
      if (local) {
        surface.set(local);
        this.textFont = `${font.name} (local) "${text}"`;
        return;
      }
    }
    const cap = em * font.cap;
    const mask = textMask(text, font.face, cap);
    // The stroke face as wide as GDI made the text.
    const margin = 2;
    const target = pen.reduce((sum, advance) => sum + advance, 0);
    const inner = Math.max(1, mask.width - 2 * margin);
    const top = Math.round(size.ascent - (margin + (11 * cap) / 10));
    for (let y = 0; y < mask.height; y += 1) {
      const sy = y + top;
      if (sy < 0 || sy >= this.textH) continue;
      for (let x = 0; x < target && x < this.textW; x += 1) {
        const mx = margin + Math.floor(((x + 0.5) * inner) / target);
        if (mask.mask[y * mask.width + mx]! >= 128) surface[sy * this.textW + x] = 1;
      }
    }
  }

  /** pics.cpp: a GIF read (8-bit only), nearest pixel to the buffer's size, top row first. */
  private loadPicture(index: number): Uint8Array | null {
    if (!index) return null;
    const cached = this.decodedPictures.get(index);
    if (cached) return cached;
    const entry = PICTURES.find(([name]) => name === this.pictureNames[index - 1]);
    if (!entry) return null;
    const gif = decodeGif(decode(entry[1]));
    if (!gif || gif.bits !== 8) return null;
    const { w, h } = this;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      const sy = Math.trunc((y * gif.height) / h);
      for (let x = 0; x < w; x += 1) out[y * w + x] = gif.pixels[sy * gif.width + Math.trunc((x * gif.width) / w)]!;
    }
    this.decodedPictures.set(index, out);
    return out;
  }

  /** One Render call (Winamp called it every delayMs = 25 ms). */
  step(): void {
    this.clock += 25;
    const { w, h } = this;
    const mem = this.mem;
    // Justin Frankel's beat detection reads the spectrum's first eight bins of both channels.
    let max = 0;
    for (let i = 0; i < 8; i += 1) {
      if (mem[SPECTRUM_AT + i]! > max) max = mem[SPECTRUM_AT + i]!;
      if (mem[SPECTRUM_AT + 576 + i]! > max) max = mem[SPECTRUM_AT + 576 + i]!;
    }
    // The 3D song intro: a letter of the title every letterMs while the song is young.
    if (this.settings.intro !== false && this.clock - this.lastLetterMs > this.letterMs) {
      this.lastLetterMs = this.clock;
      if (this.position >= 10 && this.letterIndex === 0 && this.wave !== OBJECTS_WAVE) {
        if (this.introOn) {
          this.change();
          this.introOn = false;
        }
      } else {
        if (!this.introOn) {
          this.introOn = true;
          this.letterIndex = -1;
          if (this.wave !== OBJECTS_WAVE) {
            this.change();
            this.wave = OBJECTS_WAVE;
          }
          const parts = titleParts(this.windowTitle);
          this.introTitle = parts.length <= 2 ? parts[0]! : parts.slice(1, -1).map((part) => ` ${part}`).join("");
        }
        max = 255;
        this.previousMax = 0;
        this.countId3 = 1;
        this.letterIndex += 1;
        for (;;) {
          if (this.letterIndex > this.introTitle.length) {
            this.letterIndex = 0;
            this.change();
            break;
          }
          if (this.loadLetter(this.introTitle[this.letterIndex])) break;
          this.letterIndex += 1;
        }
      }
    }
    if (max > this.sensitivity && this.previousMax <= this.sensitivity) {
      if (!this.introOn && !this.randomOff) {
        this.countRandom -= 1;
        if (this.countRandom === 0) {
          this.countRandom = this.frequencyRandom;
          this.change();
        }
      }
      if (this.settings.titles !== false) {
        this.countId3 -= 1;
        if (this.countId3 === 0) {
          this.countId3 = this.frequencyId3;
          this.textPending = true;
          const parts = titleParts(this.windowTitle);
          const text = parts.length > 2 ? parts[1 + (this.rand() % (parts.length - 2))]! : parts[0]!;
          this.makeText(text);
        }
      }
      this.countPic -= 1;
      if (this.countPic === 0) {
        this.countPic = this.frequencyPic;
        this.picturePending = true;
      }
    }
    this.previousMax = max;
    // The analyzer's spectrum, its highs lifted (i + 220) / 220, in place.
    let data = WAVEFORM_AT;
    if (this.analyzer) {
      for (let i = 0; i < 1152; i += 1) {
        const v = (((i % 576) + 220) * mem[SPECTRUM_AT + i]!) * 0.004545454401522875;
        mem[SPECTRUM_AT + i] = v > 255 ? 255 : ftol(v);
      }
      data = SPECTRUM_AT;
    }
    const b = this.buffers;
    const swap = b.cur;
    b.cur = b.other;
    b.other = swap;
    FLAMES[this.flame]?.run(b);
    if (this.tab) this.translate();
    if (this.picturePending) {
      if (this.picture) {
        const pic = this.pictureData;
        if (pic) b.cur.set(pic);
        this.pictureAt = this.clock;
        this.picturePending = false;
      }
      const pictures = this.pictureNames.length;
      this.picture = pictures ? (this.rand() % pictures) + 1 : 0;
      this.pictureData = this.loadPicture(this.picture);
    }
    try {
      this.waves.draw(this.wave, b.cur, data);
    } catch (error) {
      if (!(error instanceof WaveFault)) throw error;
      this.faults += 1;
    }
    this.wave = this.waves.wave;
    b.cur.fill(0, w * h, w * h + w);
    if (this.textPending) {
      const x0 = this.rand() % (w - this.textW);
      const y0 = this.rand() % (h - this.textH);
      const text = this.textSurface;
      for (let y = 0; y < this.textH; y += 1) {
        const row = (y0 + y) * w + x0;
        for (let x = 0; x < this.textW; x += 1) if (text[y * this.textW + x]) b.cur[row + x] = 255;
      }
      this.textPending = false;
    }
    this.frames += 1;
    if (this.clock - this.fpsMs > 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.fpsMs = this.clock;
    }
    this.show();
  }

  /** 100080B0: every pixel from where the table says, darkened by its blend. */
  private translate(): void {
    const { w, h } = this;
    const src = this.buffers.other;
    const dst = this.buffers.cur;
    const table = this.table;
    src[0] = 0;
    for (let i = 0, n = (h - 1) * w - 1, o = w + 1; i < n; i += 1, o += 1) {
      const v = table[i]!;
      const c = src[v & 0xffffff]!;
      const blend = v >>> 24;
      dst[o] = c < blend ? 0 : c - blend;
    }
  }

  /** 1000BE50: the buffer to the screen, as it is or mirrored from every second row/column. */
  private show(): void {
    const { w, h } = this;
    const b = this.buffers.cur;
    const s = this.screen;
    switch (this.display) {
      case 1: // Kaleidoscope 2x2
        for (let row = 0, r = 0; row < h; row += 2, r += 1) {
          const top = r * w;
          const bottom = (h - 1 - r) * w;
          for (let col = 0, c = 0; col < w; col += 2, c += 1) {
            const v = b[row * w + col]!;
            s[top + c] = v;
            s[top + w - 1 - c] = v;
            s[bottom + c] = v;
            s[bottom + w - 1 - c] = v;
          }
        }
        break;
      case 2: // "Weidth 2x1": every second row, mirrored top to bottom
        for (let row = 0, r = 0; row < h; row += 2, r += 1) {
          const line = b.subarray(row * w, row * w + w);
          s.set(line, r * w);
          s.set(line, (h - 1 - r) * w);
        }
        break;
      case 3: // "Height 1x2": every second column, mirrored left to right
        for (let row = 0; row < h; row += 1) {
          const at = row * w;
          for (let col = 0, c = 0; col < w; col += 2, c += 1) {
            const v = b[at + col]!;
            s[at + c] = v;
            s[at + w - 1 - c] = v;
          }
        }
        break;
      default:
        s.set(b.subarray(0, w * h));
    }
  }

  /**
   * Makes the generators' tables a little at a time, in list order, until `deadline`
   * (performance.now()), so choosing one later costs only its conversion.
   */
  prepareTables(deadline: number): void {
    for (const source of this.rawTabs) {
      if (source instanceof LazyTab && !source.work(deadline)) return;
    }
  }

  /** The screen through the palette, as RGBA. */
  paint(out: Uint8ClampedArray): void {
    const pixels = new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
    const s = this.screen;
    const colours = this.rgba;
    const n = Math.min(pixels.length, s.length);
    for (let i = 0; i < n; i += 1) pixels[i] = colours[s[i]!]!;
  }

  /** The plug-in's status line ("Display efect info"), and what else is on. */
  describe(): string {
    const tab = this.tab ? this.tabNames[this.tab - 1] : "";
    const palette = this.lib.palettes[this.palette]?.name ?? "";
    const status = `W: ${WAVE_NAMES[this.wave]![0]}, F: ${FLAMES[this.flame]!.name}, P: ${palette}, T: ${tab}, FPS: ${this.fps}`;
    const intro = this.introOn ? ` intro="${this.introTitle}"@${this.letterIndex}` : "";
    const text = this.textAt >= 0 ? ` text=${this.textFont}@${((this.clock - this.textAt) / 1000).toFixed(2)}s` : "";
    const picture = this.pictureAt >= 0 ? ` picture@${((this.clock - this.pictureAt) / 1000).toFixed(2)}s` : "";
    return `${status} | D: ${DISPLAYS[this.display]}${intro}${text}${picture}${this.faults ? ` faults=${this.faults}` : ""}`;
  }
}
