/**
 * Cthugha-L 1.4's main loop (src/initExitDisp.cc run(), src/CthughaBuffer.cc,
 * src/AutoChanger.cc, src/CoreOption.cc, src/Flashlight.cc, src/pcx.cc show_pcx()) for one
 * buffer. Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald
 * Deischinger; smooth_palette by Stanislav V. Voronyi. Non-commercial use only, with credit
 * (COPYING-cthugha-L.txt).
 *
 * Every frame: the sound is analysed; the auto changer may change everything at random (after
 * 5–15 s, after enough attacks, or when the music comes back after a pause); then the buffer is
 * run — sound process, flashlight, border, flame, translation, wave, palette smoothing — and the
 * display draws it to the screen. Twenty-five times a second, as Cthugha-L ran.
 */

import { Context, CRandom } from "./context";
import { Displays, SCREENS } from "./display";
import { FLAMES, newFlameState } from "./flames";
import { library } from "./palettes";
import { SOUND_PROCESSES } from "./sound";
import { TRANSLATIONS, Translator } from "./translate";
import { OBJECTS, Waves } from "./waves";

/** C's mod(): handles negative arguments and a zero modulo. */
function mod(a: number, m: number): number {
  if (m <= 0) return a;
  const r = a % m;
  return r < 0 ? r + m : r;
}

/** A CoreOption: a choice among entries, some not in use, changed at random unless locked. */
export class CoreOption {
  value = 0;
  lock = false;

  constructor(readonly name: string, readonly count: number, private readonly inUse: (index: number) => boolean = () => true) {}

  /** change(by): on by `by`, then on to the next entry in use. */
  change(by: number): void {
    if (this.count === 0) return;
    let any = false;
    for (let i = 0; i < this.count; i += 1) if (this.inUse(i)) any = true;
    if (!any) {
      this.value = 0;
      return;
    }
    this.value = mod(this.value + by, this.count);
    const step = by < 0 ? -1 : 1;
    while (!this.inUse(this.value)) this.value = mod(this.value + step, this.count);
  }

  /** changeRandom(): a random entry (a random number, without entries), unless locked. */
  changeRandom(random: CRandom): void {
    if (this.lock) return;
    this.value = mod(random.rand(), this.count);
    this.change(0);
  }

  /** change(""): what Cthugha-L started with — a random entry. */
  initial(random: CRandom): void {
    if (this.count === 0) return;
    this.value = random.random(this.count);
    this.change(0);
  }

  /** change(name), locked: "locked:name" on the command line. */
  fix(index: number): void {
    if (index < 0 || index >= this.count) return;
    this.value = index;
    this.lock = true;
  }
}

/** AutoChanger's silence strings (the last, "@fortune", ran fortune(6); left out here). */
export const SILENCE = [
  "Where is the music?", "JOLT !", "Turn The Music On", "Lets Party!!!", "Pink Floyd Rules",
  "Sounds of Silence ?", "The Torps", "Study Mathematics", "Visit Linz", "Press ? for help",
  "Number 5 is ALIVE!!", "Spooky Mulder.....", "Math is Power", "Subliminal Ads", "Read a book",
  "Get a life...", "SMILE!", "Cthugha-L", "Don't Panic!"
];

/** The options of one engine, by the names Cthugha-L's command line and ini file used. */
export type OptionName = "display" | "flame" | "palette" | "pcx" | "translate" | "wave" | "object" |
  "flame-general" | "wave-scale" | "table" | "border" | "sound-process" | "flashlight";

export interface EngineSettings {
  /** The buffer: a quarter of the screen. */
  width: number;
  height: number;
  seed: number;
  /** Options locked to an entry, by entry name (a CoreOption's individual lock). */
  locked?: Partial<Record<OptionName, string>>;
  /**
   * One of glcthugha's buffers: no AutoChanger of its own (the scene's changes them all at once)
   * and no 2D display (the OpenGL display shows the buffer as a texture).
   */
  buffer?: boolean;
}

export class Engine {
  readonly ctx: Context;
  private readonly random: CRandom;
  private readonly flame = newFlameState();
  private readonly waves: Waves;
  private readonly displays: Displays;
  private readonly translator: Translator;
  private readonly palettes: readonly { name: string; colours: Uint8Array }[];
  private readonly pictures: ReturnType<typeof library>["pictures"];
  private readonly options: Record<OptionName, CoreOption>;
  private readonly order: readonly CoreOption[];
  /** The palette on screen, smoothed towards the chosen one (CthughaBuffer::currentPalette). */
  private readonly currentPalette = new Uint8Array(768);
  private lastPalette = -1;
  private palChanged = 1;
  private readonly flashPalette = new Uint8Array(768);
  /** gettime(): hundredths of a second since the start. */
  private ticks = 0;
  private quietSince = 0;
  private lastChange = 0;
  private waitTime = 0;
  private message: string | null = null;
  private messageLine = 0;
  private lastObject = -1;
  private readonly lut = new Uint32Array(256);
  private readonly bufferOnly: boolean;

  constructor(settings: EngineSettings) {
    this.bufferOnly = settings.buffer === true;
    this.random = new CRandom(settings.seed);
    this.ctx = new Context(settings.width, settings.height, this.random);
    this.waves = new Waves(this.ctx);
    this.displays = new Displays(this.ctx);
    this.translator = new Translator(this.ctx.W, this.ctx.H, this.random);
    const lib = library();
    this.palettes = lib.palettes;
    this.pictures = lib.pictures;
    this.options = {
      display: new CoreOption("display", SCREENS.length, (i) => SCREENS[i]!.inUse),
      flame: new CoreOption("flame", FLAMES.length, (i) => FLAMES[i]!.inUse),
      palette: new CoreOption("palette", this.palettes.length),
      pcx: new CoreOption("pcx", this.pictures.length + 1),
      translate: new CoreOption("translate", TRANSLATIONS.length),
      wave: new CoreOption("wave", this.waves.list.length),
      object: new CoreOption("object", OBJECTS.length),
      "flame-general": new CoreOption("flame-general", 0),
      "wave-scale": new CoreOption("wave-scale", 3),
      table: new CoreOption("table", 10),
      border: new CoreOption("border", 4),
      "sound-process": new CoreOption("sound-process", SOUND_PROCESSES.length),
      flashlight: new CoreOption("flashlight", 2)
    };
    this.order = Object.values(this.options);
    // changeToInitial(): everything at random, then the locks of the preset.
    for (const option of this.order) option.initial(this.random);
    for (const [name, entry] of Object.entries(settings.locked ?? {}) as [OptionName, string][]) {
      const option = this.options[name];
      option.fix(this.entryIndex(name, entry));
    }
    // AutoChanger(): the first wait, 5–15 s.
    this.waitTime = 500 + (this.random.rand() % 1000);
    this.currentPalette.set(this.palettes[this.options.palette.value]!.colours);
  }

  private entryIndex(name: OptionName, entry: string): number {
    const names: Partial<Record<OptionName, readonly string[]>> = {
      display: SCREENS.map((s) => s.name),
      flame: FLAMES.map((f) => f.name),
      wave: this.waves.list.map((w) => w.name),
      translate: TRANSLATIONS.map((t) => t.name),
      palette: this.palettes.map((p) => p.name),
      "sound-process": SOUND_PROCESSES.map((s) => s.name),
      flashlight: ["off", "on"]
    };
    const list = names[name];
    const index = list ? list.indexOf(entry) : -1;
    return index >= 0 ? index : Number.parseInt(entry, 10);
  }

  /** The options of the moment, as Cthugha-L's status line named them (for testing). */
  describe(): string {
    const o = this.options;
    return [
      `display=${SCREENS[o.display.value]!.name}`, `flame=${FLAMES[o.flame.value]!.name}`,
      `wave=${this.waves.list[o.wave.value]!.name}`, `palette=${this.palettes[o.palette.value]!.name}`,
      `translate=${TRANSLATIONS[o.translate.value]!.name}`, `table=${o.table.value}`,
      `scale=${o["wave-scale"].value}`, `border=${o.border.value}`,
      `process=${SOUND_PROCESSES[o["sound-process"].value]!.name}`, `flash=${o.flashlight.value}`,
      `amp=${this.ctx.analysis.amplitude}`
    ].join(" ");
  }

  /** glcthugha: the buffer on screen, BUFF_WIDTH × BUFF_HEIGHT palette indices from its first line. */
  pixels(): Uint8Array {
    const { passive, BASE, SIZE } = this.ctx;
    return passive.subarray(BASE, BASE + SIZE);
  }

  /** The buffer's colours of the moment (smoothed towards its palette, flashlit). */
  colours(): Uint8Array {
    return this.currentPalette;
  }

  /** The pcx option: 0 for no picture, else 1 + the picture's index in library(). */
  get picture(): number {
    return this.options.pcx.value;
  }

  /** CoreOption::changeAll(): every option (not locked) at random. */
  changeAll(): void {
    for (const option of this.order) option.changeRandom(this.random);
  }

  /** The 'x' key: the next picture into both buffers, in its own colours for a moment. */
  showPicture(index?: number): void {
    const pcx = this.options.pcx;
    pcx.value = index !== undefined ? mod(index, pcx.count) : mod(pcx.value + 1, pcx.count);
    if (pcx.value === 0) pcx.value = 1;
    const picture = this.pictures[pcx.value - 1];
    if (!picture) return;
    const { W, H, BASE } = this.ctx;
    const x = Math.trunc((W - picture.width) / 2);
    const y = Math.trunc((H - picture.height) / 2);
    // show_pcx() drew a picture taller than the buffer from the wrong line; centred here.
    const rows = Math.min(H, picture.height);
    const fromRow = y < 0 ? -y : 0;
    const toRow = y < 0 ? 0 : y;
    for (const buffer of [this.ctx.active, this.ctx.passive]) {
      for (let i = 0; i < rows; i += 1) {
        const source = (fromRow + i) * picture.width;
        const target = BASE + (toRow + i) * W;
        if (x > 0) buffer.set(picture.pixels.subarray(source, source + picture.width), target + x);
        else buffer.set(picture.pixels.subarray(source - x, source - x + W), target);
      }
    }
    if (picture.palette >= 0) this.setPalette(this.palettes[picture.palette]!.colours);
  }

  private setPalette(colours: Uint8Array): void {
    this.currentPalette.set(colours);
    this.palChanged = 1;
  }

  /** CthughaBuffer::smoothPalette(): at most 128/fps a frame nearer the chosen palette. */
  private smoothPalette(): void {
    const value = this.options.palette.value;
    if (this.lastPalette === value && this.palChanged === 0) return;
    this.lastPalette = value;
    const desired = this.palettes[value]!.colours;
    const maxChange = Math.max(Math.trunc(128 / this.ctx.fps), 1);
    let changed = 768;
    const current = this.currentPalette;
    for (let i = 0; i < 768; i += 1) {
      let d = desired[i]! - current[i]!;
      if (d === 0) changed -= 1;
      else {
        if (d < -maxChange) d = -maxChange;
        else if (d > maxChange) d = maxChange;
        current[i] = current[i]! + d;
      }
    }
    this.palChanged = changed;
  }

  /** AutoChanger::operator()(). */
  private autoChange(): void {
    const now = this.ticks;
    const analysis = this.ctx.analysis;
    const quietLength = now - this.quietSince;
    if (analysis.noisy) this.quietSince = now;
    // Long quietness: a message.
    if (!analysis.noisy && quietLength > 500) {
      this.quietSince = now;
      this.message = SILENCE[this.random.rand() % SILENCE.length]!;
      this.messageLine = this.random.rand() % Math.max(1, (this.ctx.screenHeight >> 3) - 5);
    }
    // Interrupted silence (like the pause between two tracks on a CD).
    if (analysis.noisy && quietLength > 150) {
      this.changeAll();
      return;
    }
    // Enough fire to change.
    if (analysis.fireLevel > 1000) {
      analysis.fireLevel = 0;
      this.changeAll();
      return;
    }
    // Nothing special happened; maybe we waited long enough.
    if (now - this.lastChange > this.waitTime) {
      this.lastChange = now;
      this.waitTime = 500 + (this.random.rand() % 1000);
      this.changeAll();
    }
  }

  /** One frame of Cthugha-L; ctx.sound.data holds the newest samples. */
  step(): void {
    const ctx = this.ctx;
    const options = this.options;
    this.ticks += 100 / ctx.fps;
    // glcthugha's buffers share the scene's analysis and AutoChanger (one for all, as in C).
    if (!this.bufferOnly) {
      ctx.analysis.run(ctx.sound, 5);
      this.autoChange();
    }
    if (options.object.value !== this.lastObject) {
      this.lastObject = options.object.value;
      this.waves.objectChanged();
    }

    // CthughaBuffer::run()
    SOUND_PROCESSES[options["sound-process"].value]!.run(ctx.sound);
    if (options.flashlight.value === 1) this.flashlight();
    this.border(options.border.value);
    ctx.doneTranslate = false;
    this.flame.trans = this.translator.table(options.translate.value);
    this.flame.general = options["flame-general"].value;
    FLAMES[options.flame.value]!.run(ctx, this.flame);
    this.translate();
    const drawn = this.waves.draw(options.wave.value, {
      table: options.table.value,
      waveScale: options["wave-scale"].value,
      object: OBJECTS[options.object.value]!.object
    });
    if (!drawn) options.wave.change(1);
    this.smoothPalette();
    ctx.swap();
    if (this.bufferOnly) return;

    // The display: some do not suit the buffer's shape and pass to the next.
    for (let tries = 0; tries < SCREENS.length; tries += 1) {
      if (this.displays.draw(options.display.value)) break;
      options.display.change(1);
    }
    if (SCREENS[options.display.value]!.size === 1) this.displays.mirror();
    if (ctx.analysis.noisy) this.message = null;
  }

  /** Flashlight: the darkest colours light up with the attack of the sound. */
  private flashlight(): void {
    const pal = this.flashPalette;
    pal.set(this.palettes[this.options.palette.value]!.colours);
    for (let l = this.ctx.analysis.fire << 3, i = 0; i < 256 && l > 0; i += 1, l -= 8) {
      for (let j = 0; j < 3; j += 1) pal[3 * i + j] = Math.min(pal[3 * i + j]! + l, 255);
    }
    this.setPalette(pal);
  }

  /** The three lines above and below the buffer, which the flames read. */
  private border(kind: number): void {
    const { W, SIZE, BASE, active } = this.ctx;
    const top = BASE - 3 * W;
    const bottom = BASE + SIZE;
    if (kind === 1) {
      const data = this.ctx.sound.data;
      for (let i = 0; i < 3; i += 1) {
        for (let x = 0; x < W; x += 1) {
          const value = data[x]! & 255;
          active[BASE - (i + 1) * W + x] = value;
          active[bottom + i * W + x] = value;
        }
      }
      return;
    }
    const value = kind === 2 ? this.ctx.analysis.amplitude & 255 : kind === 3 ? 255 : 0;
    active.fill(value, bottom, bottom + 3 * W);
    active.fill(value, top, BASE);
  }

  /** TranslateEntry::operator(): every pixel from where its table says, into the other buffer. */
  private translate(): void {
    const value = this.options.translate.value;
    this.translator.update(value);
    const trans = this.translator.table(value);
    if (!trans || this.ctx.doneTranslate) return;
    const ctx = this.ctx;
    const dst = ctx.passive;
    const src = ctx.active;
    ctx.swap();
    const base = ctx.BASE;
    src[base] = 0;
    const end = (ctx.SIZE >> 2) * 4;
    for (let i = 0; i < end; i += 1) dst[base + i] = src[base + trans[i]!]!;
  }

  /** The screen in colours: RGBA, 2W × 2H, with the silence message on it. */
  paint(rgba: Uint8ClampedArray, font: TextFont | null): void {
    const lut = this.lut;
    const pal = this.currentPalette;
    for (let i = 0; i < 256; i += 1) lut[i] = (255 << 24 | pal[3 * i + 2]! << 16 | pal[3 * i + 1]! << 8 | pal[3 * i]!) >>> 0;
    const out = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
    const screen = this.ctx.screen;
    const n = Math.min(out.length, screen.length);
    for (let i = 0; i < n; i += 1) out[i] = lut[screen[i]!]!;
    if (this.message && font) {
      const width = this.ctx.screenWidth;
      const text = this.message;
      const x0 = Math.max(0, Math.trunc((width - text.length * font.width) / 2));
      const y0 = this.messageLine * font.height;
      // A dark copy a pixel down and right first, as Cthugha 5.3 drew its strings, then the text.
      for (const [dx, colour] of [[1, 0xff000000], [0, 0xffffffff]] as const) {
        for (let c = 0; c < text.length; c += 1) {
          const rows = font.glyph(text[c]!);
          if (!rows) continue;
          for (let row = 0; row < rows.length; row += 1) {
            const bits = rows[row]!;
            const y = y0 + row + dx;
            if (y < 0 || y >= this.ctx.screenHeight) continue;
            for (let col = 0; col < font.width; col += 1) {
              if (!(bits & (1 << (font.width - 1 - col)))) continue;
              const x = x0 + c * font.width + col + dx;
              if (x < width) out[y * width + x] = colour;
            }
          }
        }
      }
    }
  }
}

/** A fixed-width bitmap font for the silence messages: each glyph's rows as bits. */
export interface TextFont {
  readonly width: number;
  readonly height: number;
  glyph(char: string): readonly number[] | undefined;
}
