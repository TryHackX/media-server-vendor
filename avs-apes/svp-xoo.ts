/*
 * xOO.svp — "Xoo v1.0 :: mindcube", a Sonique visualization plug-in, as AVS's
 * "Render / SVP Loader" runs it.
 *
 * Library: xoo.svp
 * Binary:  sha256 5cba22a04ed1ce13ccfcd2701c70618d39817b7f58a50369e07417364529871b
 *          (PE32 DLL, MSVC 6 without optimisation, 30.11.1999, msvcrt.dll: sin, cos, _ftol, atoi)
 * Port by static reading of the binary (dumpbin /disasm + data dumps); the plug-in was never run.
 *
 * VisInfo (0x10033370, filled by DllMain 0x10001710): name "Xoo v1.0 :: mindcube", lRequired = 3
 * (waveform | spectrum), Initialize 0x10001000, Render 0x100010BD, SaveSettings 0x1000166A,
 * OpenSettings 0x100016A7.
 *
 * Settings: OpenSettings reads [Xoo v1.0] palette= from avs.ini (5-char buffer, default "258"),
 * atoi, clamped to 2..516: the number of colours cycled from its 516-colour table. No avs.ini
 * exists, so N = 258.
 *
 * Behaviour (Render 0x100010BD):
 *  - max = the largest Spectrum[1][128..254] value.
 *  - Every 4th call the colour start moves one entry (wrapping after N entries).
 *  - 360 dots: for angle i (degrees), j = Waveform[1][i] >> 3,
 *    x = w/2 + (int)(sin(i * 3.14159265 / 180) * j / 2 * max), y = h/2 + (int)(cos(...) * j / 2 * max)
 *    (tables built by Initialize), each OR-ed into the frame with the next palette colour.
 *  - A waveform line of Waveform[1][0..] across the width (y = h/2 - v for v >= 0, h/2 - v - 1 for
 *    v < 0), pixels REPLACED with the next palette colours.
 *  - Then the whole frame is blurred IN PLACE in raster order: each pixel becomes the average of its
 *    right, left, upper and lower neighbours (edges repeat the pixel itself); the left and upper
 *    ones are already blurred. The top byte of every pixel becomes 0.
 *  No rand, no time.
 *
 * Not recovered / approximate:
 *  - sin/cos are msvcrt.dll's; Math.sin/cos may differ in the last bit (only matters where
 *    table * max lands exactly on an integer).
 *  - The DLL's statics are shared between SVP effects that load this file in one process; the port
 *    keeps one state per create().
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

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** 0x1000302C: 516 colours, R,G,B bytes. */
export const XOO_PALETTE: Uint8Array = hexBytes(
  "ff895eff8a5fff8d62ff8e64ff9066ff9269ff956bff976dff9870ff9a72ff9c74ff9d76ff9e78ffa07affa17bffa17cffa27dffa27d" +
  "ffa27dffa17dffa17dffa07cff9f7cff9e7bff9e7aff9f79ff9f79ffa07bffa17cffa17dffa280ffa381ffa482ffa584ffa685ffa788" +
  "faa98af7ac8cf3ae8ff0af91edb293ebb496e9b699e6b99be4bb9ee2bca1e0bfa3ddc1a5dbc2a7d9c4a9d6c5acd2c6adcfc6aeccc7af" +
  "c8c7afc4c6afc0c6aebdc6afb8c4aeb3c3adafc1aca9c0a9a4bea79fbca69abaa495b8a291b6a08db49f89b39e85b29d82b09d7eb09c" +
  "7bb09c79b09c77b09d78b19f7ab2a07ab3a17bb4a37cb4a47cb5a47db6a57db6a67eb6a77eb6a77eb6a77db6a77cb4a67bb2a57ab0a2" +
  "77aea076ac9e74a89b72a59970a2966e9f936b9c9069988c6694886290845f8b7e5c877b598377567e74527b7050786e4e756b4b7367" +
  "497065486f63476e62476e62476e61486f61496f614a70634c72644d74664f756750766952786b547a6d567b6e597c6f5c7d705e7d70" +
  "617d71637d71657d72677c71677b716a7a706b79706c786e6d766d6f756c70736b71716b726f6a736d69746c67756a67766866786666" +
  "7865657964657b62657c61657e5f64805f65825e65845d66865c67885c688a5b698c5b6a8f5b6a915b6c935b6d965b6f995b709c5b72" +
  "9e5b73a15b75a45c76a75d78ab5d79ae5d7ab15d7bb45d7db75e7eba5e80bd5e82c05e83c35e83c65e84c95e85cc5f85cf5f86d16086" +
  "d56087d76087da6187dd6187e06187e26187e66287e86286ec6285ef6285f26284f56384f86383fb6382ff6382ff6383ff6483ff6483" +
  "ff6483ff6584ff6585ff6685ff6685ff6785ff6785ff6885ff6886ff6985ff6985ff6986ff6b86ff6c85ff6e85ff6f85ff7085ff7285" +
  "ff7484ff7584ff7683ff7783ff7982ff7a82ff7b81ff7c81ff7e80ff8080ff8180ff827eff837eff847dff857cff867bff867aff877a" +
  "ff8879ff8878ff8976ff8975ff8974ff8973ff8971ff8970ff886eff886cff886bff8661f58666ec876ae5876fdf8772d98876d48979" +
  "cf897ccb8a7ec88b80c58c82c28d84bf8e85bc8e86b98f87b68f89b38f8ab0908cac908ea89190a491939d92969693998f949d8895a1" +
  "829ba67ba29f75a79a72a8966fa9926ba98e68aa8a65aa8662aa8360a9805ea97e5da97c5da97b5da97b5ea87a60a87b63a87b67a77c" +
  "6ba77e70a67f75a5827ba48480a38686a1898c9f8c929d8e979b919b98939f9496a29198a58d9aa7899ca8849ea880a0a77ba1a676a3" +
  "a472a4a26ea5a06aa69d66a69a63a79761a8945fa8915ea88e5ea98d5ea98a5fa98860a98662aa8465aa8268aa806cab7e70ab7c74ac" +
  "7b79ac797ead7782ae7587ae748baf728fb07193b16f96b26f99b36e9bb46e9db46e9eb56f9fb6719fb6739fb6759eb7799cb77c9bb6" +
  "8099b68497b68994b68d92b5928fb5978db49c8bb4a088b3a585b3a882b3ac80b2af7db2b27bb1b478b1b676b0b874b0b971afba6fae" +
  "ba6dadba6bacba69aaba68a9b966a7b964a5b863a4b761a2b660a0b55e9eb45d9db35c9cb25b9ab15a9aaf5999ae5899ad5899ab5799" +
  "a9579aa8579ba6569ca4569da1569e9f569f9c55a09955a19655a29355a39055a48c55a58955a68655a68356a78056a87d57a87b58a9" +
  "7859aa765baa745cab725eab7060ab6f62ac6e64ac6e66ab6e67ab6e69aa6e6aa86f6ba7716ba4736ca1766c9d796c997c6b967f6b90" +
  "836a8b866a858a6a7f8d6a79906b74926c6e946d69966f6597716098745d987759987b57977f55958353938752918b518f8f518d9351" +
  "8a9751889a51859c51849e5182a05282a15281a15381a053829f54839d55859b568799578a96598d935a908f5c948b5f9786619b8265" +
  "9e7e68a1796ca3756ea67173a86d77aa6a7bac6780ae6584af6389b1618db26091b36094b35f98b45f9bb55f9eb560a0b561a2b562a4" +
  "b564a6b466a7b368a9b36aa9b26caab06faaaf72aaae75aaac78aaab7ba9aa7ea8a981a6a884a5a787a3a78aa1a78c9ea78e9ba79098" +
  "a79294a89390a8948ba99486a99481a9937ca99278a99073a98e6ea88c6aa78a66a68863a48661a2845fa0825f9e815f9b8061987f63" +
  "957e66927d6a8e7d6e8b7d74897e79857e7f827f8680808c7d81927b839879849d7886a2"
);

/** OpenSettings default: atoi("258") clamped to 2..516. */
export const XOO_DEFAULT_COLOURS = 258;

/** _ftol (msvcrt): truncation. */
export function ftol(value: number): number {
  return Math.trunc(value) | 0;
}

/** Initialize (0x10001000): sin / cos tables [360][34] of doubles. */
export function xooTables(): { sin: Float64Array; cos: Float64Array } {
  const sin = new Float64Array(360 * 34);
  const cos = new Float64Array(360 * 34);
  for (let i = 0; i < 360; i++) {
    const a = (i * 3.14159265) / 180;
    for (let j = 0; j < 34; j++) {
      sin[i * 34 + j] = (Math.sin(a) * j) / 2;
      cos[i * 34 + j] = (Math.cos(a) * j) / 2;
    }
  }
  return { sin, cos };
}

export interface XooState {
  sin: Float64Array;
  cos: Float64Array;
  colours: number;
  frameCount: number; // 0x10033394
  colourStart: number; // 0x10033398
  colourIndex: number; // 0x1003339C
}

export function xooInitialState(colours = XOO_DEFAULT_COLOURS): XooState {
  const t = xooTables();
  return { sin: t.sin, cos: t.cos, colours, frameCount: 0, colourStart: 0, colourIndex: 0 };
}

function nextColour(s: XooState): number {
  s.colourIndex += 3;
  if (s.colourIndex > (s.colours - 1) * 3) s.colourIndex = 0;
  const i = s.colourIndex;
  return ((XOO_PALETTE[i] ?? 0) << 16) | ((XOO_PALETTE[i + 1] ?? 0) << 8) | (XOO_PALETTE[i + 2] ?? 0);
}

/** The in-place raster-order 4-neighbour blur (0x100013C5). */
export function xooBlur(video: Int32Array, width: number, height: number, pitch: number): void {
  for (let y = 0; y < height; y++) {
    const row = y * pitch;
    for (let x = 0; x < width; x++) {
      const xr = row + (x < width - 1 ? x + 1 : x);
      const xl = row + (x > 0 ? x - 1 : x);
      const up = row + (y > 0 ? x - pitch : x);
      const dn = row + (y < height - 1 ? x + pitch : x);
      const a = video[xr] ?? 0, b = video[xl] ?? 0, c = video[up] ?? 0, d = video[dn] ?? 0;
      const r = (((a >>> 16) & 255) + ((b >>> 16) & 255) + ((c >>> 16) & 255) + ((d >>> 16) & 255)) >> 2;
      const g = (((a >>> 8) & 255) + ((b >>> 8) & 255) + ((c >>> 8) & 255) + ((d >>> 8) & 255)) >> 2;
      const bl = ((a & 255) + (b & 255) + (c & 255) + (d & 255)) >> 2;
      video[row + x] = (r << 16) | (g << 8) | bl;
    }
  }
}

/** Render (0x100010BD). */
export function xooRender(s: XooState, video: Int32Array, width: number, height: number, pitch: number, vd: SvpVisData): void {
  let max = 0;
  for (let i = 128; i < 255; i++) {
    const v = vd.spectrum[1][i] ?? 0;
    if (v > max) max = v;
  }
  s.frameCount++;
  if (s.frameCount > 3) {
    s.frameCount = 0;
    s.colourStart += 3;
    if (s.colourStart > (s.colours - 1) * 3) s.colourStart = 0;
  }
  s.colourIndex = s.colourStart;
  const wave = vd.waveform[1];
  for (let i = 0; i < 360; i++) {
    const j = (wave[i] ?? 0) >> 3;
    const colour = nextColour(s);
    const x = ftol((s.sin[i * 34 + j] ?? 0) * max) + (width >> 1);
    const y = ftol((s.cos[i * 34 + j] ?? 0) * max) + (height >> 1);
    if (x >= 0 && x < width && y >= 0 && y < height) video[y * pitch + x] = (video[y * pitch + x] ?? 0) | colour;
  }
  let pos = 0;
  for (let x = 0; x < width; x++) {
    const v = wave[pos] ?? 0;
    const y = v > 127 ? 255 - v + (height >> 1) : (height >> 1) - v;
    const colour = nextColour(s);
    pos++;
    if (pos > 511) pos = 0;
    if (x >= 0 && x < width && y >= 0 && y < height) video[y * pitch + x] = colour;
  }
  xooBlur(video, width, height, pitch);
}

export function createXoo(): SvpEffect {
  const state = xooInitialState();
  return {
    render(video, width, height, pitch, vd) {
      xooRender(state, video, width, height, pitch, vd);
    }
  };
}

export const svp = {
  file: "xoo.svp",
  sha256: ["5cba22a04ed1ce13ccfcd2701c70618d39817b7f58a50369e07417364529871b"],
  create(): SvpEffect {
    return createXoo();
  }
};
