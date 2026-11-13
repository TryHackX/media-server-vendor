/**
 * Cthugha98 0.6a for 3Dfx (Glide 2), (c) 1998 Kevin "Zaph" Burfitt, Torps Productions;
 * postcardware, non-commercial use only, with credit; ported from the executable by static
 * analysis; never committed.
 *
 * The 3D views of Cthugha98-3dfx.exe: Cthugha's buffer as a coloured height field (or the
 * special's particles as points) drawn through Glide 2 on a Voodoo, 640 × 480. Addresses are
 * those of Cthugha98-3dfx.exe; "2D" marks the matching address in Cthugha98.exe (the 2D build,
 * which the rest of the c98 port follows).
 *
 * The CPU side is exact: every value the program stored as a float is a Math.fround here, the
 * sums and products in between are doubles, as the x87 computed them at its default precision
 * (53 bits; MSVC's CRT and the sin/cos wrappers keep control word 0x27F, and Glide is taken
 * not to change it); cos/sin are the x87's fcos/fsin, taken as Math.cos/Math.sin (their
 * float results agree). What reached Glide is in GlidePrimitives. GlideView
 * then does what Glide and the Voodoo did with it, in WebGL 2: clear to black and far, Gouraud
 * colours iterated linearly on the screen, the W-buffer's 16-bit "floating point" 1/w compared
 * LESS with writes (so close surfaces z-fight as they did), 1-pixel points, the 16-bit
 * framebuffer's RGB 5-6-5 with Glide's default 4 × 4 ordered dither.
 *
 * How Cthugha98-3dfx ran it (what the engine has to provide):
 * - Glide is opened at start-up (0x401014) unless the "3DFX → 3dfx" menu item (0x44B0D0, on by
 *   default) is off: grSstWinOpen 640 × 480 at 60 Hz, origin upper left; colour combine
 *   LOCAL_ITERATED (vertex colours only); W-buffer, LESS, depth writes on. No texture, fog,
 *   alpha or culling. It also makes the program's screen (0x44BC80/84, 2D 0x448C48/4C)
 *   256 × 256, so the buffer is 256 × 256 over the display's divisors (BUFF_WIDTH/HEIGHT
 *   0x44BC74/78, 2D 0x448C3C/40) and the displays compose 256 × 256; Glide's is 640 × 480.
 * - The engine runs as in the 2D build (flame, wave, palette fade, displays, the changes), at
 *   60 frames a second: each frame ends in a display function calling the blitter
 *   (0x404166, 2D 0x40295D) with (buffer, flipped); in 3D mode the blitter only calls
 *   0x401122(buffer, flipped) = GlideState.frame(). Nothing of the 2D blit, flip or title runs.
 * - `buffer`: what the display handed the blitter: buff (0x54AA08, 2D 0x481F78) for
 *   "Upwards" and "Downwards", the composed second buffer (0x54AA0C, 2D 0x481F7C) for
 *   "Hor. Split out/in", "Kaleidescope" and the three "90deg" displays — so the splits and
 *   kaleidoscopes are mirrored height fields. 256 × 256 bytes.
 * - `flipped`: 1 from "Downwards" only (0x412087). It flips nothing in 3D: it picks the camera.
 *   flipped → tilt 15° and the field moved down 0.25 (a low view over a landscape in the lower
 *   half of the screen); otherwise tilt 90° (looking straight down on it, bright parts rising
 *   towards the viewer, the field turning in the middle of the screen).
 * - `special`: 0x54A9F8 (2D 0x481F68), set at each full change to rand() & 1 ? rand() % 4 : 0.
 *   While it is not 0 the special sequence (0x408DD0, 2D 0x40F2D0) runs instead of the normal
 *   frames, and the 3D view shows its particles (0x54AA40, 2D 0x4A96F8: 2500 records; count
 *   0x44BE24, 2D 0x4799CC, -1 until the particle effect 0x4091C8 / 2D 0x40F6C2 first runs)
 *   as points instead of the buffer. Both of the special's effects (0x4091C8, 0x40A221) move
 *   these particles and fill them on their first frame. Had they never been filled, the
 *   executable's unsigned transform loop would run away (a crash); here nothing is drawn.
 * - `palette`: the current palette (0x54A5A4, 2D 0x481B14), 8-bit RGB, read live every frame.
 * - Pacing: grBufferSwap(1) waits for a 60 Hz retrace and 0x401122 sleeps to 16 ms a frame
 *   (0x44B514; the "30fps" menu item makes it 33): one engine frame per 60 Hz frame.
 * - What the user could switch: 3dfx on/off (restart), 30/60 fps, the display (which camera),
 *   and through the usual keys flame/wave/palette/display — the special comes at random.
 *
 * The camera turns 0.5° a drawn frame about the field's vertical axis (a turn in 12 s); field
 * and points each keep their own angle, and the heights (a 64 × 64 grid sampling every fourth
 * pixel, -byte/512 smoothed 7/8 old + 1/8 new each field frame) persist across everything; the
 * colours are this frame's bytes through the palette. The buffer's row number runs along the
 * field's x (left to right on the screen at angle 0), its column number along the field's z
 * (into the screen in the low view, upwards in the top view): the picture lies transposed.
 *
 * Quirks kept: vertices off the screen are clamped to 0…638 × 0…478 (spikes squashed onto
 * the border); the W-buffer gets |1/(z + 100)|, so its 12-bit mantissa resolves only about
 * 0.02 of the field's depth and the first-drawn triangle wins near-ties; the points' screen
 * centre is (480, 360) (the projection's 0…1 result mapped as if it were -1…1); 4:3-stretched
 * field pixels (639 × 479 for one unit of x/z, y/z).
 *
 * Cthugha97a5-3D (alpha 0.5, June 1998, the time of the torps screenshots) drew the same two
 * cameras a little differently: no clamp, alternating diagonals, heights (h + 3y)/4, oow
 * 1/(z + 1), turning the other way, a "fast mode" with fewer triangles. Not ported here.
 */

const f = Math.fround;

/** The Voodoo's screen (GR_RESOLUTION_640x480). */
export const GLIDE_WIDTH = 640;
export const GLIDE_HEIGHT = 480;
/** The height field's vertices a side (0x40) and in all (0x1000). */
export const GRID = 64;
const VERTICES = GRID * GRID;
/** Floats a vertex in GlidePrimitives.vertices: x, y, oow, r, g, b. */
export const VERTEX_FLOATS = 6;
/** 0x43F678: 3 << 18, added to the field's x and y to snap them to 1/16 pixel (never removed). */
export const SNAP_BIAS = 786432;
/** 0x44B514: the frame time in ms, 16 ("60fps", the default) or 33 ("30fps"). */
export const FRAME_MS = 16;
/** The special's particle records (0x9C4). */
export const PARTICLES = 2500;
/** 0x43F6A4: degrees to radians, (float)(3.14159f / 180), bits 0x3C8EFA2E. */
const DEG = f(f(3.14159) / 180);
/** 0x44B0DC, 0x44B0E0: the field's screen scale (their setter 0x401FD9 is never called). */
const SCALE_X = 639;
const SCALE_Y = 479;
/** 0x401DF1: the clamp of the field's vertices. */
const MAX_X = 638;
const MAX_Y = 478;
/** 0x3F8CCCCD: 1.1f, the camera distance. */
const DISTANCE = f(1.1);

/** The special's particles as the points view reads them (0x54AA40, 28-byte records). */
export interface GlideParticles {
  /** 0x44BE24: records in use; -1 until the particle effect first ran, then 2500. */
  count: number;
  /** +0, +4, +8: position, x in 0…W, y in 0…H, z around 0 (floats). */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  /** +0x18: the colour index. */
  colour: ArrayLike<number>;
}

/** What the blitter got this frame, and the state the 3D view read besides. */
export interface GlideInput {
  /** The buffer handed to the blitter, `width × height` bytes (256 × 256); only the field reads it. */
  buffer: Uint8Array;
  /** The current palette, 768 bytes of 8-bit RGB. */
  palette: Uint8Array;
  /** The blitter's second argument: true from "Downwards" only. */
  flipped: boolean;
  /** 0x54A9F8: not 0 while the special runs → points. */
  special: number;
  /** The special's particles (null: none yet). */
  particles?: GlideParticles | null;
  /** The program's screen (0x44BC80, 0x44BC84; 2D 0x448C48/4C), 256 × 256: the points' x and y range. */
  width?: number;
  height?: number;
}

/**
 * One frame's Glide calls after grBufferClear(0, 0, 0xFFFF), before grBufferSwap(1).
 * `vertices` hold VERTEX_FLOATS floats each, as the code filled the GrVertex it passed:
 * - "field": the 4096 grid vertices (row-major, row = buffer y / 4); x and y still carry
 *   SNAP_BIAS (the Voodoo's 12.4 conversion dropped it: see fieldXY()); `triangles` lists
 *   3 vertex indices per grDrawTriangle call, in call order (FIELD_TRIANGLES).
 * - "points": vertices 0 … pointCount-1, one per grDrawPoint call in call order, x and y as
 *   passed (Glide snapped them to a pixel: see pointPixel()).
 * oow is the W-buffer's 1/w; r, g, b are 0…255.
 */
export interface GlidePrimitives {
  mode: "field" | "points";
  vertices: Float32Array;
  vertexCount: number;
  triangles: Uint16Array;
  triangleCount: number;
  pointCount: number;
}

/** The field's triangles (0x401528): per quad (j, i), (P[j][i], P[j+1][i], P[j+1][i+1]) then (P[j][i], P[j][i+1], P[j+1][i+1]). */
export const FIELD_TRIANGLES: Uint16Array = (() => {
  const out = new Uint16Array((GRID - 1) * (GRID - 1) * 6);
  let n = 0;
  for (let j = 0; j < GRID - 1; j += 1) {
    for (let i = 0; i < GRID - 1; i += 1) {
      const a = j * GRID + i;
      const b = (j + 1) * GRID + i;
      const c = (j + 1) * GRID + i + 1;
      const d = j * GRID + i + 1;
      out[n++] = a;
      out[n++] = b;
      out[n++] = c;
      out[n++] = a;
      out[n++] = d;
      out[n++] = c;
    }
  }
  return out;
})();

export function createPrimitives(): GlidePrimitives {
  return {
    mode: "field",
    vertices: new Float32Array(VERTICES * VERTEX_FLOATS),
    vertexCount: 0,
    triangles: FIELD_TRIANGLES,
    triangleCount: 0,
    pointCount: 0
  };
}

/** A field vertex's x or y as the Voodoo rasterised it: the code's value minus the snap bias (exact). */
export function fieldXY(value: number): number {
  return value - SNAP_BIAS;
}

/** The pixel grDrawPoint lit for a coordinate: snapped to 1/16 like the rest, then its pixel. */
export function pointPixel(value: number): number {
  return Math.floor(f(value + SNAP_BIAS) - SNAP_BIAS);
}

/**
 * The Voodoo's W-buffer value for an iterated 1/w (wBufferSelect): 1/w as 16.32 fixed point,
 * as a 4-bit exponent (leading zeros of the fraction) and the next 12 bits inverted, plus 1
 * (MAME's voodoo.c). Smaller is nearer; 1/w ≥ 1 gives 0, below 2^-16 gives 0xFFFF.
 */
export function voodooDepth(oow: number): number {
  if (!(oow < 1)) return 0;
  const temp = Math.floor(oow * 4294967296) >>> 0;
  if (temp < 0x10000) return 0xffff;
  const exp = Math.clz32(temp);
  const value = (((exp << 12) | ((~temp >>> (19 - exp)) & 0xfff)) + 1) >>> 0;
  return Math.min(value, 0xffff);
}

/** Glide's default dither (GR_DITHER_4x4) to the framebuffer's 5-6-5, rows from the top (MAME's tables). */
const DITHER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** One 0…255 channel at pixel (x, y) through the dither to 5 bits (6 for green), widened back to 8. */
export function voodooDither(value: number, x: number, y: number, green: boolean): number {
  const v = Math.max(0, Math.min(255, Math.floor(value)));
  const d = DITHER_4X4[(y & 3) * 4 + (x & 3)]!;
  if (green) {
    const g = (((v << 2) - (v >> 4) + (v >> 6) + d) >> 2) >> 2;
    return (g << 2) | (g >> 4);
  }
  const c = (((v << 1) - (v >> 4) + (v >> 7) + d) >> 1) >> 3;
  return (c << 3) | (c >> 2);
}

// The matrix library (0x40200B…0x40231F): 4 × 4 floats, row vectors (v' = v × M).

function identity(m: Float32Array): void {
  m.fill(0);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
}

/** 0x4020B5: about x; c, s stored as floats. */
function rotationX(m: Float32Array, degrees: number): void {
  const angle = degrees * DEG;
  const c = f(Math.cos(angle));
  const s = f(Math.sin(angle));
  identity(m);
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
}

/** 0x402183: about y. */
function rotationY(m: Float32Array, degrees: number): void {
  const angle = degrees * DEG;
  const c = f(Math.cos(angle));
  const s = f(Math.sin(angle));
  identity(m);
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
}

/** 0x40231F. */
function translation(m: Float32Array, x: number, y: number, z: number): void {
  identity(m);
  m[12] = x;
  m[13] = y;
  m[14] = z;
}

/** 0x4023DD: current = current × m, each element a dot product summed left to right, stored as a float. */
function multiply(current: Float32Array, m: Float32Array, scratch: Float32Array): void {
  for (let i = 0; i < 4; i += 1) {
    const a0 = current[4 * i]!;
    const a1 = current[4 * i + 1]!;
    const a2 = current[4 * i + 2]!;
    const a3 = current[4 * i + 3]!;
    for (let j = 0; j < 4; j += 1) {
      scratch[4 * i + j] = a0 * m[j]! + a1 * m[4 + j]! + a2 * m[8 + j]! + a3 * m[12 + j]!;
    }
  }
  current.set(scratch);
}

/** 0x401122's persistent state, and the frame itself. */
export class GlideState {
  /** 0x544F00: the field's turn, degrees. */
  fieldAngle = 0;
  /** 0x544EFC: the points' turn, degrees. */
  pointsAngle = 0;
  /** 0x544F18: + 1° after every points frame (wrapped above 360), never read. */
  spareAngle = 0;
  /** 0x44B0D8: calls of 0x401122, from -1; never read. */
  calls = -1;
  /** 0x544F14: frames drawn; only fed a dead computation (× 0x44B514 × 3 / 100). */
  drawn = 0;
  /** 0x44B0D4: the grid is laid out once, on the first field frame. */
  laidOut = false;
  /** The grid (0x518D50, 40-byte vertices): x = row / 63 - 0.5, z = column / 63 - 0.5, y the smoothed height. */
  readonly gridX = new Float32Array(VERTICES);
  readonly gridY = new Float32Array(VERTICES);
  readonly gridZ = new Float32Array(VERTICES);
  /** 0x540E2C: the buffer offset each vertex samples, 4 × column + 1024 × row. */
  readonly sample = new Int32Array(VERTICES);
  private readonly matrix = new Float32Array(16);
  private readonly operand = new Float32Array(16);
  private readonly scratch = new Float32Array(16);

  /** One call of 0x401122(buffer, flipped): the Glide calls of this frame into `out`. */
  frame(input: GlideInput, out: GlidePrimitives = createPrimitives()): GlidePrimitives {
    this.calls += 1;
    this.drawn += 1;
    if (input.special !== 0) {
      this.points(input, out);
      this.spareAngle = f(this.spareAngle + 1);
      if (this.spareAngle > 360) this.spareAngle = f(this.spareAngle - 360);
    } else if (input.flipped) {
      this.field(input, 15, 0, 0.25, out);
    } else {
      this.field(input, 90, 0, 0, out);
    }
    return out;
  }

  /** cur = I × RotY(turn) × RotX(tilt) × T(x, y, z). */
  private camera(turn: number, tilt: number, x: number, y: number, z: number): Float32Array {
    const m = this.matrix;
    identity(m);
    rotationY(this.operand, turn);
    multiply(m, this.operand, this.scratch);
    rotationX(this.operand, tilt);
    multiply(m, this.operand, this.scratch);
    translation(this.operand, x, y, z);
    multiply(m, this.operand, this.scratch);
    return m;
  }

  private layOut(): void {
    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = j * GRID + i;
        this.gridX[k] = j / 63 - 0.5;
        this.gridZ[k] = i / 63 - 0.5;
        this.gridY[k] = 0;
        // ftol(i * 256 / 64 + j * 256 / 64 * 256): exact.
        this.sample[k] = (i * 256) / 64 + ((j * 256) / 64) * 256;
      }
    }
    this.laidOut = true;
  }

  /** 0x401528(buffer, tilt, 0, lift, 1.1f): the height field. */
  private field(input: GlideInput, tilt: number, shift: number, lift: number, out: GlidePrimitives): void {
    if (!this.laidOut) this.layOut();
    const { buffer, palette } = input;
    if (out.vertices.length < VERTICES * VERTEX_FLOATS) out.vertices = new Float32Array(VERTICES * VERTEX_FLOATS);
    const v = out.vertices;
    const heights = this.gridY;
    // Heights from this frame's samples (-c / 512, smoothed 7/8), colours straight from the palette.
    for (let k = 0; k < VERTICES; k += 1) {
      const c = buffer[this.sample[k]!]! & 0xff;
      heights[k] = (-c / 512 + heights[k]! * 7) / 8;
      v[k * VERTEX_FLOATS + 3] = palette[3 * c]!;
      v[k * VERTEX_FLOATS + 4] = palette[3 * c + 1]!;
      v[k * VERTEX_FLOATS + 5] = palette[3 * c + 2]!;
    }
    this.fieldAngle = f(this.fieldAngle + 0.5);
    if (this.fieldAngle >= 360) this.fieldAngle = f(this.fieldAngle - 360);
    const m = this.camera(this.fieldAngle, tilt, shift, lift, DISTANCE);
    const m0 = m[0]!;
    const m1 = m[1]!;
    const m2 = m[2]!;
    const m4 = m[4]!;
    const m5 = m[5]!;
    const m6 = m[6]!;
    const m8 = m[8]!;
    const m9 = m[9]!;
    const m10 = m[10]!;
    const m12 = m[12]!;
    const m13 = m[13]!;
    const m14 = m[14]!;
    for (let k = 0; k < VERTICES; k += 1) {
      const x = this.gridX[k]!;
      const y = heights[k]!;
      const z = this.gridZ[k]!;
      // 0x4024E4 with w = 1 (its w' is never read).
      const tx = f(m0 * x + m4 * y + m8 * z + m12);
      const ty = f(m1 * x + m5 * y + m9 * z + m13);
      const tz = f(m2 * x + m6 * y + m10 * z + m14);
      // 0x40262B.
      const iz = f(1 / tz);
      const px = f((iz * tx + 1) * 0.5);
      const py = f((iz * ty + 1) * 0.5);
      // The triangle loop's vertex: scale, clamp (0x401DF1), snap bias; oow from the view z.
      let sx = f(f(px + px - 0.5) * SCALE_X);
      let sy = f(f(py + py - 0.5) * SCALE_Y);
      if (!(sx >= 0)) sx = 0;
      else if (sx > MAX_X) sx = MAX_X;
      if (!(sy >= 0)) sy = 0;
      else if (sy > MAX_Y) sy = MAX_Y;
      const o = k * VERTEX_FLOATS;
      v[o] = sx + SNAP_BIAS;
      v[o + 1] = sy + SNAP_BIAS;
      v[o + 2] = Math.abs(1 / (tz + 100));
    }
    out.mode = "field";
    out.vertexCount = VERTICES;
    out.triangles = FIELD_TRIANGLES;
    out.triangleCount = FIELD_TRIANGLES.length / 3;
    out.pointCount = 0;
  }

  /** 0x40129B: the special's particles. */
  private points(input: GlideInput, out: GlidePrimitives): void {
    this.pointsAngle = f(this.pointsAngle + 0.5);
    if (this.pointsAngle >= 360) this.pointsAngle = f(this.pointsAngle - 360);
    const m = this.camera(this.pointsAngle, 5, -0.5, -0.5, DISTANCE);
    const particles = input.particles;
    const count = particles ? Math.max(0, particles.count) : 0;
    const width = input.width ?? 256;
    const height = input.height ?? 256;
    if (out.vertices.length < count * VERTEX_FLOATS) out.vertices = new Float32Array(count * VERTEX_FLOATS);
    const v = out.vertices;
    const palette = input.palette;
    let n = 0;
    for (let i = 0; i < count; i += 1) {
      if (!particles) break;
      const x = f((2 * particles.x[i]!) / width - 1);
      const y = f((2 * particles.y[i]!) / height - 1);
      const z = f((2 * particles.z[i]!) / 256 - 1);
      const tx = f(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!);
      const ty = f(m[1]! * x + m[5]! * y + m[9]! * z + m[13]!);
      const tz = f(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
      const iz = f(1 / tz);
      const px = f((iz * tx + 1) * 0.5);
      const py = f((iz * ty + 1) * 0.5);
      // grDrawPoint only for w >= 0 (fcomp 0.0; C0 → skipped, NaN too).
      if (!(tz >= 0)) continue;
      const c = particles.colour[i]! & 0xff;
      const o = n * VERTEX_FLOATS;
      v[o] = px * 320 + 320;
      v[o + 1] = py * 240 + 240;
      v[o + 2] = 1 / tz;
      v[o + 3] = palette[3 * c]!;
      v[o + 4] = palette[3 * c + 1]!;
      v[o + 5] = palette[3 * c + 2]!;
      n += 1;
    }
    out.mode = "points";
    out.vertexCount = n;
    out.triangleCount = 0;
    out.pointCount = n;
  }
}

/** Glide's view on WebGL 2. */
export interface GlideViewOptions {
  /** The Voodoo's 16-bit framebuffer: 5-6-5 through Glide's 4 × 4 dither (default), or false for plain 8-bit colour. */
  dither?: boolean;
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in float aOow;
layout(location = 2) in vec3 aColour;
out float vOow;
out vec3 vColour;
void main() {
  // w = 1: everything iterates linearly on the screen, as the Voodoo iterated it.
  gl_Position = vec4(aPosition.x / 320.0 - 1.0, 1.0 - aPosition.y / 240.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vOow = aOow;
  vColour = aColour;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
in float vOow;
in vec3 vColour;
uniform int uDither;
out vec4 outColour;
const int DITHER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
// The highest set bit (GLSL ES 3.00 has no findMSB).
int topBit(uint v) {
  int p = 0;
  if (v >= 0x10000u) { v >>= 16u; p += 16; }
  if (v >= 0x100u) { v >>= 8u; p += 8; }
  if (v >= 0x10u) { v >>= 4u; p += 4; }
  if (v >= 0x4u) { v >>= 2u; p += 2; }
  if (v >= 0x2u) { p += 1; }
  return p;
}
float wDepth(float oow) {
  if (!(oow < 1.0)) return 0.0;
  float t = floor(oow * 4294967296.0);
  if (t < 65536.0) return 1.0;
  uint temp = uint(t);
  int e = 31 - topBit(temp);
  uint m = (~temp >> uint(19 - e)) & 0xFFFu;
  uint d = ((uint(e) << 12u) | m) + 1u;
  return float(min(d, 65535u)) / 65535.0;
}
void main() {
  gl_FragDepth = wDepth(vOow);
  ivec3 c = clamp(ivec3(floor(vColour)), ivec3(0), ivec3(255));
  if (uDither != 0) {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int d = DITHER[((479 - p.y) & 3) * 4 + (p.x & 3)];
    int r = (((c.r << 1) - (c.r >> 4) + (c.r >> 7) + d) >> 1) >> 3;
    int g = (((c.g << 2) - (c.g >> 4) + (c.g >> 6) + d) >> 2) >> 2;
    int b = (((c.b << 1) - (c.b >> 4) + (c.b >> 7) + d) >> 1) >> 3;
    c = ivec3((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2));
  }
  outColour = vec4(vec3(c) / 255.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("glide: cannot create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`glide: shader: ${log ?? "?"}`);
  }
  return shader;
}

/**
 * Draws GlidePrimitives on a 640 × 480 canvas as the Voodoo did: grBufferClear(0, 0, 0xFFFF),
 * then the triangles or points in order with the W-buffer test, ready to show (no swap needed).
 */
export class GlideView {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly ditherLocation: WebGLUniformLocation | null;
  private upload = new Float32Array(VERTICES * VERTEX_FLOATS);
  private capacity = VERTICES * VERTEX_FLOATS * 4;
  private dither: boolean;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, options: GlideViewOptions = {}) {
    this.canvas = canvas;
    canvas.width = GLIDE_WIDTH;
    canvas.height = GLIDE_HEIGHT;
    const attributes: WebGLContextAttributes = {
      alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false
    };
    const context = typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement
      ? canvas.getContext("webgl2", attributes)
      : (canvas as OffscreenCanvas).getContext("webgl2", attributes);
    if (!context) throw new Error("WebGL 2 is not available");
    const gl = context as WebGL2RenderingContext;
    this.gl = gl;
    this.dither = options.dither ?? true;

    const program = gl.createProgram();
    if (!program) throw new Error("glide: cannot create a program");
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`glide: link: ${gl.getProgramInfoLog(program) ?? "?"}`);
    }
    this.program = program;
    this.ditherLocation = gl.getUniformLocation(program, "uDither");

    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer || !indexBuffer) throw new Error("glide: cannot create buffers");
    this.vao = vao;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
    const stride = VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FIELD_TRIANGLES, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /** The 4 × 4 dither on or off. */
  setDither(on: boolean): void {
    this.dither = on;
  }

  /** grBufferClear(0, 0, 0xFFFF), the frame's primitives, done (the canvas holds the picture). */
  frame(primitives: GlidePrimitives): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, GLIDE_WIDTH, GLIDE_HEIGHT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const count = primitives.vertexCount;
    if (count === 0) return;

    if (this.upload.length < count * VERTEX_FLOATS) this.upload = new Float32Array(count * VERTEX_FLOATS);
    const up = this.upload;
    const src = primitives.vertices;
    let n = 0;
    if (primitives.mode === "field") {
      for (let k = 0; k < count; k += 1) {
        const o = k * VERTEX_FLOATS;
        up[o] = fieldXY(src[o]!);
        up[o + 1] = fieldXY(src[o + 1]!);
        up[o + 2] = src[o + 2]!;
        up[o + 3] = src[o + 3]!;
        up[o + 4] = src[o + 4]!;
        up[o + 5] = src[o + 5]!;
      }
      n = count;
    } else {
      for (let k = 0; k < count; k += 1) {
        const o = k * VERTEX_FLOATS;
        const x = pointPixel(src[o]!);
        const y = pointPixel(src[o + 1]!);
        // The clip window (0…639, 0…479); NaN and infinities fall out here too.
        if (!(x >= 0 && x < GLIDE_WIDTH && y >= 0 && y < GLIDE_HEIGHT)) continue;
        const to = n * VERTEX_FLOATS;
        up[to] = x + 0.5;
        up[to + 1] = y + 0.5;
        up[to + 2] = src[o + 2]!;
        up[to + 3] = src[o + 3]!;
        up[to + 4] = src[o + 4]!;
        up[to + 5] = src[o + 5]!;
        n += 1;
      }
      if (n === 0) return;
    }

    gl.useProgram(this.program);
    gl.uniform1i(this.ditherLocation, this.dither ? 1 : 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    if (up.byteLength > this.capacity) {
      this.capacity = up.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, up, 0, n * VERTEX_FLOATS);
    if (primitives.mode === "field") {
      gl.drawElements(gl.TRIANGLES, primitives.triangleCount * 3, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(gl.POINTS, 0, n);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
