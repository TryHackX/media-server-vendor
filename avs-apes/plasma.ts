/*
 * APE "Camillo Plasma: BOX" — plasma.ape, Camillo Ferraris' "SimplePlasma" v1.3, built on Nullsoft's
 * BOX APE tutorial (VC6, static CRT, PE timestamp 2 Oct 2002).
 * Binary sha256 fb57c6f36d3db7f9018242ad2315efae3416184145b183dc1be06e77e399ad2d.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/plasma.md.
 *
 * Config (load_config 0x100025A0; save_config 0x10002840 writes exactly this):
 *   +0  u32 colour1, read only when len >= 4            (constructor default 0xFF0000)
 *   +4  u32 colour2, read only when 4 more bytes remain   (constructor default 0x00FF00)
 *       Both are used as framebuffer pixels as they are (0x00RRGGBB, blue in the low byte); the
 *       top byte is ignored by the palette builder.
 *   then string "X spec", NUL-terminated  (when no byte remains: "1,1")
 *   then string "Y spec", NUL-terminated  (when no byte remains after the first NUL: "1,1")
 *   The three presets in the collection store 16 bytes: two colours, then "1,1"/"2,2"/"3,2" twice.
 *
 * A spec is split by strtok on ",;" (empty tokens skipped); tokens alternate: 1st, 3rd, ... are
 * amplitudes (atoi), 2nd, 4th, ... frequencies ((float)atof). One table per frequency; a trailing
 * amplitude without frequency is parsed but never used.
 *
 * Rebuild (0x100011E0 clear + 0x10001390 build), on the first render and whenever w or h changes:
 *   palette[0..127]   = gradient(colour1 → colour2, 128)       (0x10001000, see gradient())
 *   palette[128..255] = gradient(colour2 → colour1, 128)
 *   cos[i] = (int)floor(cos(2i · 0.0122718462890625) · 64.0), i = 0..255  (the constant is the
 *            double 3.14159265/256 at 0x1000C130; fcos in x87)
 *   X_k[x] = (int)floor(x · fX_k + 0.5), x = 0..w-1    (fX_k float; product and +0.5 in double)
 *   Y_k[y] = (int)floor(y · fY_k + 0.5), y = 0..h-1
 * render (0x10001D70), writes every pixel of framebuffer (replace), returns 0; ignores audio/beat:
 *   s = Σ_k aX_k · cos[|X_k[x] + t| % 256] + Σ_k aY_k · cos[|Y_k[y] + t| % 256]   (int32, wraps)
 *   pixel(x, y) = palette[|s % 256|]        (C remainder: sign of the dividend)
 *   then t = (t + 1) % 256. t starts at 0 and is not reset by a rebuild.
 *
 * Exactness: everything is integer except the table builders, whose floating-point steps are exact
 * here (small integer × float fits in a double; division by 128.0). The cos table equals the
 * mathematically exact floor(64·cos(x)) for every entry — the nearest non-exact entry is 1.1e-7
 * away from an integer — so x87 fcos vs Math.cos and the x87 precision mode cannot change it.
 * Not recoverable / choices of the port: VC6 atof's last-bit rounding vs JS Number() (the value is
 * rounded to float right after, so only exotic inputs could differ); a string that is not
 * NUL-terminated inside the config makes the plug-in read past the buffer — the port stops at the
 * end of the config. The dialog (0x10001FC0) edits colours and the two strings and only sets the
 * rebuild flag; nothing else in the object influences rendering.
 */

export interface ApeContext {
  readonly w: number;                 // frame width and height in pixels
  readonly h: number;
  readonly isBeat: boolean;           // isBeat & 1 of AVS's render() call
  /** AVS's char visdata[2][2][576]: index (kind * 2 + channel) * 576 + i, kind 0 spectrum, 1 waveform. */
  readonly visdata: Int8Array;
  readonly visdataUnsigned: Uint8Array; // the same bytes, unsigned
  /** MSVC rand() (0..32767) of the engine's shared generator (vis_avs's CRT). */
  rand(): number;
  /** A private MSVC rand() for a plug-in linked with its own static CRT (seed as srand). */
  makeRand(seed?: number): () => number;
  /** reg00..reg99 (APEinfo.global_registers), shared with all code of the preset. */
  readonly registers: Float64Array;
  /** *APEinfo.lineblendmode: low byte mode (0 replace, 1 add, 2 max, 3 avg, 4 sub 1-2, 5 sub 2-1,
   *  6 multiply, 7 adjustable, 8 xor, 9 min), bits 8..15 adjustable value, bits 16..23 width. */
  lineBlendMode: number;
  /** APEinfo.getNbuffer(w, h, n, do_alloc): buffer n (0..7) as w*h pixels, or null when it does not
   *  exist and create is false. Writes into it are kept. */
  globalBuffer(index: number, create: boolean): Int32Array | null;
  /** GetTickCount()/timeGetTime() in ms. */
  now(): number;
}
export interface ApeEffect {
  /** AVS's render(): pixels 0x00RRGGBB (blue in the low byte, as AVS's int framebuffer), row 0 at
   *  the top, w * h. Return 1 when the result is in fbout (AVS then swaps), else 0. */
  render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number;
  destroy?(): void;
}

export interface PlasmaConfig {
  colour1: number;   // u32 as stored
  colour2: number;
  xSpec: string;
  ySpec: string;
}

export const PLASMA_DEFAULTS: Readonly<PlasmaConfig> = {
  colour1: 0xff0000,
  colour2: 0x00ff00,
  xSpec: "1,1",
  ySpec: "1,1"
};

/** The double at 0x1000C130: 3.14159265 / 256 (the author's pi, not Math.PI). */
export const COS_STEP = 0.0122718462890625;

/** load_config (0x100025A0). */
export function parsePlasmaConfig(cfg: Uint8Array): PlasmaConfig {
  const len = cfg.length;
  const out: PlasmaConfig = { ...PLASMA_DEFAULTS };
  const u32 = (p: number) => ((cfg[p]! | (cfg[p + 1]! << 8) | (cfg[p + 2]! << 16) | (cfg[p + 3]! << 24)) >>> 0);
  let pos = 0;
  if (len >= 4) { out.colour1 = u32(0); pos = 4; }
  if (len - pos >= 4) { out.colour2 = u32(pos); pos += 4; }
  // String: "" then the bytes up to the NUL (or, in the port, the end of the config).
  const readString = (): string => {
    let s = "";
    while (pos < len && cfg[pos] !== 0) s += String.fromCharCode(cfg[pos++]!);
    return s;
  };
  if (len - pos > 0) out.xSpec = readString(); else out.xSpec = "1,1";
  pos++; // past the NUL
  if (len - pos > 0) out.ySpec = readString(); else out.ySpec = "1,1";
  return out;
}

/** save_config (0x10002840): colour1, colour2 (4 bytes each, little-endian), both strings + NUL. */
export function serializePlasmaConfig(c: PlasmaConfig): Uint8Array {
  const out = new Uint8Array(8 + c.xSpec.length + 1 + c.ySpec.length + 1);
  for (let i = 0; i < 4; i++) {
    out[i] = (c.colour1 >>> (8 * i)) & 0xff;
    out[4 + i] = (c.colour2 >>> (8 * i)) & 0xff;
  }
  let p = 8;
  for (const s of [c.xSpec, c.ySpec]) {
    for (let i = 0; i < s.length; i++) out[p++] = s.charCodeAt(i) & 0xff;
    out[p++] = 0;
  }
  return out;
}

const isCSpace = (c: number) => c === 0x20 || (c >= 0x09 && c <= 0x0d);

/** VC6 atol/atoi: skip isspace, optional sign, decimal digits, wrapping int32 accumulation. */
export function vcAtoi(s: string): number {
  let i = 0;
  while (i < s.length && isCSpace(s.charCodeAt(i))) i++;
  const sign = s.charCodeAt(i);
  if (sign === 0x2d || sign === 0x2b) i++;
  let total = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) break;
    total = (Math.imul(total, 10) + (c - 0x30)) | 0;
  }
  return sign === 0x2d ? (-total | 0) : total;
}

/** VC6 atof: skip isspace, then [sign] digits [. digits] [e|E|d|D [sign] digits]; 0 when no digits. */
export function vcAtof(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?)(\d*)(?:\.(\d*))?(?:[eEdD]([+-]?\d+))?/.exec(s);
  if (!m) return 0;
  const ip = m[2] ?? "", fp = m[3] ?? "";
  if (ip === "" && fp === "") return 0;
  return Number(`${m[1] ?? ""}${ip || "0"}.${fp || "0"}e${m[4] ?? "0"}`);
}

/** strtok(spec, ",;") with tokens alternating amplitude (atoi) / frequency ((float)atof). */
export function parsePlasmaSpec(spec: string): { amps: number[]; freqs: number[] } {
  const amps: number[] = [];
  const freqs: number[] = [];
  let k = 0;
  for (const tok of spec.split(/[,;]/)) {
    if (tok === "") continue;
    if (k === 0) amps.push(vcAtoi(tok));
    else freqs.push(Math.fround(vcAtof(tok)));
    k = (k + 1) % 2;
  }
  return { amps, freqs };
}

/** MSVC _ftol: truncate, keep the low 32 bits of the 64-bit result; NaN/out of range → 0. */
export function ftol(v: number): number {
  if (v > -2147483649 && v < 2147483648) return Math.trunc(v) | 0;
  if (!(Math.abs(v) < 9223372036854775808)) return 0;
  return Number(BigInt.asIntN(32, BigInt(Math.trunc(v))));
}

/**
 * 0x10001000 gradient(a, b, n, out): per byte 0..2, step = (int)floor((|a−b|+1) / (float)n + 0.5),
 * direction up when a <= b; out[k] = current colour, then step, clamp at b (and at 0).
 */
export function gradient(a: number, b: number, n: number, out: Int32Array, off: number): void {
  let c0 = a & 0xff, c1 = (a >>> 8) & 0xff, c2 = (a >>> 16) & 0xff;
  const b0 = b & 0xff, b1 = (b >>> 8) & 0xff, b2 = (b >>> 16) & 0xff;
  const nf = Math.fround(n);
  const s0 = ftol(Math.floor((Math.abs(c0 - b0) + 1) / nf + 0.5));
  const s1 = ftol(Math.floor((Math.abs(c1 - b1) + 1) / nf + 0.5));
  const s2 = ftol(Math.floor((Math.abs(c2 - b2) + 1) / nf + 0.5));
  const up0 = c0 <= b0, up1 = c1 <= b1, up2 = c2 <= b2;
  for (let k = 0; k < n; k++) {
    out[off + k] = (c2 << 16) | (c1 << 8) | c0;
    c0 = up0 ? c0 + s0 : c0 - s0;
    c1 = up1 ? c1 + s1 : c1 - s1;
    c2 = up2 ? c2 + s2 : c2 - s2;
    if (up0 ? c0 >= b0 : c0 <= b0) c0 = b0;
    if (up1 ? c1 >= b1 : c1 <= b1) c1 = b1;
    if (up2 ? c2 >= b2 : c2 <= b2) c2 = b2;
    if (c0 <= 0) c0 = 0;
    if (c1 <= 0) c1 = 0;
    if (c2 <= 0) c2 = 0;
  }
}

/** The 256-entry palette at object +0x0C. */
export function buildPalette(colour1: number, colour2: number): Int32Array {
  const pal = new Int32Array(256);
  gradient(colour1, colour2, 128, pal, 0);
  gradient(colour2, colour1, 128, pal, 128);
  return pal;
}

/** The 256-entry cosine table at object +0x40C. */
export function buildCosTable(): Int32Array {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) t[i] = ftol(Math.floor(Math.cos(2 * i * COS_STEP) * 64.0));
  return t;
}

/** One axis table: (int)floor(i · f + 0.5) for i = 0..n-1 (f is a float). */
export function buildAxisTable(n: number, f: number): Int32Array {
  const t = new Int32Array(Math.max(0, n));
  for (let i = 0; i < n; i++) t[i] = ftol(Math.floor(i * f + 0.5));
  return t;
}

export class PlasmaBox implements ApeEffect {
  readonly config: PlasmaConfig;
  phase = 0;                                  // +0x814
  private lastW = 0;                          // +0x8F8
  private lastH = 0;                          // +0x8FC
  private dirty = true;                       // +0x8F4 (set by the constructor)
  palette: Int32Array = new Int32Array(256);
  cosTable: Int32Array = new Int32Array(256);
  private xAmps: number[] = [];
  private yAmps: number[] = [];
  private xTabs: Int32Array[] = [];
  private yTabs: Int32Array[] = [];
  private sx: Int32Array = new Int32Array(0);
  private sy: Int32Array = new Int32Array(0);

  constructor(config: PlasmaConfig) {
    this.config = config;
  }

  private rebuild(w: number, h: number): void {
    this.palette = buildPalette(this.config.colour1, this.config.colour2);
    this.cosTable = buildCosTable();
    const xs = parsePlasmaSpec(this.config.xSpec);
    const ys = parsePlasmaSpec(this.config.ySpec);
    this.xAmps = xs.amps;
    this.yAmps = ys.amps;
    this.xTabs = xs.freqs.map((f) => buildAxisTable(w, f));
    this.yTabs = ys.freqs.map((f) => buildAxisTable(h, f));
    this.sx = new Int32Array(Math.max(0, w));
    this.sy = new Int32Array(Math.max(0, h));
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    const w = ctx.w, h = ctx.h;
    if (this.lastW !== w || this.lastH !== h) {
      this.dirty = true;
      this.lastW = w;
      this.lastH = h;
    }
    if (this.dirty) {
      this.rebuild(w, h);
      this.dirty = false;
    }
    const t = this.phase, cos = this.cosTable, pal = this.palette;
    // Per-column and per-row partial sums; int32 addition wraps, so s = sx[x] + sy[y] is the
    // plug-in's per-pixel sum in any order.
    const sx = this.sx, sy = this.sy;
    sx.fill(0);
    sy.fill(0);
    for (let k = 0; k < this.xTabs.length; k++) {
      const tab = this.xTabs[k]!, a = this.xAmps[k]!;
      for (let x = 0; x < w; x++) {
        sx[x] = (sx[x]! + Math.imul(cos[Math.abs((tab[x]! + t) | 0) % 256]!, a)) | 0;
      }
    }
    for (let k = 0; k < this.yTabs.length; k++) {
      const tab = this.yTabs[k]!, a = this.yAmps[k]!;
      for (let y = 0; y < h; y++) {
        sy[y] = (sy[y]! + Math.imul(cos[Math.abs((tab[y]! + t) | 0) % 256]!, a)) | 0;
      }
    }
    let p = 0;
    for (let y = 0; y < h; y++) {
      const ry = sy[y]!;
      for (let x = 0; x < w; x++) {
        framebuffer[p++] = pal[Math.abs(((sx[x]! + ry) | 0) % 256)]!;
      }
    }
    this.phase = (t + 1) % 256;
    return 0;
  }
}

export const ape = {
  id: "Camillo Plasma: BOX",
  sha256: ["fb57c6f36d3db7f9018242ad2315efae3416184145b183dc1be06e77e399ad2d"],
  create(config: Uint8Array): ApeEffect {
    return new PlasmaBox(parsePlasmaConfig(config));
  }
};
