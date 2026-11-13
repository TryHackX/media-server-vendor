/*
 * APE "Winamp 3DAPE v1" — 3d.ape ("Render APE / 3D"), PE timestamp 4 Dec 1999, VC6, static CRT.
 * Binary sha256 61bf377f3bf5bace3b2ec649c56fa5f51479edea160bac40b071c00ba2d5f276.
 * Port by static reading of the binary (dumpbin /disasm, no execution). Notes with addresses:
 * scratch/avs-reference/apes/winamp-3dape.md.
 *
 * Config (load_config 0x10003E40, save_config 0x10003EF0):
 *   +0  int32  enabled   default 1 (read when len >= 4; render does nothing when 0)
 *   +4  int32  colour    default 0x00FF00 (0x00RRGGBB, read when 4 more bytes remain)
 *   +8  char[] mesh file name, copied up to a NUL or the end of the config (save_config writes the
 *              NUL but returns strlen+8, so presets store the name without it), e.g. "SPHERE.ASC".
 *   The 14 configs in the collection (11 presets) name SPHERE.ASC (9), ANT.ASC (4), CUBE.ASC (1).
 *
 * Mesh: load_config opens <directory of 3d.ape>\<name> in text mode ("rt") and parses it as a
 * 3D Studio ASCII (.ASC) scene with fscanf (0x10002AB0 / 0x10001870). The port reads it from the
 * `files` map given to create(): key = the file name exactly as the preset stores it, lower-cased
 * (keys of the supplied map are compared lower-cased too); value = the .asc text (string, or bytes
 * decoded as Latin-1). A missing file makes the original show a MessageBox ("This effect is using a
 * 3D model you don't have. No object will be loaded") and then draw nothing; the port draws nothing.
 * The parser is reproduced token by token (CRT fscanf %s / %d / %f / %[^:] and fgetc semantics,
 * text-mode CRLF and ^Z handling): every "Tri-mesh," starts an object ("Vertices", "Faces", vertex
 * list X/Y/Z, face list A/B/C; U/V of "Mapped" meshes are skipped), "Direct" (light) and "Camera"
 * sections are read, and the file's Y and Z are swapped (engine x = X, y = Z, z = Y). Without a
 * camera in the file the camera is at (0, 0, 1024) looking at the origin. The original calls
 * exit(1) when a section is malformed ("String ... not found in file.Exitting..."); the port then
 * loads nothing.
 *
 * render (0x10004140), into framebuffer, returns 0; visdata and isBeat are not used at all:
 *   1. every object is rotated by (0°, 1°, 0°) (0x10001570): each frame the float coordinates of all
 *      vertices and face normals are rotated about the engine's y axis by one table degree, so the
 *      motion accumulates float rounding exactly like the original (it is frame-rate dependent:
 *      one degree per rendered frame). Tables: float sin/cos of i * 0.017453292522222223
 *      (3.141592654/180), i = 0..359.
 *   2. vertices are transformed into camera space (right/up/forward vectors from 0x100010A0, all in
 *      float) and projected with a fixed focal length of 256 pixels:
 *        sx = (w>>1) - _ftol(cx/cz * -256), sy = (h>>1) - _ftol(cy/cz * 256)   (only when cz > 0)
 *      _ftol truncates and keeps the low 32 bits of the 64-bit result.
 *   3. faces are drawn as wireframe — the engine's render mode is always 2 (wire) because the mode
 *      variable is 2 and never changed — when dot(normal, camera - A) > 0 (back-face culling) and
 *      all three vertices have cz > 0: lines A-B, B-C, C-A with the plug-in's own line routine
 *      (0x100031A0): a line is skipped entirely unless both ends are inside the frame; otherwise a
 *      16.16 DDA along the major axis, inclusive of both ends, x or y = fixed >> 16, slope by
 *      truncating integer division. Pixels are replaced by the colour (no blending: the plug-in has
 *      no AVS_APE_SetExtInfo export, so it cannot see APEinfo.lineblendmode or the line width).
 *      The objects and faces are depth-sorted with qsort first, but as every line is the same
 *      colour in replace mode the order cannot change the picture, so the port does not sort.
 *
 * Not recovered / approximations:
 *   - The high byte of each written pixel is a stray byte of the line routine's stack (the top byte
 *     of a heap pointer); the port writes 0 there (AVS displays only the low 24 bits).
 *   - The rotation and projection are x87 code; the port assumes the default 53-bit precision
 *     control of a Win32 thread (results rounded to double, then stored as float), which JS
 *     doubles + Float32Array reproduce exactly. The sin/cos tables are exact (every entry is
 *     >= 0.00075 float ulp away from a rounding boundary).
 *   - Decimal numbers in the .asc are converted to float with correct rounding (the CRT goes
 *     through an 80-bit intermediate; ties cannot occur for the files in the packs).
 *   - Faces with a vertex index outside the object would crash the original; the port skips them.
 *   - Lights, vertex normals, textures and the flat/Gouraud fillers exist in the binary but are
 *     never used in mode 2 and are not ported.
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

/** Mesh files by name: key = file name as the preset stores it, lower-cased; value = .asc text. */
export type ApeFiles = Map<string, string | Uint8Array> | Record<string, string | Uint8Array>;

export interface Ape3dConfig {
  enabled: number;
  /** 0x00RRGGBB as stored. */
  color: number;
  /** Mesh file name as stored (e.g. "SPHERE.ASC"). */
  file: string;
}

function readI32(b: Uint8Array, p: number): number {
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) | 0;
}

/** load_config 0x10003E40. */
export function parse3dApeConfig(config: Uint8Array): Ape3dConfig {
  let enabled = 1;
  let color = 0x00ff00;
  const len = config.length;
  let pos = 0;
  if (len >= 4) { enabled = readI32(config, 0); pos = 4; }
  if (len - pos >= 4) { color = readI32(config, pos); pos += 4; }
  let file = "";
  if (pos < len && config[pos] !== 0) {
    for (let p = pos; p < len && config[p]! !== 0; p++) file += String.fromCharCode(config[p]!);
  }
  return { enabled, color, file };
}

// ---------------------------------------------------------------------------------------------
// Tables and number helpers

/** 3.141592654 / 180 as the binary stores it (0x1000C150). */
export const DEG = 0.017453292522222223;

/** 0x100039D0: float sin/cos tables, 360 entries each (fild i; fmul DEG; fsin / fcos; fstp dword). */
export function buildTables(): { sin: Float32Array; cos: Float32Array } {
  const sin = new Float32Array(360);
  const cos = new Float32Array(360);
  for (let i = 0; i < 360; i++) {
    const a = i * DEG;
    sin[i] = Math.sin(a);
    cos[i] = Math.cos(a);
  }
  return { sin, cos };
}
const TABLES = buildTables();

/** 0x10003990 / 0x100039B0: table lookups for a % 360 (negative angles index 360 + a). */
function tsin(a: number): number { return a >= 0 ? TABLES.sin[a]! : TABLES.sin[360 + a]!; }
function tcos(a: number): number { return a >= 0 ? TABLES.cos[a]! : TABLES.cos[360 + a]!; }

/** The CRT's _ftol: truncate (fistp qword with RC=chop) and return the low 32 bits. */
export function ftol(v: number): number {
  if (v !== v || Math.abs(v) >= 9223372036854775808) return 0; // integer indefinite 0x8000000000000000
  const t = Math.trunc(v);
  if (Math.abs(t) < 2147483648) return t | 0;
  return Number(BigInt.asIntN(32, BigInt(t)));
}

/** Correctly rounded decimal -> float32 (round half to even). */
function decimalToFloat32(negative: boolean, digits: string, exp10: number): number {
  const stripped = digits.replace(/^0+/, "");
  if (stripped === "") return negative ? -0 : 0;
  let num = BigInt(stripped);
  let den = 1n;
  if (exp10 >= 0) num *= 10n ** BigInt(exp10); else den = 10n ** BigInt(-exp10);
  // choose e2 so that 2^23 <= num / (den * 2^e2) < 2^24
  let e2 = num.toString(2).length - den.toString(2).length - 24;
  let m = 0n;
  let rem = 0n;
  let d = 0n;
  for (;;) {
    let n2 = num;
    d = den;
    if (e2 >= 0) d = den << BigInt(e2); else n2 = num << BigInt(-e2);
    m = n2 / d;
    rem = n2 - m * d;
    if (m < 8388608n) { e2--; continue; }
    if (m >= 16777216n) { e2++; continue; }
    break;
  }
  if (e2 < -149) {
    // subnormal range: recompute at the fixed exponent -149
    const n2 = num << 149n;
    m = n2 / den;
    rem = n2 - m * den;
    d = den;
    e2 = -149;
  }
  const twice = rem * 2n;
  if (twice > d || (twice === d && (m & 1n) === 1n)) m += 1n;
  let v = Number(m) * Math.pow(2, e2);
  if (v > 3.4028234663852886e38) v = Infinity;
  return Math.fround(negative ? -v : v);
}

// ---------------------------------------------------------------------------------------------
// CRT text stream + fscanf subset (MSVC 6 _input semantics)

function isSpace(c: number): boolean { return c === 32 || (c >= 9 && c <= 13); }
function isDigit(c: number): boolean { return c >= 48 && c <= 57; }

export class CrtTextStream {
  private readonly s: string;
  private i = 0;
  /** FILE._flag & _IOEOF: set once a read hits the end. */
  eof = false;
  constructor(text: string) {
    let t = text;
    const z = t.indexOf("\x1a"); // ^Z ends a text-mode file
    if (z >= 0) t = t.slice(0, z);
    this.s = t.replace(/\r\n/g, "\n");
  }
  getc(): number {
    if (this.i >= this.s.length) { this.eof = true; return -1; }
    return this.s.charCodeAt(this.i++) & 0xff;
  }
  private unget(c: number): void { if (c !== -1) this.i--; }
  private skipWhite(): number {
    for (;;) {
      const c = this.getc();
      if (c === -1 || !isSpace(c)) return c;
    }
  }
  /** fscanf "%s"; null when nothing was read (the buffer keeps its old contents). */
  scanS(): string | null {
    let c = this.skipWhite();
    if (c === -1) return null;
    let out = "";
    while (c !== -1 && !isSpace(c)) { out += String.fromCharCode(c); c = this.getc(); }
    this.unget(c);
    return out;
  }
  /** fscanf "%d"; null on a matching failure (the variable keeps its old value). */
  scanD(): number | null {
    let c = this.skipWhite();
    if (c === -1) return null;
    let neg = false;
    if (c === 45) { neg = true; c = this.getc(); } else if (c === 43) c = this.getc();
    let any = false;
    let v = 0;
    while (c !== -1 && isDigit(c)) { any = true; v = (Math.imul(v, 10) + (c - 48)) | 0; c = this.getc(); }
    this.unget(c);
    if (!any) return null;
    return neg ? (-v | 0) : v;
  }
  /** fscanf "%f" into a float; null on a matching failure. */
  scanF(): number | null {
    let c = this.skipWhite();
    if (c === -1) return null;
    let neg = false;
    let width = 255;
    if (c === 45) { neg = true; width--; c = this.getc(); } else if (c === 43) { width--; c = this.getc(); }
    let started = 0;
    let digits = "";
    let exp10 = 0;
    while (isDigit(c) && width-- > 0) { started++; digits += String.fromCharCode(c); c = this.getc(); }
    if (c === 46 && width-- > 0) {
      c = this.getc();
      while (isDigit(c) && width-- > 0) { started++; digits += String.fromCharCode(c); exp10--; c = this.getc(); }
    }
    if (started && (c === 101 || c === 69) && width-- > 0) {
      let eneg = false;
      c = this.getc();
      if (c === 45) { eneg = true; if (width) c = this.getc(); else width++; }
      else if (c === 43) { if (width) c = this.getc(); else width++; }
      let e = 0;
      while (isDigit(c) && width-- > 0) { started++; if (e < 100000) e = e * 10 + (c - 48); c = this.getc(); }
      exp10 += eneg ? -e : e;
    }
    this.unget(c);
    if (!started) return null;
    return decimalToFloat32(neg, digits, exp10);
  }
  /** fscanf "%[^:]" (no white-space skipping); null when the next character is ':' or EOF. */
  scanNotColon(): string | null {
    let out = "";
    let c = this.getc();
    while (c !== -1 && c !== 58) { out += String.fromCharCode(c); c = this.getc(); }
    this.unget(c);
    return out === "" ? null : out;
  }
}

// ---------------------------------------------------------------------------------------------
// .ASC scene

export interface AscObject {
  /** Vertex rel coordinates x, y, z (engine axes: file X, Z, Y), float. */
  verts: Float32Array;
  /** Faces as vertex indices a, b, c. */
  faces: Int32Array;
}
export interface AscScene {
  objects: AscObject[];
  /** The first camera: position and target (engine axes). */
  camera: { px: number; py: number; pz: number; tx: number; ty: number; tz: number };
}

class AscFatal extends Error {}

/** Reads tokens with "%s" until one starts with `lit` (strncmp(buf, lit, strlen(lit))). */
function findToken(f: CrtTextStream, buf: { v: string }, lit: string, onToken?: () => void): void {
  if (buf.v.startsWith(lit)) return;
  do {
    if (onToken) onToken();
    const t = f.scanS();
    if (t !== null) buf.v = t;
    if (f.eof) throw new AscFatal(lit);
  } while (!buf.v.startsWith(lit));
}

/** Reads "%[^:]", fgetc, "%f" (the X:/Y:/Z: fields); returns the old value when %f fails. */
function readField(f: CrtTextStream, buf: { v: string }, old: number): number {
  const t = f.scanNotColon();
  if (t !== null) buf.v = t;
  f.getc();
  const v = f.scanF();
  return v === null ? old : v;
}

/** 0x10001870: one "Tri-mesh," object. */
function parseObject(f: CrtTextStream, mode: { v: number }): AscObject {
  const buf = { v: "" };
  let objMode = 5;
  findToken(f, buf, "Vertices");
  f.getc();
  const nv = f.scanD() ?? 0;
  findToken(f, buf, "Faces");
  f.getc();
  const nf = f.scanD() ?? 0;
  findToken(f, buf, "Vertex", () => { if (buf.v.startsWith("Mapped") && mode.v === 9) objMode = 9; });
  if (objMode !== 9) {
    if (mode.v >= 1 && mode.v <= 8) objMode = mode.v;
    else { objMode = 5; mode.v = 5; }
  }
  findToken(f, buf, "list:");
  const verts: number[] = [];
  let x = 0, y = 0, z = 0, u = 0, w = 0;
  for (let i = 0; i < nv; i++) {
    findToken(f, buf, "Vertex");
    f.scanD();
    const t = f.scanS();
    if (t !== null) buf.v = t;
    x = readField(f, buf, x);
    y = readField(f, buf, y);
    z = readField(f, buf, z);
    if (objMode === 9) { u = readField(f, buf, u); w = readField(f, buf, w); }
    verts.push(x, z, y); // addVertex(X, Z, Y)
  }
  findToken(f, buf, "Face");
  findToken(f, buf, "list");
  const faces: number[] = [];
  let a = 0, b = 0, c = 0;
  const skipTo = (ch: number): void => {
    for (;;) {
      const g = f.getc();
      if (g === ch) return;
      if (g === -1) throw new AscFatal("EOF in face"); // the original loops forever here
    }
  };
  for (let i = 0; i < nf; i++) {
    findToken(f, buf, "Face");
    f.scanD();
    const t = f.scanS();
    if (t !== null) buf.v = t;
    skipTo(65); f.getc(); a = f.scanD() ?? a;
    skipTo(66); f.getc(); b = f.scanD() ?? b;
    skipTo(67); f.getc(); c = f.scanD() ?? c;
    faces.push(a, b, c);
  }
  return { verts: new Float32Array(verts), faces: new Int32Array(faces) };
}

/** 0x10002AB0 (+ 0x10002D10 light, 0x10002DC0 camera). Returns null where the original exits. */
export function parseAsc(text: string): AscScene | null {
  const f = new CrtTextStream(text);
  const objects: AscObject[] = [];
  let camera: AscScene["camera"] | null = null;
  const mode = { v: 2 }; // engine +0x2C, never changed
  const buf = { v: "" };
  try {
    if (!f.eof) {
      do {
        const t = f.scanS();
        if (t !== null) buf.v = t;
        if (buf.v === "Tri-mesh,") objects.push(parseObject(f, mode));
        if (buf.v === "Direct") {
          findToken(f, buf, "Position:");
          const lb = { v: "" };
          readField(f, lb, 0); readField(f, lb, 0); readField(f, lb, 0); // light: unused in wire mode
        }
        if (buf.v === "Camera") {
          findToken(f, buf, "Position:");
          const cb = { v: "" };
          const px = readField(f, cb, 0), py = readField(f, cb, 0), pz = readField(f, cb, 0);
          findToken(f, cb, "Target:");
          const tx = readField(f, cb, 0), ty = readField(f, cb, 0), tz = readField(f, cb, 0);
          if (!camera) camera = { px, py: pz, pz: py, tx, ty: tz, tz: ty }; // addCamera(X, Z, Y, ...)
        }
      } while (!f.eof);
    }
  } catch (e) {
    if (e instanceof AscFatal) return null;
    throw e;
  }
  return { objects, camera: camera ?? { px: 0, py: 0, pz: 1024, tx: 0, ty: 0, tz: 0 } };
}

// ---------------------------------------------------------------------------------------------
// Engine

/** Camera basis of 0x100010A0 (float members of the camera object). */
export interface CameraBasis {
  px: number; py: number; pz: number;
  dx: number; dy: number; dz: number; // forward  (+0x0C)
  ux: number; uy: number; uz: number; // up       (+0x18)
  rx: number; ry: number; rz: number; // right    (+0x24)
}

const f32 = Math.fround;

export function cameraBasis(c: AscScene["camera"]): CameraBasis {
  const px = f32(c.px), py = f32(c.py), pz = f32(c.pz);
  // 0x10002280 into the engine's scratch point, then 0x10002140 (normalise)
  const tx = f32(f32(c.tx) - px), ty = f32(f32(c.ty) - py), tz = f32(f32(c.tz) - pz);
  const len = Math.sqrt((tx * tx + ty * ty) + tz * tz);
  const dx = f32(tx / len), dy = f32(ty / len), dz = f32(tz / len);
  const P = -(dy * dx);
  const L1 = f32(1.0 - dy * dy);
  const L2 = f32(-(dz * dy));
  const Lf = f32(Math.sqrt((L1 * L1 + L2 * L2) + P * P));
  const uxd = P / Lf, uyd = L1 / Lf, uzd = L2 / Lf; // kept unrounded on the FPU stack
  return {
    px, py, pz, dx, dy, dz,
    ux: f32(uxd), uy: f32(uyd), uz: f32(uzd),
    rx: f32(uyd * dz - uzd * dy),
    ry: f32(uzd * dx - uxd * dz),
    rz: f32(uxd * dy - uyd * dx),
  };
}

/** Face normal of 0x10002360: normalize((c - a) x (b - a)) from rel coordinates. */
export function faceNormal(v: Float32Array, a: number, b: number, c: number, out: Float32Array, o: number): void {
  const e1x = v[b * 3]! - v[a * 3]!, e2x = v[c * 3]! - v[a * 3]!;
  const e1y = v[b * 3 + 1]! - v[a * 3 + 1]!, e2y = v[c * 3 + 1]! - v[a * 3 + 1]!;
  const e1z = v[b * 3 + 2]! - v[a * 3 + 2]!, e2z = v[c * 3 + 2]! - v[a * 3 + 2]!;
  const A = f32(e1z * e2y - e2z * e1y);
  const B = f32(e2z * e1x - e1z * e2x);
  const C = e1y * e2x - e2y * e1x;
  const len = f32(Math.sqrt((C * C + B * B) + A * A));
  out[o] = A / len;
  out[o + 1] = B / len;
  out[o + 2] = C / len;
}

/** 0x10001570 rotation coefficients for angles (degrees): [sinX, cosX, sinY, cosY, sinZ, cosZ]. */
export function rotationCoefficients(ax: number, ay: number, az: number): Float64Array {
  const x = ax % 360, y = ay % 360, z = az % 360;
  return Float64Array.of(tsin(x), tcos(x), tsin(y), tcos(y), tsin(z), tcos(z));
}

/** 0x100020B0: rotate the float triple at p in place (rel coordinates). */
export function rotatePoint(r: Float32Array, p: number, cs: Float64Array): void {
  const rx = r[p]!, ry = r[p + 1]!, rz = r[p + 2]!;
  const t1 = rx * cs[5]! - ry * cs[4]!;
  const t2 = ry * cs[5]! + rx * cs[4]!;
  r[p + 1] = t2 * cs[1]! - rz * cs[0]!;
  const u = rz * cs[1]! + t2 * cs[0]!;
  r[p] = u * cs[2]! + t1 * cs[3]!;
  r[p + 2] = u * cs[3]! - t1 * cs[2]!;
}

/** 0x100031A0: the plug-in's line (replace, both ends must be inside the frame). */
export function drawLine(fb: Int32Array, w: number, h: number,
  x1: number, y1: number, x2: number, y2: number, color: number): void {
  const maxX = w - 1, maxY = h - 1;
  if (x1 < 0 || x1 > maxX || y1 < 0 || y1 > maxY) return;
  if (x2 < 0 || x2 > maxX || y2 < 0 || y2 > maxY) return;
  const ady = Math.abs(y1 - y2), adx = Math.abs(x1 - x2);
  if (ady > adx) {
    let tx = x1, ty = y1, bx = x2, by = y2;
    if (y1 > y2) { tx = x2; ty = y2; bx = x1; by = y1; }
    let slope = (tx - bx) << 16;
    const d = ty - by;
    if (d !== 0) slope = (slope / d) | 0;
    let xf = tx << 16;
    for (let y = ty; y <= by; y++) {
      fb[y * w + (xf >> 16)] = color;
      xf = (xf + slope) | 0;
    }
  } else {
    let lx = x1, ly = y1, rx = x2, ry = y2;
    if (x1 > x2) { lx = x2; ly = y2; rx = x1; ry = y1; }
    let slope = (ly - ry) << 16;
    const d = lx - rx;
    if (d !== 0) slope = (slope / d) | 0;
    let yf = ly << 16;
    for (let x = lx; x <= rx; x++) {
      fb[(yf >> 16) * w + x] = color;
      yf = (yf + slope) | 0;
    }
  }
}

interface MeshObject {
  rel: Float32Array;     // vertex rel coordinates (pivot is (0,0,0), so pos = 0 + rel)
  normals: Float32Array; // face normal rel coordinates
  faces: Int32Array;
  cz: Float32Array;
  sx: Int32Array;
  sy: Int32Array;
}

export function buildObjects(scene: AscScene): MeshObject[] {
  const out: MeshObject[] = [];
  for (const o of scene.objects) {
    const nv = o.verts.length / 3;
    const fl: number[] = [];
    for (let i = 0; i < o.faces.length; i += 3) {
      const a = o.faces[i]!, b = o.faces[i + 1]!, c = o.faces[i + 2]!;
      if (a < 0 || b < 0 || c < 0 || a >= nv || b >= nv || c >= nv) continue; // would crash the original
      fl.push(a, b, c);
    }
    const faces = new Int32Array(fl);
    const normals = new Float32Array(faces.length);
    for (let i = 0; i < faces.length; i += 3) faceNormal(o.verts, faces[i]!, faces[i + 1]!, faces[i + 2]!, normals, i);
    out.push({
      rel: Float32Array.from(o.verts), normals, faces,
      cz: new Float32Array(nv), sx: new Int32Array(nv), sy: new Int32Array(nv),
    });
  }
  return out;
}

/** 0x10001F70 + 0x10001FF0 for one vertex. */
export function projectVertex(o: { rel: Float32Array; cz: Float32Array; sx: Int32Array; sy: Int32Array },
  i: number, cam: CameraBasis, hw: number, hh: number): void {
  const X = (o.rel[i * 3]! + 0) - cam.px; // pos = pivot(0) + rel, then minus the camera position
  const Y = (o.rel[i * 3 + 1]! + 0) - cam.py;
  const Z = (o.rel[i * 3 + 2]! + 0) - cam.pz;
  const cx = f32((Z * cam.rz + Y * cam.ry) + X * cam.rx);
  const cy = f32((Z * cam.uz + Y * cam.uy) + X * cam.ux);
  const cz = f32((Z * cam.dz + Y * cam.dy) + X * cam.dx);
  o.cz[i] = cz;
  if (cz > 0) {
    o.sx[i] = (hw - ftol((cx / cz) * -256.0)) | 0;
    o.sy[i] = (hh - ftol((cy / cz) * 256.0)) | 0;
  }
}

export class Winamp3dApe implements ApeEffect {
  readonly config: Ape3dConfig;
  readonly scene: AscScene | null;
  private readonly objects: MeshObject[];
  private readonly cam: CameraBasis | null;
  private readonly cs: Float64Array = rotationCoefficients(0, 1, 0);
  /** Rendered (rotated) frames since the mesh was loaded. */
  frames = 0;

  constructor(config: Uint8Array, files?: ApeFiles) {
    this.config = parse3dApeConfig(config);
    let scene: AscScene | null = null;
    if (this.config.file !== "") {
      const text = lookupFile(files, this.config.file);
      if (text !== null) scene = parseAsc(text);
    }
    this.scene = scene;
    this.objects = scene ? buildObjects(scene) : [];
    this.cam = scene ? cameraBasis(scene.camera) : null;
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    if (!this.config.enabled || !this.scene || !this.cam) return 0;
    const w = ctx.w, h = ctx.h;
    const cs = this.cs;
    for (const o of this.objects) {
      for (let p = 0; p < o.rel.length; p += 3) rotatePoint(o.rel, p, cs);
      for (let p = 0; p < o.normals.length; p += 3) rotatePoint(o.normals, p, cs);
    }
    this.frames++;
    const hw = w >> 1, hh = h >> 1;
    const cam = this.cam;
    for (const o of this.objects) {
      const nv = o.cz.length;
      for (let i = 0; i < nv; i++) projectVertex(o, i, cam, hw, hh);
    }
    const color = this.config.color & 0xffffff;
    for (const o of this.objects) {
      const f = o.faces, n = o.normals, r = o.rel;
      for (let i = 0; i < f.length; i += 3) {
        const a = f[i]!, b = f[i + 1]!, c = f[i + 2]!;
        // back-face test 0x100027E0: dot(normal, camera - A) > 0, with camera - A stored as float
        const tx = f32(cam.px - (r[a * 3]! + 0));
        const ty = f32(cam.py - (r[a * 3 + 1]! + 0));
        const tz = f32(cam.pz - (r[a * 3 + 2]! + 0));
        const dot = (n[i + 2]! * tz + n[i + 1]! * ty) + n[i]! * tx;
        if (!(dot > 0)) continue;
        if (!(o.cz[a]! > 0) || !(o.cz[b]! > 0) || !(o.cz[c]! > 0)) continue;
        drawLine(framebuffer, w, h, o.sx[a]!, o.sy[a]!, o.sx[b]!, o.sy[b]!, color);
        drawLine(framebuffer, w, h, o.sx[b]!, o.sy[b]!, o.sx[c]!, o.sy[c]!, color);
        drawLine(framebuffer, w, h, o.sx[c]!, o.sy[c]!, o.sx[a]!, o.sy[a]!, color);
      }
    }
    return 0;
  }
}

function decodeLatin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

function lookupFile(files: ApeFiles | undefined, name: string): string | null {
  if (!files) return null;
  const key = name.toLowerCase();
  const entries: Iterable<[string, string | Uint8Array]> =
    files instanceof Map ? files.entries() : Object.entries(files);
  for (const [k, v] of entries) {
    if (k.toLowerCase() === key) return typeof v === "string" ? v : decodeLatin1(v);
  }
  return null;
}

export const ape = {
  id: "Winamp 3DAPE v1",
  sha256: ["61bf377f3bf5bace3b2ec649c56fa5f51479edea160bac40b071c00ba2d5f276"],
  /** files: mesh texts keyed by the file name as stored in the preset, lower-case (e.g. "sphere.asc"). */
  create(config: Uint8Array, files?: ApeFiles): ApeEffect {
    return new Winamp3dApe(config, files);
  },
};
