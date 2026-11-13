/**
 * Cthugha 5.3 (DOS) as a scene of "Klasyka retro": its 320 × 200 screen at 70 frames a second,
 * fed the way a Sound Blaster fed it. Cthugha (c) 1993-1995 Kevin "Zaph" Burfitt, Torps
 * Productions. Non-commercial use only, with credit (COPYING-cthugha-53.txt).
 *
 * The sound card gave 320 stereo samples a frame, unsigned 8-bit, from the moment the left
 * channel crossed upwards through where it began the frame before (get_stereo()'s search over
 * fifteen samples), which is why the waves stand still like an oscilloscope's. The input level
 * was the mixer's: here the music's peaks are brought to about 80 % of the card's range, so the
 * "beat" changes (seventeen frames swinging over 220 of 256) come on the loudest passages, as
 * with a CD set to a sensible line level; silence stays silent.
 */

import type { PixelImage, RetroFrame, RetroScene } from "../../../src/shared/visualizations/retro/types";
import { DISPLAYS, DosEngine } from "./engine";

const FPS = 70;
const SAMPLES = 320;
const SEARCH = 15;

export function createDosScene(display?: string): RetroScene & { describe(): string } {
  const fixed = (globalThis as { cthughaSeed?: number }).cthughaSeed;
  const seed = (fixed ?? (Date.now() & 0x7fffffff)) >>> 0;
  const index = display ? DISPLAYS.indexOf(display) : -1;
  const engine = new DosEngine({ seed, display: index >= 0 ? index : undefined });
  let pending = 0;
  let level = 0;
  let gain = 1;
  /** get_stereo()'s `prev`: the left channel's value where the last frame began. */
  let prev = 128;
  let painted: PixelImage | null = null;
  let dirty = true;

  const u8 = (x: number): number => {
    const v = Math.floor(x * gain * 128) + 128;
    return v < 0 ? 0 : v > 255 ? 255 : v;
  };

  const feed = (left: Float32Array, right: Float32Array): void => {
    const start = left.length - SAMPLES - SEARCH;
    let p = start;
    let last = u8(left[p] ?? 0);
    for (let x = 0; x < 2 * SEARCH; x += 2) {
      const v = u8(left[p] ?? 0);
      if (v >= prev && last < prev - 1) break;
      last = v;
      p += 1;
    }
    prev = u8(left[p] ?? 0);
    const stereo = engine.stereo;
    for (let x = 0; x < SAMPLES; x += 1) {
      stereo[2 * x] = u8(left[p + x] ?? 0);
      stereo[2 * x + 1] = u8(right[p + x] ?? 0);
    }
  };

  return {
    width: 320,
    height: 200,
    aspect: 4 / 3,
    crt: "none",
    render(frame: RetroFrame, image: PixelImage): void {
      const audio = frame.audio;
      const peak = Math.max(audio.peakLeft, audio.peakRight);
      if (audio.sounding) level += (peak - level) * (1 - Math.exp(-frame.dt / (peak > level ? 0.15 : 4)));
      const target = level > 0.003 ? Math.max(0.5, Math.min(4, 0.8 / level)) : 1;
      gain += (target - gain) * (1 - Math.exp(-frame.dt / 1.5));
      pending += frame.dt;
      if (pending > 0.25) pending = 1 / FPS;
      for (let steps = 0; pending >= 1 / FPS && steps < 3; steps += 1) {
        feed(audio.left, audio.right);
        engine.step();
        pending -= 1 / FPS;
        dirty = true;
      }
      if ((dirty || painted !== image) && image.width === 320 && image.height === 200) {
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
