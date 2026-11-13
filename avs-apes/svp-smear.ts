/*
 * Smear.svp — "smear :: mykel : xplo" (v1.21, mykel@earthling.net / xplo@xplo.org), a Sonique
 * visualization plug-in, as AVS's "Render / SVP Loader" runs it.
 *
 * Library: smear.svp
 * Binary:  sha256 40736f0a9f90e9a775a335ea431a23fa45fdb992ea77e0b61a3cbc8003c651e1
 *          (PE32 DLL, MSVC, unoptimised build of 20.03.2000, static multithreaded CRT)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x10015E98): version 2, "smear :: mykel : xplo", lRequired = 3 (waveform | spectrum),
 * Initialize 0x10007A0E, Render 0x10007F67, SaveSettings 0x10008105, OpenSettings 0x100082A9
 * (AVS never calls the later Deinit/Clicked/ReceiveQueryInterface entries).
 *
 * Settings (section "smear" of the file AVS passes, "avs.ini"; read with GetPrivateProfileString,
 * the string "9999" meaning "missing" -> default, otherwise atoi clamped):
 *   Movemap Hold/Fade Time 150/30, Colormap Hold/Fade Time 130/30, Waveform Hold/Fade Time 150/15,
 *   Particle Hold/Fade Time 100/30 (all in 1/10 s), Particle Chance per Frame 10, Letter Box
 *   Percentage 100, Show Titles True, Debug Scripts False. There is no avs.ini, so these defaults.
 *
 * What it is: an engine running scripts in its own Lisp-like language ("Stutter": DECLARE, SET, +, -,
 * *, RND, POS, SIN, POLAR, CART ...). Initialize looks for script files *.sms (moves), *.scs
 * (colours), *.sws (waveforms) and *.sps (particles) in the sub-directories Moves, Color, WaveForm and
 * Particle of the process's current directory (FindFirstFile after _chdir). None of them exist beside
 * AVS here, so the built-in scripts are used: one move script, one colour script, one waveform script,
 * and no particle script (so particles never start; the particle timer still draws one rand() a second).
 * This port runs those three built-in scripts, hand-translated with the interpreter's semantics
 * (every value a double, (+ a b) = b + a, RND, POS, POLAR, CART exactly as the builtins at 0x10001D53,
 * 0x100021EB, 0x100023A6, 0x1000245B compute them). The general interpreter is not ported.
 *
 *  - 8-bit feedback buffer (frame width x box height, box height = min(h, w * 100 / 100)): every frame
 *    it is resampled through a 16.16 "move map" (bilinear) and through a decay table
 *    t[i] = (int)((rand() % 500 / 10000.0 + 0.95) * i), built once with 256 rand() draws.
 *  - Move map (built-in script): radius' = max(0, r - a2), theta' = theta + a1 sin(a0 r) in
 *    coordinates normalised by max(w, h) / 2, with a0 = 2 + rnd 16, a1 = .002 + rnd .02,
 *    a2 = .002 + rnd .006 drawn whenever a new map is started. A new map is computed row by row in the
 *    background with a time budget of 25 ms (first) / 5 ms per frame measured with GetTickCount; when
 *    complete and its hold time (first 1.5 s, then 150 * 100 * (50..149) / 100 ms) has passed, the old
 *    map is cross-faded into it over 30 * 100 * (50..149) / 100 ms.
 *  - Palette (built-in script, HSV): hue = GetTickCount / 1000 * 0.05 (one turn per 20 s),
 *    value = 2 i / 256, saturation = 2 (1 - i / 256); recomputed every frame; colour-map hold/fade
 *    switching cross-fades between two identical palettes (only rand() draws are visible).
 *  - Waveform (built-in script): 256 points (step * 2 - 1, (left + right) / 2) rotated by an angle that
 *    grows 0.015 per drawing, scaled to the box, drawn as 255-valued DDA lines (replace) into the
 *    buffer; waveform hold/fade switching draws the same script twice and morphs the two recordings.
 *  - Output: palette[buffer] REPLACES the box rows of the frame; rows above/below the box are cleared.
 *  - Splash: after the maps are (re)allocated (first frame, every resize) the buffer is cleared and
 *    the GDI text "Smear" / "mykel :: xplo" (Verdana bold, non-antialiased, value 255) is put into it
 *    every frame, without warping, until the first map is ready and 1.5 s have passed.
 *
 * rand(): the DLL's own static multithreaded CRT (per-thread _holdrand). Initialize runs
 * srand(GetTickCount()) but draws nothing; AVS calls OpenSettings/Initialize where it loads presets
 * (its window thread, r_svp.cpp SetLibrary) and Render only on its render thread, where srand never
 * runs, so every draw comes from a per-thread state starting at 1: the port uses ctx.makeRand(1).
 * Draws happen in the binary's order (palette script pick + hold, move script pick + a0 a1 a2, decay
 * table, waveform pick + hold, particle chance, ...).
 *
 * Not recovered / approximate:
 *  - GDI text of the splash: rendered with an OffscreenCanvas when one exists (bold Verdana-like
 *    font, em height MulDiv(pt, 96, 72), top-aligned with ascent 2059/2048 em, alpha >= 50% = on);
 *    glyph shapes differ from GDI's. Without a canvas (e.g. node) the splash has no text.
 *  - Song titles (Show Titles) need Sonique's query interface, which AVS never provides: never drawn,
 *    as in AVS. The "Current Scripts" debug overlay needs Clicked(): never drawn, as in AVS.
 *  - Timing: the background map computation is bounded by GetTickCount differences (ctx.now());
 *    how many rows fit in a frame depends on the host's speed, as in the original.
 *  - fsin/fcos/fpatan (CRT sin, cos, atan2) vs Math.sin/cos/atan2: last-bit differences, visible
 *    only when a 16.16 map coordinate or a pixel coordinate lands exactly on a boundary.
 *  - The srand(GetTickCount()) of Initialize only matters if a host called Initialize and Render on
 *    the same thread; AVS 2.81d does not, so it is not reproduced.
 *  - Particle scripts and script files are not available, so their code paths are not ported.
 *  - The DLL's statics are shared by all SVP effects loading this file in one process (the splash shows
 *    only on its first load or a resize); the port keeps one state per create().
 */

export interface ApeContext {
  readonly w: number;
  readonly h: number;
  readonly isBeat: boolean;
  readonly visdata: Int8Array;
  readonly visdataUnsigned: Uint8Array;
  rand(): number;
  makeRand(seed?: number): () => number;
  readonly registers: Float64Array;
  lineBlendMode: number;
  globalBuffer(index: number, create: boolean): Int32Array | null;
  now(): number;
}
export interface SvpVisData {
  millSec: number;
  waveform: [Uint8Array, Uint8Array];
  spectrum: [Uint8Array, Uint8Array];
}
export interface SvpEffect {
  render(video: Int32Array, width: number, height: number, pitch: number, vd: SvpVisData, ctx: ApeContext): void;
}

/** OpenSettings (0x100082A9) defaults; the values used without an avs.ini. */
export const SMEAR_SETTINGS = {
  movemapHold: 150,
  movemapFade: 30,
  colormapHold: 130,
  colormapFade: 30,
  waveformHold: 150,
  waveformFade: 15,
  particleHold: 100,
  particleFade: 30,
  particleChance: 10,
  letterBox: 100,
  showTitles: true,
  debugScripts: false
} as const;

/** _ftol: truncation toward zero, low 32 bits (NaN/inf -> 0 like the x87's integer indefinite). */
export function smearFtol(value: number): number {
  return Math.trunc(value) | 0;
}

/** C int division (idiv): truncation toward zero. */
function idiv(a: number, b: number): number {
  return (a / b) | 0;
}

function sbyte(b: number): number {
  return (b << 24) >> 24;
}

/** Stutter RND builtin (0x10001D53): (rnd a b), arguments missing = 0. */
export function smearRnd(rand: () => number, a = 0, b = 0): number {
  let lo = a;
  let hi = b;
  if (lo === 0 && hi === 0) hi = 1;
  else if (lo > hi) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  return ((rand() & 0x7fff) / 32768) * (hi - lo) + lo;
}

/** 0x10001650: script choice, rand() % (n * n) mapped through a square root (one draw). */
export function smearPickIndex(rand: () => number, n: number): number {
  const r = rand() % Math.imul(n, n);
  let idx = n - smearFtol(Math.sqrt(r)) - 1;
  if (idx < 0) idx = 0;
  if (idx >= n) idx = n - 1;
  return idx;
}

/** Hold/fade time in ms: (tenths * 100 * (rand() % 100 + 50)) / 100. */
export function smearSwitchTime(rand: () => number, tenths: number): number {
  return idiv(Math.imul(Math.imul(tenths, 100), (rand() % 100) + 50), 100);
}

/** 0x100061C9: the decay table, 256 draws. */
export function smearDecayTable(rand: () => number): Uint8Array {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const r = rand() % 500;
    table[i] = smearFtol((r / 10000.0 + 0.95) * i) & 0xff;
  }
  return table;
}

/** Built-in move script with the engine part of 0x10005B80 (UsePolar = 1 -> radius/theta). */
export class SmearMoveScript {
  a0 = 0;
  a1 = 0;
  a2 = 0;
  /** (declare init (set $usePolar 1) (set $useAspect 1) (set $a0 (+ 2 (rnd 16))) ...) */
  init(rand: () => number): void {
    this.a0 = smearRnd(rand, 16) + 2;
    this.a1 = smearRnd(rand, 0.02) + 0.002;
    this.a2 = smearRnd(rand, 0.006) + 0.002;
  }
  /** Normalised point -> normalised source point. */
  move(x: number, y: number, out: Float64Array): void {
    const radius = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(y, x);
    // (set $srcRadius (pos (- $radius $a2)))
    let srcRadius = radius - this.a2;
    if (!(srcRadius >= 0)) srcRadius = 0;
    // (set $srcTheta (+ $theta (* $a1 (sin (* $a0 $radius)))))
    const srcTheta = Math.sin(radius * this.a0) * this.a1 + theta;
    out[0] = Math.cos(srcTheta) * srcRadius;
    out[1] = Math.sin(srcTheta) * srcRadius;
  }
}

/** Built-in colour script + the HSV conversion of 0x100048A2: palette entry i at time t (s). */
export function smearColorEntry(time: number, i: number): number {
  const value = i / 256.0;
  // (declare color (set $h (* $time 0.05)) (set $v (* $value 2.0)) (set $s (* 2 (- 1 $value))))
  let h = time * 0.05;
  let v = value * 2.0;
  let s = (1 - value) * 2;
  h = (h - Math.floor(h)) * 6.0;
  const hi = smearFtol(h);
  h = h - hi;
  if (!(s > 0)) s = 0;
  if (!(s < 1)) s = 1;
  if (!(v > 0)) v = 0;
  if (!(v < 1)) v = 1;
  if ((hi & 1) === 0) h = 1.0 - h;
  v = v * 256.0;
  const vi = smearFtol(v);
  const p = smearFtol((1.0 - s) * v);
  const q = smearFtol((1.0 - s * h) * v);
  let r: number;
  let g: number;
  let b: number;
  switch (hi) {
    case 1: r = q; g = vi; b = p; break;
    case 2: r = p; g = vi; b = q; break;
    case 3: r = p; g = q; b = vi; break;
    case 4: r = q; g = p; b = vi; break;
    case 5: r = vi; g = p; b = q; break;
    default: r = vi; g = q; b = p; break;
  }
  r = r < 0 ? 0 : r > 255 ? 255 : r;
  g = g < 0 ? 0 : g > 255 ? 255 : g;
  b = b < 0 ? 0 : b > 255 ? 255 : b;
  return (r << 16) | (g << 8) | b;
}

/** 0x100048A2 for the built-in colour script: 256 entries at GetTickCount() = tick. */
export function smearPalette(tick: number, out: Int32Array): void {
  const time = (tick >>> 0) / 1000.0;
  for (let i = 0; i < 256; i++) out[i] = smearColorEntry(time, i);
}

/** Built-in waveform script; one path (Paths 1), 256 steps. */
export class SmearWaveScript {
  angle = 0;
  x0 = 0;
  y0 = 0;
  readonly paths = 1;
  readonly steps = 256;
  // engine-side per-path state (script + 0x117C ...)
  prevX = new Int32Array(16);
  prevY = new Int32Array(16);
  firstX = new Int32Array(16);
  firstY = new Int32Array(16);
  /** (declare newline (set $angle (+ $angle 0.015))) */
  newline(): void {
    this.angle = 0.015 + this.angle;
  }
  /** (declare waveform (polar $radius $theta (- (* $step 2.0) 1.0) $mid) (cart $x0 $y0 $radius (+ $theta $angle))) */
  waveform(step: number, mid: number): void {
    const x = step * 2.0 - 1.0;
    const radius = Math.sqrt(x * x + mid * mid);
    const theta = Math.atan2(mid, x);
    const t = this.angle + theta;
    this.x0 = Math.cos(t) * radius;
    this.y0 = Math.sin(t) * radius;
  }
}

/** MulDiv(a, b, c) for positive values (rounded). */
function mulDiv(a: number, b: number, c: number): number {
  return Math.floor((a * b + (c >> 1)) / c);
}

interface Canvas2D {
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

/**
 * Approximation of the GDI splash (0x1000633F + 0x10008B2B/0x10008C8B): "Smear" at
 * (w/2, boxH/2 - 2 fs) with fs*15/10 pt and "mykel :: xplo" at (w/2, boxH/2) with fs*9/10 pt,
 * fs = boxH / 8, Verdana bold, TA_CENTER | TA_TOP. Returns w * h bytes (255 = text) or null.
 */
export function smearSplashMask(w: number, h: number, boxH: number): Uint8Array | null {
  const OC = (globalThis as unknown as { OffscreenCanvas?: new (w: number, h: number) => { getContext(type: string): unknown } }).OffscreenCanvas;
  if (!OC || w <= 0 || h <= 0) return null;
  try {
    const g = new OC(w, h).getContext("2d") as Canvas2D | null;
    if (!g) return null;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const fs = boxH >> 3;
    const draw = (text: string, pts: number, x: number, y: number) => {
      const em = mulDiv(pts, 96, 72);
      if (em <= 0) return;
      g.font = `bold ${em}px Verdana, Geneva, "DejaVu Sans", sans-serif`;
      g.fillText(text, x, y + Math.round((em * 2059) / 2048));
    };
    draw("Smear", idiv(fs * 15, 10), idiv(w, 2), idiv(boxH, 2) - fs * 2);
    draw("mykel :: xplo", idiv(fs * 9, 10), idiv(w, 2), idiv(boxH, 2));
    const data = g.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = (data[i * 4] ?? 0) >= 128 ? 255 : 0;
    return mask;
  } catch {
    return null;
  }
}

interface WaveRecord {
  x: Int16Array;
  y: Int16Array;
  f: Int16Array;
  last: number;
}

function newRecords(): WaveRecord[][] {
  const sets: WaveRecord[][] = [];
  for (let s = 0; s < 2; s++) {
    const set: WaveRecord[] = [];
    for (let p = 0; p < 16; p++) set.push({ x: new Int16Array(512), y: new Int16Array(512), f: new Int16Array(512), last: 0 });
    sets.push(set);
  }
  return sets;
}

/** The engine state (the DLL's globals). */
export class SmearEngine {
  settings = SMEAR_SETTINGS;
  rand: () => number = () => 0;
  tick: () => number = () => 0;
  seeded = false;
  // frame
  w = 0;
  h = 0;
  boxH = 0;
  top = 0;
  // scripts (one built-in each); null until first picked
  readonly moveScript = new SmearMoveScript();
  readonly waveScript = new SmearWaveScript();
  moveCur: SmearMoveScript | null = null;
  // colour map manager (0x10007A3C)
  colorStarted = false;
  colorFading = 0;
  colorLast = 0;
  colorNext = 0;
  readonly palA = new Int32Array(256);
  readonly palB = new Int32Array(256);
  readonly palette = new Int32Array(256);
  // move maps (0x10005FC0)
  mapW = -1;
  mapH = -1;
  maps: [Int32Array, Int32Array] | null = null;
  mapA = 0;
  row = 0;
  splashDone = 1; // 0x10015E80, initially 1
  budget = 5; // 0x10015E84
  moveFading = 0;
  fade = 0; // 0x1001C790
  holdUntil = 0;
  fadeEnd = 0;
  fadeDur = 0;
  // buffers (0x10006226)
  bufW = -1;
  bufH = -1;
  bufs: [Uint8Array, Uint8Array] | null = null;
  cur = 0;
  origin = 0;
  decay = new Uint8Array(256);
  // splash DIB
  dibW = 0;
  dibH = 0;
  dibMask: Uint8Array | null = null;
  // waveform manager (0x1000719D)
  waveStarted = false;
  waveFading = 0;
  waveLast = 0;
  waveNext = 0;
  readonly records = newRecords();
  // particles (0x100073CC)
  particleActive = 0;
  particleLastTry = 0;
  private readonly movePoint = new Float64Array(2);

  /** 0x10001407 / 0x10001311 / 0x100014FD: pick among one script. */
  private pick(): void {
    smearPickIndex(this.rand, 1);
  }

  /** 0x10007A3C (the built-in colour script has UseTIME = 1, so palettes are rebuilt every frame). */
  colorManager(): void {
    const now = this.tick();
    const s = this.settings;
    if (!this.colorStarted) {
      this.pick();
      this.colorStarted = true;
      this.colorFading = 0;
      this.colorLast = now;
      this.colorNext = (now + smearSwitchTime(this.rand, s.colormapHold)) | 0;
    }
    if (now >= this.colorNext) {
      this.colorLast = now;
      this.colorFading = this.colorFading === 0 ? 1 : 0;
      if (this.colorFading) {
        this.pick();
        this.colorNext = (this.colorLast + smearSwitchTime(this.rand, s.colormapFade)) | 0;
      } else {
        this.colorNext = (this.colorLast + smearSwitchTime(this.rand, s.colormapHold)) | 0;
      }
    }
    if (this.colorFading) {
      smearPalette(this.tick(), this.palA);
      smearPalette(this.tick(), this.palB);
      let t = idiv((now - this.colorLast) << 8, (this.colorNext - this.colorLast) | 0);
      if (t < 0) t = 0;
      if (t > 256) t = 256;
      const u = 256 - t;
      for (let i = 0; i < 256; i++) {
        const a = this.palA[i]!;
        const b = this.palB[i]!;
        let out = this.palette[i]! & 0xff000000;
        for (let k = 0; k < 24; k += 8) {
          const v = (Math.imul((a >>> k) & 255, u) + Math.imul((b >>> k) & 255, t)) >> 8;
          out |= (v & 255) << k;
        }
        this.palette[i] = out;
      }
    } else {
      smearPalette(this.tick(), this.palette);
    }
  }

  private newMoveScript(): void {
    this.pick();
    this.moveCur = this.moveScript;
    this.moveCur.init(this.rand);
  }

  private allocMaps(): boolean {
    if (this.mapW === this.w && this.mapH === this.boxH && this.maps) return false;
    this.mapW = this.w;
    this.mapH = this.boxH;
    const n = Math.max(0, this.mapW * this.mapH * 2);
    this.maps = [new Int32Array(n), new Int32Array(n)];
    this.mapA = 0;
    this.row = 0;
    return true;
  }

  /** 0x100043A0: one row of the new map; -1 when the time budget ran out. */
  computeRow(row: number, budget: { v: number }): number {
    const script = this.moveScript;
    const map = this.maps![this.mapA ^ 1];
    const w = this.mapW;
    const h = this.mapH;
    let sx = w / 2.0;
    let sy = h / 2.0;
    // UseAspect = 1
    if (sx > sy) sy = sx;
    else sx = sy;
    const yn0 = (row - h / 2.0) / sy;
    let o = w * row * 2;
    const start = this.tick();
    let elapsed = 0;
    const pt = this.movePoint;
    for (let x = 0; x < w; x++) {
      elapsed = (this.tick() - start) | 0;
      if (elapsed > budget.v) {
        budget.v = (budget.v - elapsed) | 0;
        return -1;
      }
      script.move((x - w / 2.0) / sx, yn0, pt);
      let xn = pt[0]! * sx + w / 2.0;
      let yn = pt[1]! * sy + h / 2.0;
      if (!(xn >= 0)) xn = 0;
      if (w - 1.0 < xn) xn = w - 1.0;
      if (!(yn >= 0)) yn = 0;
      if (h - 1.0 < yn) yn = h - 1.0;
      map![o++] = smearFtol(xn * 65536.0);
      map![o++] = smearFtol(yn * 65536.0);
    }
    budget.v = (budget.v - elapsed) | 0;
    return 0;
  }

  /** 0x10005F51. */
  computeRows(budgetMs: number): number {
    if (!this.moveCur) return -1;
    const budget = { v: budgetMs };
    for (;;) {
      if (this.row >= this.mapH) return 1;
      if (this.computeRow(this.row, budget) === 0) this.row++;
      if (!(budget.v > 0)) return 0;
    }
  }

  /** 0x10005FC0. */
  moveManager(): void {
    const now = this.tick();
    const s = this.settings;
    if (this.allocMaps()) {
      this.newMoveScript();
      this.row = 0;
      this.splashDone = 0;
      this.budget = 25;
      this.moveFading = 0;
      this.holdUntil = (now + 1500) | 0;
      this.fadeDur = 0;
    }
    if (this.moveFading) {
      if (now >= this.fadeEnd || !(this.fadeDur > 0)) this.moveFading = 0;
      else {
        this.fade = idiv((this.fadeEnd - now) << 8, this.fadeDur);
        if (this.fade > 255) this.fade = 255;
        if (!(this.fade > 0)) this.moveFading = 0;
      }
      if (this.moveFading) return;
      this.mapA ^= 1;
      this.newMoveScript();
      this.budget = 5;
      this.row = 0;
      this.holdUntil = (now + smearSwitchTime(this.rand, s.movemapHold)) | 0;
      this.fadeDur = smearSwitchTime(this.rand, s.movemapFade);
    }
    const r = this.computeRows(this.budget);
    if (r === 1 && now >= this.holdUntil) {
      this.splashDone = 1;
      this.moveFading = 1;
      const cap = idiv(Math.imul(Math.imul(s.movemapFade, 3), 100), 2);
      if (this.fadeDur > cap) this.fadeDur = cap;
      this.fadeEnd = (now + this.fadeDur) | 0;
      this.fade = 255;
    }
    if (r === -1) this.newMoveScript();
  }

  /** 0x10006226. */
  allocBuffers(): void {
    if (this.bufW === -1) this.decay = smearDecayTable(this.rand);
    if (this.bufW === this.w && this.bufH === this.boxH && this.bufs) return;
    this.bufW = this.w;
    this.bufH = this.boxH;
    const n = Math.max(0, this.bufW * this.bufH + this.bufW * 2 + 2);
    this.bufs = [new Uint8Array(n), new Uint8Array(n)];
    this.origin = this.bufW + 1;
    this.cur = 0;
  }

  /** 0x1000633F: splash or warp, then buffer swap. */
  warp(): void {
    this.moveManager();
    this.allocBuffers();
    const bufs = this.bufs!;
    const W = this.bufW;
    const N = W * this.bufH;
    const o = this.origin;
    const src = bufs[this.cur];
    if (!this.splashDone) {
      src.fill(0, o, o + N);
      if (this.dibW !== this.w || this.dibH !== this.h || !this.dibMask) {
        this.dibW = this.w;
        this.dibH = this.h;
        this.dibMask = smearSplashMask(this.w, this.h, this.boxH) ?? new Uint8Array(Math.max(0, this.w * this.h));
      }
      const mask = this.dibMask;
      const rows = Math.min(this.dibH, this.bufH);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < this.dibW; x++) if (mask[y * this.dibW + x]) src[o + y * W + x] = 255;
      }
      this.cur ^= 1;
      return;
    }
    const dst = bufs[this.cur ^ 1];
    const maps = this.maps!;
    const A = maps[this.mapA];
    const B = maps[this.mapA ^ 1];
    const decay = this.decay;
    const blend = this.moveFading !== 0 && this.fade > 0 && this.fade < 255;
    const f = this.fade;
    const g = 256 - f;
    for (let i = 0, m = 0; i < N; i++, m += 2) {
      let xs: number;
      let ys: number;
      if (blend) {
        xs = ((Math.imul(B[m]! >>> 4, g) + Math.imul(A[m]! >>> 4, f)) >>> 0) >>> 4;
        ys = ((Math.imul(B[m + 1]! >>> 4, g) + Math.imul(A[m + 1]! >>> 4, f)) >>> 0) >>> 4;
      } else {
        xs = A[m]!;
        ys = A[m + 1]!;
      }
      const p = o + (xs >> 16) + Math.imul(ys >> 16, W);
      const fx = xs & 0xffff;
      const fy = ys & 0xffff;
      const a = src[p]!;
      const top = a + (Math.imul(src[p + 1]! - a, fx) >> 16);
      const c = src[p + W]!;
      const bot = c + (Math.imul(src[p + W + 1]! - c, fx) >> 16);
      dst[o + i] = decay[top + (Math.imul(bot - top, fy) >> 16)]!;
    }
    this.cur ^= 1;
  }

  private plot(x: number, y: number, value: number, blend: number): void {
    const buf = this.bufs![this.cur];
    const i = this.origin + y * this.bufW + x;
    if (blend === 1) {
      const v = buf[i]! + value;
      buf[i] = v > 255 ? 255 : v & 255;
    } else if (blend === 2) {
      if (buf[i]! < value) buf[i] = value & 255;
    } else buf[i] = value & 255;
  }

  /** 0x10006ED4. */
  point(x: number, y: number, value: number, blend: number): void {
    if (x >= 1 && x < this.w - 1 && y >= 1 && y < this.boxH - 1) this.plot(x, y, value, blend);
  }

  /** 0x1000685F: 16.16 DDA from (x1, y1), max(|dx|, |dy|) points, (x2, y2) not drawn. */
  line(x1: number, y1: number, x2: number, y2: number, value: number, blend: number): void {
    let dx = (x2 - x1) | 0;
    if (dx < 0) dx = -dx | 0;
    let dy = (y2 - y1) | 0;
    if (dy < 0) dy = -dy | 0;
    const n = dx > dy ? dx : dy;
    if (n === 0) return;
    const sx = idiv((x2 - x1) << 16, n);
    const sy = idiv((y2 - y1) << 16, n);
    let x = x1 << 16;
    let y = y1 << 16;
    for (let i = 0; i < n; i++) {
      this.point(x >> 16, y >> 16, value, blend);
      x = (x + sx) | 0;
      y = (y + sy) | 0;
    }
  }

  /** 0x10006A63. */
  record(x: number, y: number, fade: number, set: number, p: number, idx: number): void {
    const r = this.records[set - 1]![p]!;
    r.x[idx] = x;
    r.y[idx] = y;
    r.f[idx] = fade;
    if (idx === 0) {
      r.last = 0;
      return;
    }
    const last = r.last;
    const span = idx - last;
    for (let j = last + 1; j < idx; j++) {
      r.x[j] = r.x[last]! + idiv(Math.imul(r.x[idx]! - r.x[last]!, j - last), span);
      r.y[j] = r.y[last]! + idiv(Math.imul(r.y[idx]! - r.y[last]!, j - last), span);
      r.f[j] = r.f[last]! + idiv(Math.imul(r.f[idx]! - r.f[last]!, j - last), span);
    }
    r.last = (idx << 16) >> 16;
  }

  /** 0x100050FA for the built-in waveform script. */
  drawWave(vd: SvpVisData, fadeArg: number): void {
    const script = this.waveScript;
    const w = this.w;
    const h = this.boxH;
    script.newline();
    const sx = w / 2.0;
    const sy = h / 2.0;
    const w0 = vd.waveform[0];
    const w1 = vd.waveform[1];
    const fadeValue = 255; // (1.0 - Fade0) * 255 with Fade0 = 0
    const blendType = 0;
    let prevIdx = 0;
    for (let step = 0; step < script.steps; step++) {
      const idx = idiv(step << 9, script.steps);
      const left = sbyte(w0[idx] ?? 0) / 128.0;
      const right = sbyte(w1[idx] ?? 0) / 128.0;
      script.waveform(step / script.steps, (left + right) / 2.0);
      const x = smearFtol(sx * script.x0 + w / 2.0);
      const y = smearFtol(sy * script.y0 + h / 2.0);
      if (step === 0) {
        script.firstX[0] = x;
        script.firstY[0] = y;
      } else if (fadeArg) this.record(script.prevX[0]!, script.prevY[0]!, fadeValue, fadeArg, 0, prevIdx);
      else this.line(x, y, script.prevX[0]!, script.prevY[0]!, fadeValue, blendType);
      script.prevX[0] = x;
      script.prevY[0] = y;
      prevIdx = idx;
    }
    if (fadeArg) this.record(script.prevX[0]!, script.prevY[0]!, fadeValue, fadeArg, 0, 0x1ff);
    // Loop0 = 0: no closing line
  }

  /** 0x10006E46 / 0x10006C4D: morph of the two recordings (one path each, lines, blend 0). */
  morph(u: number, t: number): void {
    const A = this.records[0]![0]!;
    const B = this.records[1]![0]!;
    let n = A.last;
    if (B.last < n) n = B.last;
    const mix = (a: number, b: number) => (Math.imul(a, u) + Math.imul(b, t)) >> 8;
    for (let i = 1; i < n; i++) {
      this.line(mix(A.x[i - 1]!, B.x[i - 1]!), mix(A.y[i - 1]!, B.y[i - 1]!), mix(A.x[i]!, B.x[i]!), mix(A.y[i]!, B.y[i]!), mix(A.f[i]!, B.f[i]!), 0);
    }
  }

  /** 0x1000719D. */
  waveManager(vd: SvpVisData): void {
    const now = this.tick();
    const s = this.settings;
    if (!this.waveStarted) {
      this.pick();
      this.waveStarted = true;
      this.waveFading = 0;
      this.waveLast = now;
      this.waveNext = (this.waveLast + smearSwitchTime(this.rand, s.waveformHold)) | 0;
    }
    if (now >= this.waveNext) {
      this.waveLast = now;
      this.waveFading = this.waveFading === 0 ? 1 : 0;
      if (this.waveFading) {
        this.pick();
        this.waveNext = (this.waveLast + smearSwitchTime(this.rand, s.waveformFade)) | 0;
      } else this.waveNext = (this.waveLast + smearSwitchTime(this.rand, s.waveformHold)) | 0;
    }
    if (this.waveFading) {
      const t = idiv((now - this.waveLast) << 8, (this.waveNext - this.waveLast) | 0);
      const u = 256 - t;
      for (const set of this.records) for (const r of set) { r.x.fill(0); r.y.fill(0); r.f.fill(0); r.last = 0; }
      this.drawWave(vd, 1);
      this.drawWave(vd, 2);
      this.morph(u, t);
    } else this.drawWave(vd, 0);
  }

  /** 0x100073CC with no particle scripts: one chance draw per second. */
  particles(): void {
    const now = this.tick();
    if (this.particleActive < 3 && ((this.particleLastTry + 1000) | 0) < now) {
      this.rand();
      this.particleLastTry = now;
    }
  }

  /** 0x1000673F. */
  output(video: Int32Array, pitch: number): void {
    const w = this.w;
    const bottom = this.top + this.boxH;
    const buf = this.bufs![this.cur];
    for (let y = 0; y < this.h; y++) {
      const row = y * pitch;
      if (y < this.top || y >= bottom) {
        video.fill(0, row, row + w);
        continue;
      }
      let s = this.origin + (y - this.top) * this.bufW;
      for (let x = 0; x < w; x++) video[row + x] = this.palette[buf[s++]!]!;
    }
  }

  /** Render (0x10007F67). */
  render(video: Int32Array, width: number, height: number, pitch: number, vd: SvpVisData, ctx: ApeContext): void {
    this.tick = () => Math.floor(ctx.now()) | 0;
    if (!this.seeded) {
      // Initialize (0x10007A0E): srand(GetTickCount()) on AVS's window thread, no draws; Render's
      // draws run on the render thread, whose per-thread _holdrand starts at 1 (never reseeded).
      this.rand = ctx.makeRand(1);
      this.seeded = true;
    }
    this.w = width;
    this.h = height;
    let boxH = idiv(Math.imul(width, this.settings.letterBox), 100);
    if (boxH > height) boxH = height;
    this.boxH = boxH;
    this.top = idiv(height - boxH, 2);
    if (width <= 0 || boxH <= 0) return;
    this.colorManager();
    this.warp();
    this.waveManager(vd);
    this.particles();
    this.output(video, pitch);
    // titles (0x10007822) need Sonique's query interface; debug overlay (0x10007D49) needs Clicked()
  }
}

export function createSmear(): SvpEffect {
  const engine = new SmearEngine();
  return {
    render(video, width, height, pitch, vd, ctx) {
      engine.render(video, width, height, pitch, vd, ctx);
    }
  };
}

export const svp = {
  file: "smear.svp",
  sha256: ["40736f0a9f90e9a775a335ea431a23fa45fdb992ea77e0b61a3cbc8003c651e1"],
  create(): SvpEffect {
    return createSmear();
  }
};
