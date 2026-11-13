/**
 * Cthugha for "Klasyka retro": a scene (shared/visualizations/retro/types.ts) for each preset of
 * catalog.ts. The "Cthugha 5.3" presets run the port of the DOS original (dos/, 70 frames a
 * second, 320 × 200); the "glcthugha" ones Cthugha-L's OpenGL program (gl/); "Cthugha98" the
 * port of Cthugha98 0.6a and its 3Dfx build (c98/); "Cthugha-4-Winamp" the port of the Winamp
 * plug-in 1.50 (c4w/); the others the port of Cthugha-L 1.4 (engine.ts) at its 25 a second.
 * Cthugha98 and Cthugha-4-Winamp were ported from their executables by static analysis.
 *
 * Cthugha - Audio Seeded Image Processing: Kevin "Zaph" Burfitt, Torps Productions 1993-1998.
 * Cthugha-L: Copyright 1995-97 Harald Deischinger. Cthugha-4-Winamp: Krunoslav Pisacic 1998.
 * Free for non-commercial or personal use, with credit; not for commercial use without
 * permission (COPYING-cthugha-L.txt, COPYING-cthugha-53.txt, SOURCE.md).
 * This folder is never committed to the player's repository.
 *
 * - "Cthugha 5.3 (DOS)" changes everything as 5.3 did; its other two presets keep one display.
 * - "glcthugha" is Cthugha-L's OpenGL program (gl/): its 3D displays drawn with WebGL 2; the
 *   others of its presets keep one display.
 * - "Cthugha-L" fills the panel as Cthugha-L filled any window: a buffer of 150 lines as wide
 *   as the panel's shape asks, shown at twice its size each way (the fourfold mirror).
 * - "Cthugha-L · 320 × 200" is its default buffer of 160 × 100, on a 4:3 screen.
 * - The others lock the display (a CoreOption's lock), the rest changing as it always did.
 * The input level follows the music gently, as a sound card's line-in was set by hand; silence
 * stays silent. A new track brings one of the pictures, as pressing 'x' did.
 */

import { VGA } from "../../src/shared/visualizations/retro/trackers/fonts";
import { sheet } from "../../src/shared/visualizations/retro/trackers/raster";
import type { PixelImage, RetroFrame, RetroScene } from "../../src/shared/visualizations/retro/types";
import type { C4wOptions } from "./c4w/scene";
import { Engine, type OptionName, type TextFont } from "./engine";
import { readSound } from "./sound";

const FPS = 25;
/** The flexible presets' buffer height (the screen is twice as tall). */
const FLEX_HEIGHT = 150;

interface Mode {
  classic: boolean;
  locked?: Partial<Record<OptionName, string>>;
}

const MODES: Record<string, Mode> = {
  "cthugha-l": { classic: false },
  "cthugha-l-320x200": { classic: true },
  "cthugha-l-kaleidoscope": { classic: false, locked: { display: "4hor" } },
  "cthugha-l-90kal": { classic: false, locked: { display: "4kal" } },
  "cthugha-l-roll": { classic: false, locked: { display: "roll" } },
  "cthugha-l-heightfield": { classic: false, locked: { display: "hfield" } },
  "cthugha-l-bent": { classic: false, locked: { display: "bent" } },
  "cthugha-l-plate": { classic: false, locked: { display: "plate" } }
};

let font: TextFont | null = null;
function vgaFont(): TextFont {
  if (font) return font;
  const vga = sheet(VGA.sheet, VGA.cell, VGA.height, VGA.fixed);
  font = { width: vga.width, height: vga.height, glyph: (char) => vga.glyphs.get(char)?.rows };
  return font;
}

/** Cthugha 5.3's presets: the display a personal CTHUGHA.INI line would keep, or none. */
const DOS_MODES: Record<string, string | undefined> = {
  "cthugha-53": undefined,
  "cthugha-53-upwards": "Upwards",
  "cthugha-53-kaleidescope": "Kaleidescope"
};

/** glcthugha's presets: the display a "locked:" option would keep, or none. */
const GL_MODES: Record<string, string | undefined> = {
  "cthugha-l-gl": undefined,
  "cthugha-l-gl-tube": "Tube",
  "cthugha-l-gl-sheight": "SHeight",
  "cthugha-l-gl-nearring": "NearRing",
  "cthugha-l-gl-2planes": "2Planes",
  "cthugha-l-gl-cross": "Cross"
};

/** Cthugha98's presets: the build and the display a personal setting would keep, or none. */
const C98_MODES: Record<string, { build: "2d" | "3dfx"; display?: string }> = {
  "c98-auto": { build: "2d" },
  "c98-kaleido": { build: "2d", display: "Kaleidescope" },
  "c98-3dfx": { build: "3dfx" },
  "c98-3dfx-low": { build: "3dfx", display: "Downwards" }
};

/** Cthugha-4-Winamp's presets: the plug-in's settings (c4w/scene.ts C4wOptions). */
const C4W_MODES: Record<string, C4wOptions> = {
  "c4w-auto": {},
  "c4w-quad": { display: "Kaleidoscope 2x2" },
  "c4w-mirror": { display: "Weidth 2x1" },
  "c4w-analyzer": { analyzer: true },
  "c4w-320": { resolution: "320x240" },
  "c4w-tabs": { extraTabs: true }
};

export function createCthughaScene(id: string): RetroScene | Promise<RetroScene> {
  // Cthugha98 and Cthugha-4-Winamp are chunks of their own, fetched when shown.
  const c98 = C98_MODES[id];
  if (c98) {
    return import("./c98/scene").then((scene) =>
      c98.build === "3dfx" ? scene.createC98GlideScene({ display: c98.display }) : scene.createC98Scene({ display: c98.display })
    );
  }
  const c4w = C4W_MODES[id];
  if (c4w) return import("./c4w/scene").then((scene) => scene.createC4wScene(c4w));
  // Cthugha 5.3 is a chunk of its own (its pictures and tables are large), fetched when shown.
  if (id in DOS_MODES) return import("./dos/scene").then((dos) => dos.createDosScene(DOS_MODES[id]));
  // glcthugha draws with WebGL 2; without it the scene fails to start and leaves the list.
  if (id in GL_MODES) return import("./gl/scene").then((gl) => gl.createGlScene({ display: GL_MODES[id] }));
  return createCthughaL(id);
}

function createCthughaL(id: string): RetroScene {
  const mode = MODES[id] ?? MODES["cthugha-l"]!;
  let bufferWidth = 160;
  let bufferHeight = 100;
  if (!mode.classic) {
    bufferHeight = FLEX_HEIGHT;
    bufferWidth = 268;
  }
  let engine: Engine | null = null;
  // A seed of the moment, as Cthugha-L's srand(time); the offline renders set their own.
  const fixed = (globalThis as { cthughaSeed?: number }).cthughaSeed;
  let seed = (fixed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff))) >>> 0;
  let pending = 0;
  let title: string | null = null;
  let gain = 1;
  let level = 0;
  let painted: PixelImage | null = null;
  let dirty = true;

  const build = (): Engine => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const made = new Engine({ width: bufferWidth, height: bufferHeight, seed, locked: mode.locked });
    dirty = true;
    return made;
  };

  return {
    get width(): number {
      return 2 * bufferWidth;
    },
    get height(): number {
      return 2 * bufferHeight;
    },
    aspect: mode.classic ? 4 / 3 : 0,
    crt: "none",
    resize(panelWidth: number, panelHeight: number): void {
      if (mode.classic || !(panelWidth > 0 && panelHeight > 0)) return;
      // As wide as the panel's shape asks, in steps of four (the flames work four bytes at a time).
      const width = Math.max(64, Math.min(1024, Math.round((FLEX_HEIGHT * panelWidth) / panelHeight / 4) * 4));
      if (width !== bufferWidth) {
        bufferWidth = width;
        engine = null;
      }
    },
    render(frame: RetroFrame, image: PixelImage): void {
      if (!engine || engine.ctx.W !== bufferWidth) engine = build();
      const audio = frame.audio;
      // The input level: quiet records brought up to a lively line-in, never more than threefold.
      const loud = Math.max(audio.rmsLeft, audio.rmsRight);
      if (audio.sounding) level += (loud - level) * (1 - Math.exp(-frame.dt / (loud > level ? 0.4 : 6)));
      const target = level > 0.003 ? Math.max(1, Math.min(3, 0.18 / level)) : 1;
      gain += (target - gain) * (1 - Math.exp(-frame.dt / 1.5));
      // A new track: a picture, as the 'x' key brought one.
      if (frame.track.title !== title) {
        if (title !== null && frame.track.title) engine.showPicture(1 + (engine.ctx.random.rand() % 6));
        title = frame.track.title;
      }
      pending += frame.dt;
      if (pending > 0.25) pending = 1 / FPS;
      for (let steps = 0; pending >= 1 / FPS && steps < 2; steps += 1) {
        readSound(engine.ctx.sound, audio.left, audio.right, gain);
        engine.step();
        pending -= 1 / FPS;
        dirty = true;
      }
      if (dirty || painted !== image) {
        if (image.width === engine.ctx.screenWidth && image.height === engine.ctx.screenHeight) {
          engine.paint(image.data, vgaFont());
          painted = image;
          dirty = false;
        }
      }
    },
    dispose(): void {
      engine = null;
      painted = null;
    },
    /** The engine's options of the moment, for the offline renders. */
    describe(): string {
      return engine?.describe() ?? "";
    }
  } as RetroScene & { describe(): string };
}
