/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; based on Cthugha by Kevin "Zaph" Burfitt and
 * Cthugha-L by Harald Deischinger; free for personal use (vis_sh.txt); never committed.
 *
 * Cthugha-4-Winamp as a scene of "Klasyka retro": the plug-in's 640 × 480 screen (its default
 * Resolution, 256 colours full screen), one Render every 25 ms — the module's delayMs, so
 * 40 frames a second on a machine fast enough — fed what Winamp fed a vis plugin: the newest
 * 576 samples of each channel as the top bytes of 16-bit PCM, and Winamp's 576-byte spectrum of
 * them (avs/winamp-visdata.ts, after Winamp's VIS.cpp). The plug-in read the waveform for its
 * waves and the spectrum for the beat; the level is the decoder's (the app taps the music before
 * the volume, as Winamp did), so nothing is normalised.
 *
 * The song's title comes as Winamp's main window showed it ("1. Artist - Title - Winamp"), and its
 * position as IPC_GETOUTPUTTIME gave it; when the app knows no position, the time since the
 * title changed stands in, so the 3D letters still spell each new song's title at its start.
 */

import { pcmTopByte, winampSpectrum } from "../../../src/shared/visualizations/avs/winamp-visdata";
import type { PixelImage, RetroFrame, RetroScene } from "../../../src/shared/visualizations/retro/types";
import { C4wEngine, DISPLAYS, SPECTRUM_AT, WAVEFORM_AT } from "./engine";
import { FLAMES } from "./flames";
import { WAVE_NAMES } from "./waves";

const FPS = 40;
const SAMPLES = 576;
const PREPARE_MS = 2;

export interface C4wOptions {
  seed?: number;
  /** A display kept through the changes: "Normal 1x1", "Kaleidoscope 2x2", "Weidth 2x1", "Height 1x2". */
  display?: string;
  /** The flame and wave at start (short or long name), as set in the configuration. */
  flame?: string;
  wave?: string;
  /** "640x480" (default), "640x400", "320x240", "320x200" or "160x120". */
  resolution?: string;
  /** maps\*.map at start ("VOLCANO.MAP" by default) and a translation (e.g. "space.tab"). */
  palette?: string;
  translation?: string;
  /** Beat-driven random changes (L); on by default. */
  random?: boolean;
  /** The analyzer as input instead of the scope (I). */
  analyzer?: boolean;
  /** The 3D letters at a song's start, the title on the beat, the pictures; all on by default. */
  intro?: boolean;
  titles?: boolean;
  pictures?: boolean;
  /** Also the tables the \tabs generators make with their default parameters. */
  extraTabs?: boolean;
}

function byName(names: readonly (readonly string[])[], wanted: string | undefined): number | undefined {
  if (!wanted) return undefined;
  const key = wanted.toLowerCase();
  const index = names.findIndex((entry) => entry.some((name) => name.toLowerCase() === key));
  return index >= 0 ? index : undefined;
}

export function createC4wScene(options: C4wOptions = {}): RetroScene & { describe(): string } {
  const fixed = (globalThis as { cthughaSeed?: number }).cthughaSeed;
  const seed = (options.seed ?? fixed ?? Math.floor(Date.now() / 1000)) >>> 0;
  const engine = new C4wEngine({
    seed,
    resolution: options.resolution,
    wave: byName(WAVE_NAMES, options.wave),
    flame: byName(FLAMES.map((flame) => [flame.name, flame.long]), options.flame),
    display: byName(DISPLAYS.map((name) => [name]), options.display),
    palette: options.palette,
    translation: options.translation,
    random: options.random,
    analyzer: options.analyzer,
    intro: options.intro,
    titles: options.titles,
    pictures: options.pictures,
    extraTabs: options.extraTabs
  });
  const top = [new Int8Array(SAMPLES), new Int8Array(SAMPLES)];
  const spectrum = new Uint8Array(SAMPLES);
  let pending = 0;
  let painted: PixelImage | null = null;
  let dirty = true;
  let title = "";
  let titleTime = 0;

  /** Winamp's visdata for one Render: the newest 576 samples of each channel. */
  const feed = (left: Float32Array, right: Float32Array): void => {
    const mem = engine.mem;
    const channels = [left, right];
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = channels[channel]!;
      const start = samples.length - SAMPLES;
      const bytes = top[channel]!;
      for (let i = 0; i < SAMPLES; i += 1) {
        const value = pcmTopByte(samples[start + i] ?? 0);
        bytes[i] = value;
        mem[WAVEFORM_AT + channel * SAMPLES + i] = value & 255;
      }
      winampSpectrum(bytes, spectrum);
      mem.set(spectrum, SPECTRUM_AT + channel * SAMPLES);
    }
  };

  return {
    width: engine.w,
    height: engine.h,
    aspect: 4 / 3,
    crt: "none",
    render(frame: RetroFrame, image: PixelImage): void {
      if (frame.track.title !== title) {
        title = frame.track.title;
        titleTime = frame.time;
      }
      const known = frame.track.duration > 0 || frame.track.position > 0;
      engine.setTrack(title, known ? frame.track.position : frame.time - titleTime);
      pending += frame.dt;
      if (pending > 0.25) pending = 1 / FPS;
      for (let steps = 0; pending >= 1 / FPS && steps < 3; steps += 1) {
        feed(frame.audio.left, frame.audio.right);
        engine.step();
        pending -= 1 / FPS;
        dirty = true;
      }
      // The \tabs generators' tables, 2 ms a frame (the plug-in loaded tables in a thread).
      engine.prepareTables(performance.now() + PREPARE_MS);
      if ((dirty || painted !== image) && image.width === engine.w && image.height === engine.h) {
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
