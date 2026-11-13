/*
 * Miffo.svp — "miffo v1.0 :: psikorp'99", a Sonique visualization plug-in, as AVS's
 * "Render / SVP Loader" runs it.
 *
 * Library: miffo.svp
 * Binary:  sha256 751aa4c04cecf67274eac232f4cb404a49d2578c90ae924ae8c2737a4547e3ba
 *          (PE32 DLL, MSVC 6, 10.06.1999, static multithreaded CRT)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x100090D8): name "miffo v1.0 :: psikorp'99", lRequired = 7 (waveform | spectrum |
 * SONIQUEVISPROC), Initialize 0x10001E60, Render 0x10001F40, SaveSettings = OpenSettings =
 * 0x10001E50 (`return 1`).
 *
 * Settings: none (no profile imports).
 *
 * Behaviour: a small float32 3D engine; nothing is cleared, every point is ADDED to the frame with
 * per-byte saturation (and the touched pixel's top byte set to 0).
 *  - Initialize draws, from the DLL's own rand() (static CRT, per-thread holdrand starting at 1;
 *    only Initialize calls it): 16 periods (rand % 1000 + 800), then 2000 particles at
 *    (rand % 1000 - 500) x 3 with brightness rand % 155 + 100, type 1 (grey).
 *  - Each Render: a level L = L + (|0.0025 * sum_i |spec_i| * wave_i| - L) / 16 from samples 0..3 of
 *    both channels (bytes read as signed); particles 0..767 become 6 spiral arms (+x, -x, +z, -z,
 *    +y, -y; red, red, green, green, blue, blue) of 128 points: point k at distance
 *    4k (1 + L / 40) rotated by Rz(a2) Ry(a1) Rx(a0) with angles (angZ - 550k, angX - 300k,
 *    angY - 430k) in units of 6.285 / 65536 rad, brightness (512 - 4k) - wave[2k]; points k = 50
 *    and 114 of each arm and particle 0 (at the origin, brightness 300) are drawn as a 64 x 64
 *    glow sprite (copied from the DLL) scaled by 150 * brightness / depth (max 300).
 *  - The camera moves on (400 sin, -400 cos, 400 cos)(3.142 t / period) looking at
 *    (-170 cos, 170 cos, 170 sin)(...), up vector from three more periods; projection
 *    x = w/2 - (w/320) X / (-Z/140), y = h/2 + (h/240) Y / (-Z/140); points need camera Z > 0 and
 *    brightness - Z/4, at 2 <= x <= w - 2, 2 <= y <= h - 2; each is splatted bilinearly into 2 x 2
 *    pixels (grey points twice, at (x, y) and (x + 0.1, y + 0.1); colour points four times at
 *    (x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)). Channel values above 255 carry into the next
 *    byte before the saturating add, as the binary packs them.
 *  - t += 3 and the angles += 550, 300, 430 per Render call (float32).
 *  All maths as the binary: float32 storage (Math.fround) of x87 results computed in doubles,
 *  truncating _ftol.
 *
 * Not recovered / approximate:
 *  - fsin/fcos return 64-bit mantissas that the binary rounds straight to float32 or multiplies;
 *    Math.sin/cos round to 53 bits first — a last-bit difference only in rare ties.
 *  - The camera's inverse matrix (0x100014D0 into camera+0x70) and an accumulator at 0x10026178
 *    are computed but never read; not ported. The debug-print function is an empty stub.
 *  - The DLL's statics (and its per-thread rand) are shared between SVP effects that load this
 *    file in one process; the port keeps one state per create() with rand seeded 1 (a fresh load).
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

const f32 = Math.fround;

const ANGLE_K = 9.59014892578125e-5; // 0x100080E0: 6.285 / 65536
const F_0025 = f32(0.0025); // 0x1000817C
const F_025 = f32(0.025); // 0x10008170
const F_1_320 = f32(0.003125); // 0x10008144
const F_1_240 = f32(1 / 240); // 0x10008140
const F_NEAR = f32(-0.001); // 0x100080FC
const F_FAR = f32(-1000); // 0x100080F8 (-999.99994)
const FOCAL = 140; // camera +0xA4

export const MIFFO_PARTICLES = 2000;

function decodeBase64(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const v = alphabet.indexOf(text.charAt(i));
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, n);
}

/** 0x10009118: the 64 x 64 sprite (0x00RRGGBB), stored as R,G,B triplets. */
const TEXTURE_RGB = decodeBase64(
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAC" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICAgICAgICAgICBAICBAICBAIEBAIEBAIEBAIEBAIEBAIEBAIE" +
  "BAICBAICAgICAgICAgICAgICAgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICAgICAgICBAIEBAQEBAQEBAQEBAQEBgQEBgQEBgQE" +
  "BgQEBgQEBgQEBgQEBAQEBAQEBAQEBAQEBAIEAgICAgICAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICAgICBAICBAQEBAQEBAQEBgQGBgYGBgYG" +
  "BgYGCAYGCAYGCAYGCAYGCAYGCAYGCAYGBgYGBgYGBgYGBgQGBAQEBAQEBAQEBAICAgICAgICAgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICBAICBAQEBAQEBgQEBgYG" +
  "BgYGCAYGCAYICAYICAgICggICggIDAoKCggICggICggICggICAgICAYICAYICAYGBgYGBgYGBgQEBAQEBAQEBAICAgICAgICAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICAgICBAIEBAQE" +
  "BgQEBgYGCAYGCAYICAgICggICggKCgoKDAoKDAoMDAoMDgwODAoMDAoMDAoMDAoMDAoKCgoKCggKCggICAgICAYICAYGCAgIBgQEBAQEBAIEAgICAgICAgAC" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgIC" +
  "BAICBAQEBgQEBgYGCAYGCAYIDAoKCggKDgwMDAoMEAwMFhAMHBIMIBQOIhYQIhYQIBQOIBQOIhYQIBQOHBIMGBIOEAwMDAoMDAoKDAoMCggICggKCAYGBgYG" +
  "BgQEBAQEBAICAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAgICAgICBAIEBAQEBgQEBgYGCAYICAgICggKDgwMEg4OGBIOIBQOIhYOIhYQJBYQJBgQJRoSJRoSJBgQJRoSJBgQJBgQJRgSJBgSIhYOIBQOGBIOEg4O" +
  "DgwMCggKCgoKCAYIBgYGBgQEBAQEBAIEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAgICAgICBAIEBAQEBgQGCAYGCAYICggIDAoKEAwMHBIMIhYQJBgSJRoSJBgSJRgSJRoSKRwWKRwWKh4YJxoUKRwWJxoUJxoUJxwUJRgS" +
  "JBgSJBgQJRoUJBgSHhQOEg4ODgwMCggICAYICAYGBgQGBAQEBAIEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICBAIEBAQEBgYGCAYGCAgICggKDAoMFhAMIBQOIhYQJRoSJxoUJxwUJxoUKRwWKRwWKiAaLCIcLCIcKR4YKiAa" +
  "KR4YKR4YKh4YKRwWJxoUJxwUKRwWJRoSIhYQJBgSFhAMDAoMDAoMCAgICAYGBgYGBAQEBAIEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICBAIEBAQEBgYGCAYGCAgICgoKEAwMHBIMIhYOJBgQJRgSJxoUKh4YLCAaKiAaKh4YLCAaLiIc" +
  "MCQeMCQeLCAaLiIcLCAaLiIcLiIcKh4YKR4YLCAaKh4YKRwWKRwWJxwUIhYOHhQOEAwMCgoKCAgICAYGBgYGBAQEBgQGAgICAgACAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICAgICBAICBAQEBgQGCggICAgICgoKEAwMHBIMIhYQJBgQJRoSJxoUKRwWLiIcMCQe" +
  "MCQeLiIcMCQeMiUfNCchNCchMCQeMiUfMCQeMiUfNCchLiIcLiIcMiUgLiIcLCAaLCAaJRoSJRoSIhYQHBIMEAwMCgoKCAgICAYGCAYIBgYGBAICAgICAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICBAQEBgYGBgQECAYGCAgIDAwMEg4OIBQOJBYQJBgSJxoUKRwW" +
  "KR4YLiIcMCQeMiUgNCchNCUhNCUfNScjOy0nOy0nNykjNykjNSchNyklNykjMiQfNikjNCchNCchMiUgLCIcKh4YKRwWJBgSJBYQIBQOEg4OCgoKDAwMCggI" +
  "BgQEBAQEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICBAIECggICgoKCAYICggKEg4OHhQOJRgS" +
  "JBgSJxoUKRwWKh4YLCAaMCQeMiUfNykjOy0nOSsnNykjOSsnPzErPzErPS8pOy0nOSslPS8rOSslNyklOy0nOSslNyslNikjLiIcLCAaKRwWJxoUJBgSJRgS" +
  "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" +
  "AgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICBAQEBgQECAYGCAgIDAwMEAwMIBQOJRgSJRoUJxoUKRwW" +
  "KR4YLiIcMCQeMCQeMCQeNScjNykjNCUhOy0nOy0nNSchOSslPS8pNyklNCUfMiQfNCchMCQeLiIcLCAaKR4YKRwWJxoUJBgSJBYQIBQOEg4ODg4OCgoKCAYG" +
  "BgQEBAQEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICBAICBAQEBgQGCAYGCAgICgoKEAwM" +
  "HhQOIhYQJBgQJRoSJxoUKh4YKh4YLiIcLCAaMiUgMiUfMCQeNikjNikjMCQeMiUfNyslNCchMCQeLiIcMCQeMCQeKh4YKRwWJxoUJRoSJBgQIhYQHBIMEAwM" +
  "CgoKCAgICggIBgQGBAQEBAICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICBAIEBAQE" +
  "BgYGCAYGCAgIDAwMEAwMHBIMIhYOJBgQJRgSKRwWKRwWKRwWKR4YLCAaLCAaLCAaMiUgMCQeLCAaLiIcMiUgMCQeLCAaKh4YKR4YLCAaJxoUJxoUJRgSJBgQ" +
  "IhYOHBIMEAwMCgoKCAgICAYGBgYGBgYGBAIEAgICAgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAgICAgICBAIEBAQEBgYGCggICAgICggKDAoMFhAMIBQOIhYQJBgQJxoUJRoSKRwWKh4YKRwWKR4YLiQeLCIcKR4YKR4YLCIcLCIcKRwWKRwWJxoUKR4W" +
  "JxoUJBgQIhYQIBQOFhAMDAoMCggKCAgICAYGBgYGBAQEBAIEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAgICAgICBAIEBgYGBgQGCAYGCAYICggIDAoKEAwMHBIMIBQOIhYQJBgQJRoUJxoUJRoSJxoUKh4YKRwWJxoUJxoUKh4YKh4Y" +
  "JxwUJRgSJBgSJBgQJBgSIBQOHBIMEAwMDAoKCggICAYICAYGBgQGBAQEBAIEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICBAIEBAQEBgQEBgYGCAYICAgICggKDAoKEAwMFhAMIBQOJBgQIhYQJBYQJBgQJxwUJRoS" +
  "JBgQJBgQJRoSJxwUJRgSIhYQIhYOIBQOGBIOEg4ODAoKCggKCAgICAYIBgYGBgQEBAQEBAIEAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICBAICBAQEBgQEBgYGCAYGCAYICggICggKDAoKDAoMEg4OFhAM" +
  "HBIMIBQOJBgSIhYQIBQOIBQOIhYQJBgSHhQOFhAMEAwMDAoMDAoKDAoMCggICAYICAYGBgYGBgQEBAQEBAICAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICAgICBAIEBAQEBgQEBgYGCAYGCAYI" +
  "CAgICggICggKCgoKDAoKDAoMEA4QDgwODAoMDAoMDgwODgwODgwMCgoKCggKCggICAgICggKCAYGBgYGBgQEBAQEBAIEAgICAgICAgACAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICBAIC" +
  "BAQEBAQEBgQEBgYGBgYGCAYGCAYICAYICAgICggIDAoKCggICggICggICggIDAoKCAgICAYICAYICAYGBgYGBgYGBgQEBAQEBAQEBAICAgICAgICAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAgACAgICAgICBAICBAQEBAQEBAQEBgQGBgYGBgYGBgYGCAYGCggICAYGCAYGCAYGCAYGCggIBgYGBgYGBgYGBgQGBAQEBAQEBAQEBAICAgICAgIC" +
  "AgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgICAgICAgICBAIEBAQEBAQEBAQEBAQEBgQECAYGBgQEBgQEBgQEBgQEBgQEBAQEBAQEBAQEBAQEBAIEAgIC" +
  "AgICAgICAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICAgICAgICAgICBAICBAICBAIEBgQGBAIEBAIEBAIEBAIEBAIEBAICBAIC" +
  "AgICAgICAgICAgICAgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgACAgICAgICAgICAgICBAQEAgICAgICAgIC" +
  "AgICAgICAgICAgICAgICAgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
);

export const MIFFO_TEXTURE: Int32Array = (() => {
  const out = new Int32Array(4096);
  for (let i = 0; i < 4096; i++) {
    out[i] = ((TEXTURE_RGB[i * 3] ?? 0) << 16) | ((TEXTURE_RGB[i * 3 + 1] ?? 0) << 8) | (TEXTURE_RGB[i * 3 + 2] ?? 0);
  }
  return out;
})();

/** _ftol: truncation toward zero, low 32 bits. */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

function sx8(v: number): number {
  return (v << 24) >> 24;
}

/** A 3 x 3 matrix as the binary stores it: rows of 4 floats (index 0..2, 4..6, 8..10). */
export type Mat = Float32Array;

function newMat(): Mat {
  return new Float32Array(12);
}

/** 0x10001010 / 0x10001030: cos / sin of a 16-bit angle. */
export function angleCos(a: number): number {
  return Math.cos((a & 0xffff) * ANGLE_K);
}
export function angleSin(a: number): number {
  return Math.sin((a & 0xffff) * ANGLE_K);
}

/** 0x10001050: out = A * B (row-major), sums in the binary's order. */
export function matMul(a: Mat, b: Mat, out: Mat): void {
  const A = (i: number) => a[i]!;
  const B = (i: number) => b[i]!;
  out[0] = (A(0) * B(0) + A(1) * B(4)) + A(2) * B(8);
  out[1] = (A(1) * B(5) + B(1) * A(0)) + B(9) * A(2);
  out[2] = (A(1) * B(6) + B(2) * A(0)) + B(10) * A(2);
  out[4] = (A(6) * B(8) + A(5) * B(4)) + A(4) * B(0);
  out[5] = (A(6) * B(9) + A(5) * B(5)) + A(4) * B(1);
  out[6] = (A(6) * B(10) + A(5) * B(6)) + A(4) * B(2);
  out[8] = (A(8) * B(0) + A(10) * B(8)) + A(9) * B(4);
  out[9] = (B(9) * A(10) + B(5) * A(9)) + B(1) * A(8);
  out[10] = (B(10) * A(10) + B(6) * A(9)) + B(2) * A(8);
}

/** 0x10001230: (Rz(a2) * Ry(a1)) * Rx(a0). */
export function rotation(a0: number, a1: number, a2: number): Mat {
  const rx = newMat();
  rx[5] = angleCos(a0); rx[6] = angleSin(a0); rx[9] = -angleSin(a0); rx[10] = angleCos(a0); rx[0] = 1;
  const ry = newMat();
  ry[0] = angleCos(a1); ry[2] = angleSin(a1); ry[8] = -angleSin(a1); ry[10] = angleCos(a1); ry[5] = 1;
  const rz = newMat();
  rz[0] = angleCos(a2); rz[1] = angleSin(a2); rz[4] = -angleSin(a2); rz[5] = angleCos(a2); rz[10] = 1;
  const zy = newMat();
  matMul(rz, ry, zy);
  const out = newMat();
  matMul(zy, rx, out);
  return out;
}

/** 0x100013A0: out = M * v, sums in the binary's order, float32 results. */
export function matVec(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [
    f32((m[2]! * z + m[1]! * y) + m[0]! * x),
    f32((m[6]! * z + m[4]! * x) + m[5]! * y),
    f32((m[10]! * z + m[8]! * x) + m[9]! * y)
  ];
}

/** 0x10001460: normalise in place. */
function normalize(v: Float32Array): void {
  const len = Math.sqrt((v[0]! * v[0]! + v[1]! * v[1]!) + v[2]! * v[2]!);
  v[0] = v[0]! / len;
  v[1] = v[1]! / len;
  v[2] = v[2]! / len;
}

/** 0x100012C0: look-at matrix rows: D x U', U' = normalise(up - D (up . D)), D. */
export function lookAt(dir: Float32Array, up: Float32Array): Mat {
  const d = Float32Array.from(dir);
  const u = Float32Array.from(up);
  normalize(d);
  const dot = (u[2]! * d[2]! + u[1]! * d[1]!) + u[0]! * d[0]!;
  u[0] = u[0]! - d[0]! * dot;
  u[1] = u[1]! - d[1]! * dot;
  u[2] = u[2]! - d[2]! * dot;
  normalize(u);
  const m = newMat();
  // 0x10001400: out = a x b with a = d, b = u
  m[0] = u[2]! * d[1]! - u[1]! * d[2]!;
  m[1] = u[0]! * d[2]! - u[2]! * d[0]!;
  m[2] = u[1]! * d[0]! - u[0]! * d[1]!;
  m[4] = u[0]!; m[5] = u[1]!; m[6] = u[2]!;
  m[8] = d[0]!; m[9] = d[1]!; m[10] = d[2]!;
  return m;
}

export interface MiffoFrame {
  video: Int32Array;
  w: number;
  h: number;
  pitch: number;
}

/** 0x10001AD0 / 0x10001A10: saturating per-byte add of a packed colour; top byte becomes 0. */
export function addPixel(f: MiffoFrame, x: number, y: number, packed: number): void {
  if (x < 0 || x >= f.w || y < 0 || y >= f.h) return;
  const i = y * f.pitch + x;
  const p = f.video[i] ?? 0;
  const b = Math.min(255, (packed & 255) + (p & 255));
  const g = Math.min(255, ((packed >>> 8) & 255) + ((p >>> 8) & 255));
  const r = Math.min(255, ((packed >>> 16) & 255) + ((p >>> 16) & 255));
  f.video[i] = (r << 16) | (g << 8) | b;
}

/** 0x10001AD0 argument packing: ((r << 8) + g << 8) + b with int32 carries. */
export function packColor(r: number, g: number, b: number): number {
  return ((((r << 8) + g) | 0) << 8) + b | 0;
}

/** 0x10001BB0: bilinear 2 x 2 splat of colour (c1, c2, c3) = (red, green, blue) at float (x, y). */
export function splat(f: MiffoFrame, x: number, y: number, c1: number, c2: number, c3: number): void {
  if (!(x >= 2) || !(y >= 2)) return;
  if (!(f.w - 2 >= x) || !(f.h - 2 >= y)) return;
  const ix = ftol(x);
  const iy = ftol(y);
  const fx = x - ix;
  const fy = y - iy;
  const ox = f32(1 - fx);
  const a = f32((1 - fx) * (1 - fy));
  const b = f32((1 - fy) * fx);
  const c = f32(ox * fy);
  const d = f32(fy * fx);
  addPixel(f, ix, iy, packColor(ftol(a * c1), ftol(a * c2), ftol(a * c3)));
  addPixel(f, ix + 1, iy, packColor(ftol(b * c1), ftol(b * c2), ftol(b * c3)));
  addPixel(f, ix, iy + 1, packColor(ftol(c * c1), ftol(c * c2), ftol(c * c3)));
  addPixel(f, ix + 1, iy + 1, packColor(ftol(d * c1), ftol(d * c2), ftol(d * c3)));
}

/** 0x10001D60: the sprite, `size` x `size` pixels from (x - size/2, y - size/2), added. */
export function sprite(f: MiffoFrame, x: number, y: number, size: number, texture: Int32Array): void {
  const half = size * 0.5;
  const x0 = ftol(x - half);
  const step = ftol(4096 / size);
  let py = ftol(y - half);
  if (!(0 < size)) return;
  let v = 0;
  for (let i = 0; ; ) {
    let px = x0;
    let u = 0;
    for (let j = 0; ; ) {
      if (px >= 0 && px < f.w && py >= 0 && py < f.h) {
        addPixel(f, px, py, texture[(v & ~63) + (u >> 6)] ?? 0);
      }
      u = (u + step) | 0;
      px++;
      j++;
      if (!(j < size)) break;
    }
    v = (v + step) | 0;
    py++;
    i++;
    if (!(i < size)) break;
  }
}

export interface MiffoState {
  periods: Int32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  bright: Int32Array;
  type: Int32Array;
  t: number;
  level: number;
  angX: number;
  angY: number;
  angZ: number;
}

/** Initialize (0x10001E60) with the DLL's rand(). */
export function miffoInit(rand: () => number): MiffoState {
  const periods = new Int32Array(16);
  for (let i = 0; i < 16; i++) periods[i] = (rand() % 1000) + 800;
  const n = MIFFO_PARTICLES;
  const s: MiffoState = {
    periods,
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    bright: new Int32Array(n), type: new Int32Array(n),
    t: 0, level: 0, angX: 0, angY: 0, angZ: 0
  };
  for (let i = 0; i < n; i++) {
    s.x[i] = (rand() % 1000) - 500;
    s.y[i] = (rand() % 1000) - 500;
    s.z[i] = (rand() % 1000) - 500;
    s.bright[i] = (rand() % 155) + 100;
    s.type[i] = 1;
  }
  return s;
}

/** Render's level update from samples 0..3 of both channels (bytes read as signed). */
export function miffoLevel(level: number, vd: SvpVisData): number {
  let acc = 0;
  for (let i = 0; i < 8; i++) {
    const spec = sx8(vd.spectrum[i & 1][i >> 1] ?? 0);
    const wave = sx8(vd.waveform[i & 1][i >> 1] ?? 0);
    acc += Math.imul(Math.abs(spec), wave);
  }
  return f32(level + (Math.abs(acc * F_0025) - level) * 0.0625);
}

const ARM_TYPES = [2, 2, 3, 3, 4, 4];

/** The 768 arm particles (0x10002004 loop). */
export function miffoArms(s: MiffoState, vd: SvpVisData): void {
  const wave = vd.waveform[0];
  for (let k = 0; k < 128; k++) {
    const q = f32(4 * k);
    const r = f32((512 - 4 * k) - sx8(wave[2 * k] ?? 0));
    const m = rotation(ftol(s.angZ - 550 * k), ftol(s.angX - 300 * k), ftol(s.angY - 430 * k));
    const special = (k & 63) === 50;
    const dist = f32((s.level * F_025 + 1) * q);
    const vecs: [number, number, number][] = [[dist, 0, 0], [-dist, 0, 0], [0, 0, dist], [0, 0, -dist], [0, dist, 0], [0, -dist, 0]];
    for (let arm = 0; arm < 6; arm++) {
      const i = k + 128 * arm;
      s.bright[i] = special ? ftol(r * 0.25) : ftol(r);
      s.type[i] = special ? 5 : ARM_TYPES[arm]!;
      const v = vecs[arm]!;
      const p = matVec(m, v[0], v[1], v[2]);
      s.x[i] = p[0]; s.y[i] = p[1]; s.z[i] = p[2];
    }
  }
  s.type[0] = 5;
  s.bright[0] = 300;
  s.x[0] = 0; s.y[0] = 0; s.z[0] = 0;
}

export interface MiffoCamera {
  pos: Float32Array;
  matrix: Mat;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

/** Camera path (0x10002499..0x10002633) and 0x100017F0. */
export function miffoCamera(s: MiffoState, w: number, h: number): MiffoCamera {
  const p = s.periods;
  const a = () => s.t * 3.142;
  const pos = Float32Array.of(
    Math.sin(a() / p[0]!) * 400, Math.cos(a() / p[1]!) * -400, Math.cos(a() / p[2]!) * 400);
  const target = Float32Array.of(
    Math.cos(a() / p[3]!) * -170, Math.cos(a() / p[4]!) * 170, Math.sin(a() / p[5]!) * 170);
  const up = Float32Array.of(Math.sin(a() / p[6]!), Math.cos(a() / p[7]!), -Math.cos(a() / p[8]!));
  const dir = Float32Array.of(target[0]! - pos[0]!, target[1]! - pos[1]!, target[2]! - pos[2]!);
  return {
    pos,
    matrix: lookAt(dir, up),
    cx: w >> 1,
    cy: h >> 1,
    sx: f32(w * F_1_320),
    sy: f32(h * F_1_240)
  };
}

/** 0x10001930: perspective projection of a camera-space point. */
export function project(cam: MiffoCamera, x: number, y: number, z: number): [number, number] {
  const zz = -(z / FOCAL) + 0;
  if (!(zz >= F_NEAR)) {
    return [f32(cam.cx - (cam.sx * x) / zz), f32((cam.sy * y) / zz + cam.cy)];
  }
  return [f32(cam.cx - (cam.sx * x) * F_FAR), f32((cam.sy * y) * F_FAR + cam.cy)];
}

/** The drawing loop over all particles (0x10002641). */
export function miffoDraw(s: MiffoState, cam: MiffoCamera, f: MiffoFrame): void {
  for (let i = 0; i < MIFFO_PARTICLES; i++) {
    const vx = f32(s.x[i]! - cam.pos[0]!);
    const vy = f32(s.y[i]! - cam.pos[1]!);
    const vz = f32(s.z[i]! - cam.pos[2]!);
    const [cxv, cyv, czv] = matVec(cam.matrix, vx, vy, vz);
    const [px, py] = project(cam, cxv, cyv, czv);
    if (!(czv > 0)) continue;
    const c = s.bright[i]!;
    const b0 = c - czv * 0.25;
    const b = b0 < 0 ? 0 : f32(b0);
    switch (s.type[i]) {
      case 1:
        splat(f, px, py, b, b, b);
        splat(f, f32(px + 0.1), f32(py + 0.1), b, b, b);
        break;
      case 2:
      case 3:
      case 4: {
        const r = s.type[i] === 2 ? b : 0;
        const g = s.type[i] === 3 ? b : 0;
        const bl = s.type[i] === 4 ? b : 0;
        const px1 = f32(px + 1);
        const py1 = f32(py + 1);
        splat(f, px, py, r, g, bl);
        splat(f, px1, py, r, g, bl);
        splat(f, px, py1, r, g, bl);
        splat(f, px1, py1, r, g, bl);
        break;
      }
      case 5: {
        let size = ftol((150 * c) / czv);
        if (size > 300) size = 300;
        sprite(f, ftol(px), ftol(py), f32(size * cam.sx), MIFFO_TEXTURE);
        break;
      }
      default:
        break;
    }
  }
}

/** Render (0x10001F40). */
export function miffoRender(s: MiffoState, f: MiffoFrame, vd: SvpVisData): void {
  s.level = miffoLevel(s.level, vd);
  miffoArms(s, vd);
  const cam = miffoCamera(s, f.w, f.h);
  miffoDraw(s, cam, f);
  s.t = f32(s.t + 3);
  s.angZ = f32(s.angZ + 550);
  s.angX = f32(s.angX + 300);
  s.angY = f32(s.angY + 430);
}

export function createMiffo(): SvpEffect {
  let state: MiffoState | null = null;
  return {
    render(video, width, height, pitch, vd, ctx) {
      if (!state) state = miffoInit(ctx.makeRand(1));
      miffoRender(state, { video, w: width, h: height, pitch }, vd);
    }
  };
}

export const svp = {
  file: "miffo.svp",
  sha256: ["751aa4c04cecf67274eac232f4cb404a49d2578c90ae924ae8c2737a4547e3ba"],
  create(): SvpEffect {
    return createMiffo();
  }
};
