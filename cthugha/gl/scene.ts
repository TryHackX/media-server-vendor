/**
 * glcthugha (Cthugha-L 1.4's OpenGL program) as a scene of "Klasyka retro": up to three buffers
 * of Cthugha-L (engine.ts, each with its own flame, wave, palette and the rest) run 25 times a
 * second, shown through one of the seventeen 3D displays (display.ts) with WebGL 2 (emulator.ts).
 *
 * As glcthugha ran them: the buffers are 256 × 256 (-S 2, the largest texture a 3Dfx card took)
 * in a window of 600 lines (800 × 600, -D 2), as wide as the panel's shape asks; one AutoChanger
 * changes every CoreOption at once — the buffers' and glcthugha's display, light, background and
 * fly — after 5–15 s, on enough attacks, or when the music comes back. The 3D view is drawn on
 * every frame of the panel (the camera moves with time, as it did), the buffers at their 25.
 * Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald Deischinger.
 * Non-commercial use only, with credit (COPYING-cthugha-L.txt).
 */

import type { PixelImage, RetroFrame, RetroScene } from "../../../src/shared/visualizations/retro/types";
import { CRandom } from "../context";
import { CoreOption, Engine, SILENCE } from "../engine";
import { library } from "../palettes";
import { readSound } from "../sound";
import { GL_BACKGROUNDS, GL_FLIES, GL_LIGHTS, GL_SCREENS, GlDisplay } from "./display";
import { GlEmulator, Texture } from "./emulator";

const FPS = 25;
const BUFFER = 256;
const WINDOW_HEIGHT = 600;
/** getTime() of the offline renders: 1 January 1999, when Cthugha-L 1.4 came out. */
const OFFLINE_EPOCH = 915148800;

/** glcthugha's CoreOptions a preset (or a test) may lock, by entry name. */
export interface GlLocks {
  display?: string;
  light?: string;
  background?: string;
  fly?: string;
  /** Buffer 0's pcx option: a picture by name (the background shows it). */
  picture?: string;
}

export function createGlScene(locks: GlLocks = {}): RetroScene & { surface(): CanvasImageSource; describe(): string } {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!context) throw new Error("WebGL 2 is not available");
  const gl = new GlEmulator(context);
  const textures: Texture[] = [];
  const makeTexture = (mipmaps: boolean): Texture => {
    const texture = new Texture(context, mipmaps);
    textures.push(texture);
    return texture;
  };
  const display = new GlDisplay(gl, makeTexture);

  // initImages(): each picture in its own palette's colours, with mipmaps.
  const lib = library();
  const pictures = lib.pictures.map((picture) => {
    const texture = makeTexture(true);
    const colours = picture.palette >= 0 ? lib.palettes[picture.palette]!.colours : null;
    const rgba = new Uint8Array(picture.width * picture.height * 4);
    for (let i = 0; i < picture.width * picture.height; i += 1) {
      const c = picture.pixels[i]!;
      rgba[4 * i] = colours ? colours[3 * c]! : c;
      rgba[4 * i + 1] = colours ? colours[3 * c + 1]! : c;
      rgba[4 * i + 2] = colours ? colours[3 * c + 2]! : c;
      rgba[4 * i + 3] = 255;
    }
    texture.upload(picture.width, picture.height, rgba);
    return texture;
  });

  const fixed = (globalThis as { cthughaSeed?: number }).cthughaSeed;
  const seed = (fixed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff))) >>> 0;
  const random = new CRandom(seed);
  const pictureLock = locks.picture ? lib.pictures.findIndex((picture) => picture.name === locks.picture) : -1;
  const engines = [0, 1, 2].map((i) => new Engine({
    width: BUFFER,
    height: BUFFER,
    seed: (seed + 7919 * (i + 1)) >>> 0,
    buffer: true,
    locked: i === 0 && pictureLock >= 0 ? { pcx: String(pictureLock + 1) } : undefined
  }));
  const bufferTextures = engines.map(() => makeTexture(false));
  const rgba = new Uint8Array(BUFFER * BUFFER * 4);
  /** setTexture(P): the passive buffer through its palette; colour 0 is drawn grey (setPalette()). */
  const upload = (index: number): void => {
    const engine = engines[index]!;
    const pixels = engine.pixels();
    const colours = engine.colours();
    for (let i = 0; i < BUFFER * BUFFER; i += 1) {
      const c = pixels[i]!;
      if (c === 0) {
        rgba[4 * i] = 200;
        rgba[4 * i + 1] = 200;
        rgba[4 * i + 2] = 200;
      } else {
        rgba[4 * i] = colours[3 * c]!;
        rgba[4 * i + 1] = colours[3 * c + 1]!;
        rgba[4 * i + 2] = colours[3 * c + 2]!;
      }
      rgba[4 * i + 3] = 0;
    }
    bufferTextures[index]!.upload(BUFFER, BUFFER, rgba);
  };
  engines.forEach((_, index) => upload(index));

  // glcthugha's own CoreOptions (buffer −1).
  const options = {
    display: new CoreOption("display", GL_SCREENS.length),
    light: new CoreOption("light", GL_LIGHTS.length),
    background: new CoreOption("background", GL_BACKGROUNDS.length),
    fly: new CoreOption("fly", GL_FLIES.length)
  };
  for (const option of Object.values(options)) option.initial(random);
  if (locks.display) options.display.fix(GL_SCREENS.findIndex((screen) => screen.name === locks.display));
  if (locks.light) options.light.fix(GL_LIGHTS.indexOf(locks.light as (typeof GL_LIGHTS)[number]));
  if (locks.background) options.background.fix(GL_BACKGROUNDS.indexOf(locks.background as (typeof GL_BACKGROUNDS)[number]));
  if (locks.fly) options.fly.fix(GL_FLIES.indexOf(locks.fly as (typeof GL_FLIES)[number]));

  // AutoChanger (AutoChanger.cc), one for everything; Interface::msg for the silence message.
  let ticks = 0;
  let quietSince = 0;
  let lastChange = 0;
  let waitTime = 500 + (random.rand() % 1000);
  let message: string | null = null;
  let messageLine = 0;
  const changeAll = (): void => {
    for (const engine of engines) engine.changeAll();
    for (const option of Object.values(options)) option.changeRandom(random);
  };
  const autoChange = (): void => {
    const analysis = engines[0]!.ctx.analysis;
    const quietLength = ticks - quietSince;
    if (analysis.noisy) quietSince = ticks;
    if (!analysis.noisy && quietLength > 500) {
      quietSince = ticks;
      message = SILENCE[random.rand() % SILENCE.length]!;
      messageLine = random.rand() % (40 - 5);
    }
    if (analysis.noisy && quietLength > 150) {
      changeAll();
      return;
    }
    if (analysis.fireLevel > 1000) {
      analysis.fireLevel = 0;
      changeAll();
      return;
    }
    if (ticks - lastChange > waitTime) {
      lastChange = ticks;
      waitTime = 500 + (random.rand() % 1000);
      changeAll();
    }
  };

  let width = 800;
  let height = WINDOW_HEIGHT;
  let pending = 0;
  let level = 0;
  let gain = 1;
  let title: string | null = null;
  let clock = 0;
  const epoch = fixed !== undefined ? OFFLINE_EPOCH : Date.now() / 1000;

  const step = (audio: RetroFrame["audio"]): void => {
    for (const engine of engines) readSound(engine.ctx.sound, audio.left, audio.right, gain);
    const first = engines[0]!;
    first.ctx.analysis.run(first.ctx.sound, 5);
    for (const engine of engines.slice(1)) Object.assign(engine.ctx.analysis, first.ctx.analysis);
    ticks += 100 / FPS;
    autoChange();
    // CthughaBuffer::nBuffers: as many buffers run as the display shows.
    const n = GL_SCREENS[options.display.value]!.buffers;
    for (let j = 0; j < n; j += 1) {
      engines[j]!.step();
      upload(j);
    }
  };

  return {
    get width(): number {
      return width;
    },
    get height(): number {
      return height;
    },
    aspect: 0,
    crt: "none",
    resize(panelWidth: number, panelHeight: number): void {
      if (!(panelWidth > 0 && panelHeight > 0)) return;
      width = Math.max(400, Math.min(1600, Math.round((WINDOW_HEIGHT * panelWidth) / panelHeight / 4) * 4));
      height = WINDOW_HEIGHT;
    },
    render(frame: RetroFrame, _image: PixelImage): void {
      const audio = frame.audio;
      // The input level, as for Cthugha-L: quiet records brought up, never more than threefold.
      const loud = Math.max(audio.rmsLeft, audio.rmsRight);
      if (audio.sounding) level += (loud - level) * (1 - Math.exp(-frame.dt / (loud > level ? 0.4 : 6)));
      const target = level > 0.003 ? Math.max(1, Math.min(3, 0.18 / level)) : 1;
      gain += (target - gain) * (1 - Math.exp(-frame.dt / 1.5));
      if (frame.track.title !== title) {
        if (title !== null && frame.track.title) engines[0]!.showPicture(1 + (random.rand() % pictures.length));
        title = frame.track.title;
      }
      pending += frame.dt;
      if (pending > 0.25) pending = 1 / FPS;
      for (let steps = 0; pending >= 1 / FPS && steps < 2; steps += 1) {
        step(audio);
        pending -= 1 / FPS;
      }
      if (engines[0]!.ctx.analysis.noisy) message = null;
      clock += frame.dt;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const picture = engines[0]!.picture;
      const first = engines[0]!.ctx;
      display.draw({
        now: epoch + clock,
        deltaT: frame.dt,
        width,
        height,
        screen: options.display.value,
        light: options.light.value,
        background: options.background.value,
        fly: options.fly.value,
        intensity: first.analysis.intensity,
        buffers: bufferTextures,
        passive: first.passive,
        base: first.BASE,
        bufferWidth: BUFFER,
        bufferHeight: BUFFER,
        picture: picture > 0 ? pictures[picture - 1] ?? null : null,
        message,
        messageLine
      });
    },
    surface(): CanvasImageSource {
      return canvas;
    },
    dispose(): void {
      gl.dispose();
      for (const texture of textures) texture.dispose();
      context.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.width = 0;
      canvas.height = 0;
    },
    describe(): string {
      return [
        `screen=${GL_SCREENS[options.display.value]!.name}`, `light=${GL_LIGHTS[options.light.value]}`,
        `background=${GL_BACKGROUNDS[options.background.value]}`, `fly=${GL_FLIES[options.fly.value]}`,
        `picture=${engines[0]!.picture}`, engines[0]!.describe()
      ].join(" ");
    }
  };
}
