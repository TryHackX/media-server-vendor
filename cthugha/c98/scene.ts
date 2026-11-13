/**
 * Cthugha98 0.6a as scenes of "Klasyka retro": the 2D build (DirectDraw, 640 × 480 in 256
 * colours) and the 3Dfx build (Glide, the buffer as a height field or the special's particles
 * as points, 640 × 480). Ported from the executables by static analysis (SOURCE.md).
 * Cthugha (c) 1993-1998 Kevin "Zaph" Burfitt, Torps Productions. Postcardware, non-commercial
 * use only, with credit. Never committed.
 *
 * The sound came from waveIn, 44.1 kHz stereo, 8 bits, in blocks of 1024: each frame read the
 * newest block (no trigger, unlike 5.3). Here the newest 1024 samples at 44.1 kHz, the music's
 * peaks brought to about 80 % of the 8-bit range, as a line-in set by hand; silence stays silent.
 * The 2D build had no frame limit (the title showed its rate); it runs here at 30 frames a
 * second, about what a 300 MHz Pentium II made of 640 × 480. The 3Dfx build waited for the 60 Hz
 * retrace and paced itself to 16 ms: 60 frames a second, as here.
 */

import type { PixelImage, RetroFrame, RetroScene } from "../../../src/shared/visualizations/retro/types";
import { C98Engine, DISPLAYS } from "./engine";
import { createPrimitives, GLIDE_HEIGHT, GLIDE_WIDTH, GlideState, GlideView } from "./glide";

const RATE = 44100;
const SAMPLES = 1024;

function seed(): number {
  const fixed = (globalThis as { cthughaSeed?: number }).cthughaSeed;
  return (fixed ?? (Date.now() & 0x7fffffff)) >>> 0;
}

/** The sound card: the newest 1024 samples at 44.1 kHz, unsigned 8-bit, with a hand-set level. */
class LineIn {
  private level = 0;
  private gain = 1;

  feed(frame: RetroFrame): void {
    const audio = frame.audio;
    const peak = Math.max(audio.peakLeft, audio.peakRight);
    if (audio.sounding) this.level += (peak - this.level) * (1 - Math.exp(-frame.dt / (peak > this.level ? 0.15 : 4)));
    const target = this.level > 0.003 ? Math.max(0.5, Math.min(4, 0.8 / this.level)) : 1;
    this.gain += (target - this.gain) * (1 - Math.exp(-frame.dt / 1.5));
  }

  read(frame: RetroFrame, stereo: Uint8Array): void {
    const { left, right, rate } = frame.audio;
    const step = rate / RATE;
    const n = left.length;
    const start = n - Math.ceil(SAMPLES * step);
    const gain = this.gain;
    for (let i = 0; i < SAMPLES; i += 1) {
      const at = Math.min(n - 1, Math.max(0, start + Math.floor(i * step)));
      const l = Math.floor((left[at] ?? 0) * gain * 128) + 128;
      const r = Math.floor((right[at] ?? 0) * gain * 128) + 128;
      stereo[2 * i] = l < 0 ? 0 : l > 255 ? 255 : l;
      stereo[2 * i + 1] = r < 0 ? 0 : r > 255 ? 255 : r;
    }
  }
}

function displayIndex(display?: string): number | undefined {
  if (!display) return undefined;
  const index = DISPLAYS.findIndex((entry) => entry.name === display);
  return index >= 0 ? index : undefined;
}

/** The 2D build. `display` keeps one display (a personal setting could). */
export function createC98Scene(options: { display?: string } = {}): RetroScene & { describe(): string } {
  const engine = new C98Engine({ seed: seed(), screenWidth: 640, screenHeight: 480, display: displayIndex(options.display) });
  const line = new LineIn();
  const fps = 30;
  let pending = 0;
  let dirty = true;
  let painted: PixelImage | null = null;
  return {
    width: 640,
    height: 480,
    aspect: 4 / 3,
    crt: "none",
    render(frame: RetroFrame, image: PixelImage): void {
      line.feed(frame);
      pending += frame.dt;
      if (pending > 0.25) pending = 1 / fps;
      for (let steps = 0; pending >= 1 / fps && steps < 3; steps += 1) {
        line.read(frame, engine.stereo);
        engine.step();
        pending -= 1 / fps;
        dirty = true;
      }
      if ((dirty || painted !== image) && image.width === 640 && image.height === 480) {
        engine.paint(image.data);
        painted = image;
        dirty = false;
      }
    },
    dispose(): void {
      painted = null;
    },
    describe(): string {
      return engine.describe();
    }
  };
}

/** The 3Dfx build: the same engine on a 256 × 256 screen, shown by Glide (glide.ts) at 60 Hz. */
export function createC98GlideScene(options: { display?: string } = {}): RetroScene & { surface(): CanvasImageSource; describe(): string } {
  const engine = new C98Engine({ seed: seed(), screenWidth: 256, screenHeight: 256, display: displayIndex(options.display) });
  const line = new LineIn();
  const canvas = document.createElement("canvas");
  const view = new GlideView(canvas);
  const state = new GlideState();
  const primitives = createPrimitives();
  const fps = 60;
  let pending = 0;
  let drawn = false;
  return {
    width: GLIDE_WIDTH,
    height: GLIDE_HEIGHT,
    aspect: 4 / 3,
    crt: "none",
    render(frame: RetroFrame): void {
      line.feed(frame);
      pending += frame.dt;
      if (pending > 0.25) pending = 1 / fps;
      for (let steps = 0; pending >= 1 / fps && steps < 3; steps += 1) {
        line.read(frame, engine.stereo);
        engine.step();
        state.frame({
          buffer: engine.blit.source,
          palette: engine.palette,
          flipped: engine.blit.flipped,
          special: engine.special,
          particles: engine.specials.particles,
          width: engine.screenW,
          height: engine.screenH
        }, primitives);
        pending -= 1 / fps;
        drawn = true;
      }
      // The canvas is not kept between frames: draw the last Glide frame again every time.
      if (drawn) view.frame(primitives);
    },
    surface(): CanvasImageSource {
      return canvas;
    },
    dispose(): void {
      view.dispose();
      canvas.width = 0;
      canvas.height = 0;
    },
    describe(): string {
      return engine.describe();
    }
  };
}
