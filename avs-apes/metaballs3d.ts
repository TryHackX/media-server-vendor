/*
 * APE "Metaballs 3D" — metaballs3d.ape by Steven Wittens (UnConeD), Whacko AVS IV
 * (PE timestamp 30 Mar 2002, statically linked multithreaded MSVC CRT, x87 code).
 * Binary sha256 634e6a8fafd6c760dc8d35bb36b4566c80745cb8d8b7888e4f21bc5528324977.
 * Port by static reading of the binary (dumpbin /disasm + the .rdata/.data tables; it was never
 * loaded or run). Notes with addresses and pseudo-code: scratch/avs-reference/apes/metaballs3d.md.
 * The DLL exports only _AVS_APE_RetrFunc (no _AVS_APE_SetExtInfo), so it never sees APEinfo:
 * no line blend mode, no registers, no global buffers.
 *
 * Config (load_config 0x100066F0 copies the bytes over the 72-byte block only when len <= 72 — a
 * longer blob is ignored completely —, then clamps the count to 1..16; save_config writes 72):
 *   +0..+63  colors[16]  int32 0x00RRGGBB              default [0x007FFF, 0, ...]
 *   +64      count       colours cycled through, 1..16  default 1
 *   +68      onBeat      "OnBeat Change" checkbox       default 0
 *
 * Behaviour (render 0x10003E00, always returns 0, draws into framebuffer, ignores fbout):
 *  - Colour: phase += 0.015 per frame, wraps to 0 at `count`; on a beat with onBeat set,
 *    phase = rand()*count/65536 (sic: only the first half of the cycle). With count > 1 the colour
 *    is colors[floor] and colors[ceil % count] mixed 8-bit (weights 255-f and f, f = frac*255).
 *  - Audio: three spectrum bands (bins 0..1, 20..59, 28..200, mean of both channels) smoothed into
 *    integer levels s1..s3, plus "attack" levels a1..a3 = smoothed (s - level) * 1, 2, 3.
 *  - Six balls (field object 0x10004EF0): radius R_k (int) = min(400, 0.95 R + band level mix +
 *    D), +150 on every beat; ball k circles at frame*f_k in its x/y plane with radius 0.75 R
 *    (truncated to int), is turned by two random-walk angles (velocities = (rand()%100)/300 on
 *    beat, damped *0.8 per frame), then z *= 0.2.
 *  - Field (0x10005570): sum over balls of trunc(3000 (1 - d²/220²)²) for d < 220, minus 2000.
 *  - Polygonisation (0x10004AE0/0x10004450): Paul Bourke's marching cubes on a 22×22×22 cube
 *    grid, x and y = -330..330 step 30, z = trunc(t/4) for t = -990..990 step 90 (so the z steps
 *    are 22 or 23), with an edge-vertex cache (each cube owns edges 5, 6, 10). Vertex z += 480.
 *    Limits: a cube is skipped once vertices+8 >= 6000 or triangles+4 >= 5000.
 *  - Lighting (0x10005630): per-triangle normals (cross product, normalised unless shorter than
 *    0.05) summed into vertices; two moving point lights; diffuse = max of the two N·(v-L)
 *    terms → 64..254; specular from the eye reflection → 0..254; vertex colour per channel
 *    min(255, ((C*d>>8)*255>>8) + (s*255>>8)).
 *  - Drawing (0x100041F0 → 0x10001880), triangles in creation order: perspective x/z, y/z times
 *    min(w/2, h/2) truncated (_ftol) around the centre; triangles with a vertex at z < 1 or a
 *    normal z < -0.3 are skipped; 8.8 fixed-point Gouraud scan conversion with a 16-bit 1/z
 *    buffer (cleared each frame), pixels written as colour | 0x010101 (replace, no blending), and
 *    every span marks its four neighbours 0x010101 where the z buffer is still empty — a one-pixel
 *    near-black outline round the silhouette. The binary's left-edge clipping bug is kept: for a
 *    span starting left of x = 0 it computes (start - slope*xmin_8.8) >> 8, which also divides the
 *    start value of z/r/g/b by 256, and it offsets blue with the z slope instead of the blue one.
 *
 * Not recoverable / choices of the port:
 *  - x87 fsin/fcos keep 64-bit mantissas until the next store; the port uses Math.sin/Math.cos
 *    rounded to double. Values can differ in the last bit, which can flip a truncation only when
 *    a product lies within ~1e-16 of an integer. Everything else is IEEE double arithmetic in the
 *    binary's own operation order (53-bit precision control, as AVS's thread has it), _ftol
 *    truncation, 32-bit integer steps and the binary's constants decoded from their bit patterns.
 *  - Random numbers: the plug-in's own CRT, srand(GetTickCount()) in the constructor and three
 *    unused rand() draws there; render's draws come from the thread that renders. The port makes
 *    one generator per instance on the first render, seeded with ctx.now(), and burns the three
 *    constructor draws. (Several instances in one thread would share one generator in AVS.)
 *  - AVS's transition pre-init pass calls render with isBeat = 0x80000000, which this plug-in
 *    counts as a beat; the port only sees ctx.isBeat.
 *  - The binary writes 3 ints past its 31944-entry edge cache on the last cube; the port's array
 *    is simply larger. The unused wireframe code (vtable slots 6, 8, 9) is not ported.
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

// ---------------------------------------------------------------------------------------------
// Configuration

export interface Metaballs3DConfig {
  colors: number[];   // 16 entries, 0x00RRGGBB as stored (int32)
  count: number;      // 1..16
  onBeat: number;     // non-zero: jump in the colour cycle on beats
}

export function metaballs3dDefaults(): Metaballs3DConfig {
  const colors = new Array<number>(16).fill(0);
  colors[0] = 0x7fff;
  return { colors, count: 1, onBeat: 0 };
}

/** load_config 0x100066F0: memcpy(this+4, data, len) only if len <= 72, then clamp count to 1..16. */
export function parseMetaballs3DConfig(config: Uint8Array): Metaballs3DConfig {
  const block = new Uint8Array(72);
  const dv = new DataView(block.buffer);
  const def = metaballs3dDefaults();
  for (let i = 0; i < 16; i++) dv.setInt32(i * 4, def.colors[i]!, true);
  dv.setInt32(64, def.count, true);
  dv.setInt32(68, def.onBeat, true);
  if (config.length <= 72) block.set(config, 0);
  const colors: number[] = [];
  for (let i = 0; i < 16; i++) colors.push(dv.getInt32(i * 4, true));
  let count = dv.getInt32(64, true);
  if (count >= 16) count = 16;
  if (count <= 1) count = 1;
  return { colors, count, onBeat: dv.getInt32(68, true) };
}

// ---------------------------------------------------------------------------------------------
// Constants, decoded from the binary's bit patterns (big-endian hex of the IEEE double)

function hexf(h: string): number {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setUint32(0, parseInt(h.slice(0, 8), 16));
  dv.setUint32(4, parseInt(h.slice(8, 16), 16));
  return dv.getFloat64(0);
}

export const K = {
  ONE: hexf("3FF0000000000000"),        // 1000F050
  NEAR_NZ: hexf("BFD3333333333333"),    // 1000F058 -0.3 (backface tolerance)
  Z_SCALE: hexf("40F0000000000000"),    // 1000F060 65536
  C255: hexf("406FE00000000000"),       // 1000F0A0
  DECAY: hexf("3FECCCCCCCCCCCCD"),      // 1000F0A8 0.9
  C576: hexf("4082000000000000"),       // 1000F0B8
  TWO: hexf("4000000000000000"),        // 1000F0C0
  C288: hexf("4072000000000000"),       // 1000F0C8
  PHASE_STEP: hexf("3F8EB851EB851EB8"), // 1000F0D0 0.015
  INV_65536: hexf("3EF0000000000000"),  // 1000F0D8
  BAND0_W: hexf("3F7CAC083126E979"),    // immediate 0.007
  BAND1_P: hexf("3FB1EB851EB851EC"),    // immediate 0.07 (position and width)
  BAND2_W: hexf("3FD3333333333333"),    // immediate 0.3 (also 1000F0F0, light angle scale)
  BAND2_P: hexf("3FC999999999999A"),    // immediate 0.2 (also 1000F0F8, ball z squash)
  SPIN_A: hexf("3F889374BC6A7EFA"),     // 1000F100 0.012
  SPIN_K: hexf("3F489374BC6A7EFA"),     // 1000F110 0.00075
  SPIN_A2: hexf("3F6633482BE8BC17"),    // 1000F118 0.00271
  SPIN_A3: hexf("3F95810624DD2F1B"),    // 1000F120 0.021
  SPIN_B: hexf("3F70E0221426FE72"),     // 1000F128 0.00412
  SPIN_B2: hexf("3F711F0C34C1A8AC"),    // 1000F130 0.00418
  SPIN_B3: hexf("3F96D5CFAACD9E84"),    // 1000F138 0.0223
  SPIN_C: hexf("3F792641B328B6D8"),     // 1000F140 0.00614
  SPIN_C2: hexf("3F6A4DF47F993D53"),    // 1000F148 0.003211
  SPIN_C3: hexf("3F935A858793DD98"),    // 1000F150 0.0189
  HALF: hexf("3FE0000000000000"),       // 1000F158
  Z_OFF: hexf("407E000000000000"),      // 1000F160 480
  DAMP: hexf("3FE999999999999A"),       // 1000F168 0.8
  VEL: hexf("3F6B4E81B4E81B4F"),        // 1000F170 1/300
  R_KEEP: hexf("3FEE666666666666"),     // 1000F178 0.95
  R_BAND: hexf("3FB851EB851EB852"),     // 1000F180 0.095
  R_MAX: hexf("4079000000000000"),      // 1000F188 400
  R_HALF: hexf("3FA851EB851EB852"),     // 1000F190 0.0475
  D_BAND: hexf("3F5B089A02752547"),     // 1000F198 0.0016500000000000002
  MIN_LEN: hexf("3FA999999999999A"),    // 1000F1A0 0.05 (also ball 0 angular speed)
  ORBIT: hexf("3FE8000000000000"),      // 1000F1A8 0.75
  INV_R2: hexf("3EF5AA2FE645E71F"),     // 1000F1D8 1/48400
  FIELD: hexf("40A7700000000000"),      // 1000F1E0 3000
  L1_XY: hexf("4060400000000000"),      // 1000F1E8 130
  L_ZAMP: hexf("4034000000000000"),     // 1000F1F0 20
  L1_Z: hexf("406CC00000000000"),       // 1000F1F8 230
  L2_SPD: hexf("BFD3E76C8B439581"),     // 1000F200 -0.311
  L2_XY: hexf("4075E00000000000"),      // 1000F208 350
  L2_ZSPD: hexf("3FD999999999999A"),    // 1000F210 0.4
  THREE: hexf("4008000000000000"),      // 1000F218
  L2_Z: hexf("4077C00000000000"),       // 1000F220 380
  M_TWO: hexf("C000000000000000"),      // 1000F228 -2
  SPEC_K: hexf("407FA00000000000"),     // 1000F230 506
  SPEC_OFF: hexf("406FA00000000000"),   // 1000F238 253
  C254: hexf("406FC00000000000"),       // 1000F240 254
  DIFF_K: hexf("407C500000000000"),     // 1000F248 453
  C64: hexf("4050000000000000"),        // 1000F250 64
};

/** Angular speeds of the six balls (1000F1A0, F1B0, F1B8, F1C0, F1C8, F1D0). */
export const BALL_SPEED = [
  hexf("3FA999999999999A"), hexf("3FA4FDF3B645A1CB"), hexf("3FAF62B6AE7D566D"),
  hexf("3FABB2FEC56D5CFB"), hexf("3FA46DC5D6388659"), hexf("3FAD07C84B5DCC64"),
];

// Paul Bourke's marching-cubes triangle table as stored at 0x10010430 (256 × 16 int32, -1
// terminated), one hex digit per edge, rows separated by commas. The edge table at 0x10010030 is
// exactly the set of edges each row uses (checked against the binary), so it is derived.
const TRI_SRC =
  ",083,019,183981,12a,08312a,92a029,2832a8a98,3b2,0b28b0,19023b,1b219b98b,3a1ba3,0a108a8ba,3903b9ba9,98aa8b," +
  "478,430734,019847,419471731,12a847,34730412a,92a902847,2a9297273794,8473b2,b47b24204,90184723b,47b94b9b2921,3a13ba784,1ba14b1047b4,47890b9bab03,47b4b99ba," +
  "954,954083,054150,854835315,12a954,30812a495,52a542402,2a5325354348,95423b,0b208b495,05401523b,21525828b485,a3ba13954,4950818a18ba,54050b5bab03,54858aa8b," +
  "978579,930953573,078017157,153357,978957a12,a12950530573,802825857a52,2a5253357,7957893b2,95797292027b,23b018178157,b21b17715,958857a13a3b,5705097b010aba0,ba0b03a50807570,ba57b5," +
  "a65,0835a6,9015a6,1831985a6,165261,165126308,965906026,598582526328,23ba65,b08b20a65,01923b5a6,5a61929b298b,63b653513,08b0b50515b6,3b6036065059,65969bb98," +
  "5a6478,43047365a,1905a6847,a65197173794,612651478,125526304347,847905065026,739794329596269,3b2784a65,5a647242027b,01947823b5a6,9219b294b7b45a6,8473b53515b6,51b5b610b7b404b,059065036b63847,65969b4797b9," +
  "a4964a,4a649a083,a01a60640,83181686461a,149124264,308129249264,024426,832824426,a49a64b23,08228b49a4a6,3b201606461a,64161a48121b8b1,964936913b63,8b1810b61914641,3b6360064,648b68," +
  "7a678a89a,0730a709a67a,a671a7178180,a67a71173,126168189867,269291679093739,780706602,732672,23ba68a89867,20727b09767a9a7,1801781a767a23b,b21b17a61671,896867916b63136,091b67,7807063b0b60,7b6," +
  "76b,308b76,019b76,819831b76,a126b7,12a3086b7,2902a96b7,6b72a3a83a98,723627,708760620,276237019,162186198876,a76a17137,a7617a187108,03707a0a96a7,76a7a88a9," +
  "684b86,36b306046,86b846901,946963931b36,6846b82a1,12a30b06b046,4b846b0292a9,a93a32943b36463,823842462,042462,190234246438,194142246,8138618466a1,a10a06604,4634386a3039a93,a946a4," +
  "49576b,083495b76,50154076b,b76834354315,954a1276b,6b712a083495,76b54a42a402,348354325a52b76,723762549,954086062687,362376150540,628687218485158,954a16176137,16a176107870954,40a4a503a6a737a,76a7a854a48a," +
  "6956b9b89,36b063056095,0b805b01556b,6b3635531,12a95b9b8b56,0b306b09656912a,b85b56805a52025,6b36352a3a53,589528562382,956960062,158180568382628,156216,13616a386569896,a10a06950560,03856a,a56," +
  "b5a75b,b5ab75830,5b75ab190,a75ab7981831,b12b71751,08312717572b,9759279022b7,75272b592328982,25a235375,820852875a25,9015a35373a2,982921872a25752,135375,087071175,903935537,987597," +
  "5845a8ab8,5045b05abb30,01984a8aba45,ab4a45b34941314,2512852b8458,04b0b345b2b151b,0250592b5458b85,9452b3,25a352345384,5a2524420,3a235a385458019,5a2524192942,845853351,045105,845853905035,945," +
  "4b749b9ab,0834979b79ab,1ab1b414074b,3143481a474bab4,4b79b492b912,9749b791b2b1083,b74b42240,b74b42834324,29a279237749,9a7974a27870207,37a3a274a1a040a,1a2874,491417713,491417081871,403743,487," +
  "9a8ab8,30939bb9a,01a0a88ab,31ab3a,12b1b99b8,30939b1292b9,02b80b,32b,23828aa89,9a2092,23828a0181a8,1a2,138918,091,038,";

/** triTable[256][16] (int8, -1 padded) and edgeTable[256], as in the binary. */
export const TRI_TABLE = new Int8Array(256 * 16).fill(-1);
export const EDGE_TABLE = new Int32Array(256);
{
  const rows = TRI_SRC.split(",");
  if (rows.length !== 256) throw new Error("metaballs3d: bad triangle table");
  for (let i = 0; i < 256; i++) {
    let mask = 0;
    for (let j = 0; j < rows[i]!.length; j++) {
      const e = parseInt(rows[i]![j]!, 16);
      TRI_TABLE[i * 16 + j] = e;
      mask |= 1 << e;
    }
    EDGE_TABLE[i] = mask;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers with the binary's arithmetic

/** MSVC _ftol (0x10006DA8): truncate, fistp qword, keep the low dword. */
export function ftol(x: number): number {
  if (!(x > -9223372036854775808 && x < 9223372036854775808)) return 0;
  return Math.trunc(x) | 0;
}

/** 0x10003CB0: average spectrum level of bins [(2p-w)*288, (w+2p)*288) — channel 1/2 or the mean. */
export function spectrumLevel(vis: Uint8Array, pos: number, width: number, ch: number): number {
  if (width === 0) {
    let i = ftol(pos * K.C576);
    if (i <= 0) i = 0;
    if (i >= 575) i = 575;
    if (ch < 1 || ch > 2) return (vis[576 + i]! + vis[i]!) >> 1;
    return vis[ch * 576 + i - 576]!;
  }
  const p2 = pos * K.TWO;
  let s = ftol((p2 - width) * K.C288);
  if (s <= 0) s = 0;
  if (s >= 575) s = 575;
  let e = ftol((width + p2) * K.C288);
  if (!(e > s + 1)) e = s + 1;
  if (e >= 576) e = 576;
  let sum = 0;
  if (ch < 1 || ch > 2) {
    for (let i = s; i < e; i++) sum += (vis[i + 576]! + vis[i]!) >> 1;
  } else {
    for (let i = s; i < e; i++) sum += vis[ch * 576 - 576 + i]!;
  }
  return (sum / (e - s)) | 0;
}

/** 8-bit channel scaling used for the colour cycle: ((C*k)>>8) per channel, k 0..255. */
export function scaleColor(c: number, k: number): number {
  const g = Math.imul(c & 0xff00, k) & 0xff0000;
  const rb = Math.imul(c & 0xff00ff, k) & 0xff00ffff;
  return ((g | rb) >>> 8) | 0;
}

/** The current colour (start of 0x10005630). */
export function cycleColor(colors: ArrayLike<number>, count: number, phase: number): number {
  if (count <= 1) return colors[0]! | 0;
  const fl = Math.floor(phase);
  const ci = colors[ftol(fl)]! | 0;
  const cj = colors[ftol(Math.ceil(phase)) % count]! | 0;
  const f = ftol((phase - fl) * K.C255) & 0xff;
  return (scaleColor(ci, 255 - f) + scaleColor(cj, f)) | 0;
}

/** Per-vertex colour: diffuse d (64..254) and specular s (0..254) applied to colour c. */
export function shadeColor(c: number, d: number, s: number): number {
  const sp = (s * 255) >> 8;
  let r = ((((((c >>> 16) & 0xff) * d) >> 8) * 255) >> 8) + sp;
  let g = ((((((c >>> 8) & 0xff) * d) >> 8) * 255) >> 8) + sp;
  let b = (((((c & 0xff) * d) >> 8) * 255) >> 8) + sp;
  if (r >= 255) r = 255;
  if (g >= 255) g = 255;
  if (b >= 255) b = 255;
  return (r << 16) | (g << 8) | b;
}

/** 0x10004DA0: rotate about y by b, then about x by a, then about z by c (in place). */
export function rotateBall(v: Float64Array, o: number, a: number, b: number, c: number): void {
  let x = v[o]!, y = v[o + 1]!, z = v[o + 2]!;
  const cb = Math.cos(b), sb = Math.sin(b);
  const x1 = x * cb - z * sb;
  z = sb * x + cb * z;
  x = x1;
  const ca = Math.cos(a), sa = Math.sin(a);
  const y1 = y * ca - z * sa;
  z = sa * y + ca * z;
  y = y1;
  const cc = Math.cos(c), sc = Math.sin(c);
  const y2 = y * cc - x * sc;
  x = sc * y + cc * x;
  v[o] = x; v[o + 1] = y2; v[o + 2] = z;
}

/** 0x10005570: the metaball field at integer grid point (a, b, c); balls = 6 × (x, y, z). */
export function fieldValue(balls: Float64Array, a: number, b: number, c: number): number {
  let sum = 0;
  for (let k = 0; k < 6; k++) {
    const dy = b - balls[k * 3 + 1]!;
    const dz = c - balls[k * 3 + 2]!;
    const dx = a - balls[k * 3]!;
    const r2 = ((dy * dy + dz * dz) + dx * dx) * K.INV_R2;
    let v = 0;
    if (r2 < K.ONE) v = ((r2 - K.TWO) * r2 + K.ONE) * K.FIELD;
    let iv = ftol(v);
    if (iv <= 0) iv = 0;
    sum = (sum + iv) | 0;
  }
  return (sum - 2000) | 0;
}

/** Grid coordinates of the polygoniser (0x10004AE0): x, y = -330..330 step 30, z = trunc(t/4). */
export const GRID_XY = Int32Array.from({ length: 23 }, (_, i) => -330 + 30 * i);
export const GRID_Z = Int32Array.from({ length: 23 }, (_, i) => ((-990 + 90 * i) / 4) | 0);

/** 0x10004300 VertexInterp at iso 0; writes x, y, z (+480) into out[o..o+2]. */
export function vertexInterp(out: Float64Array, o: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, v1: number, v2: number): void {
  if (v1 === 0) { out[o] = ax; out[o + 1] = ay; out[o + 2] = (az + 480) | 0; return; }
  if (v2 === 0) { out[o] = bx; out[o + 1] = by; out[o + 2] = (bz + 480) | 0; return; }
  if (v1 === v2) {
    out[o] = ((bx + ax) | 0) * K.HALF;
    out[o + 1] = ((ay + by) | 0) * K.HALF;
    out[o + 2] = ((az + bz) | 0) * K.HALF + K.Z_OFF;
    return;
  }
  const mu = -v1 / ((v2 - v1) | 0);
  out[o] = ((bx - ax) | 0) * mu + ax;
  out[o + 1] = ((by - ay) | 0) * mu + ay;
  out[o + 2] = (mu * ((bz - az) | 0) + az) + K.Z_OFF;
}

const VCAP = 6000 + 16;   // the binary allows a cube to start at 5991 vertices and add up to 12
const TCAP = 5000;
const CACHE = 31944 + 3;  // 22³ cubes × 3 edges, +3 for the overrun of the last cube

// ---------------------------------------------------------------------------------------------
// The effect

export class Metaballs3D implements ApeEffect {
  colors: Int32Array;
  count: number;
  onBeat: number;

  rand: (() => number) | null = null;
  frame = 0;                       // +0x54
  beats = 0;                       // +0x8C (counted, never read)
  phase = 0;                       // +0xB8 colour cycle position
  zw = -1; zh = -1;                // +0x50 size of the z buffer
  zbuf: Uint16Array = new Uint16Array(0);   // +0x70
  // audio levels +0x58/+0x5C/+0x60 (smoothed) and +0x64/+0x68/+0x6C (attack)
  s1 = 0; s2 = 0; s3 = 0; a1 = 0; a2 = 0; a3 = 0;
  // light angles +0xC0, +0xC8, +0xD0, +0xF8, +0x100, +0x108
  angC0 = 0; angC8 = 0; angD0 = 0; angF8 = 0; ang100 = 0; ang108 = 0;
  // field object (+0x130): ball centres, radii, angles, angular velocities, radius offset
  balls = new Float64Array(18);
  radius = new Int32Array(6);
  turn = new Float64Array(12);
  turnVel = new Float64Array(12);
  radiusBias = 0;
  // mesh
  nv = 0; nt = 0;
  vpos = new Float64Array(VCAP * 3);
  vnrm = new Float64Array(VCAP * 3);
  vcnt = new Int32Array(VCAP);
  vcol = new Int32Array(VCAP);
  tidx = new Int32Array(TCAP * 3);
  tnrm = new Float64Array(TCAP * 3);
  cache = new Int32Array(CACHE);
  lattice = new Int32Array(23 * 23 * 23);

  constructor(cfg: Metaballs3DConfig) {
    this.colors = Int32Array.from(cfg.colors);
    this.count = cfg.count;
    this.onBeat = cfg.onBeat;
  }

  render(ctx: ApeContext, framebuffer: Int32Array, _fbout: Int32Array): number {
    const w = ctx.w | 0, h = ctx.h | 0;
    if (this.rand === null) {
      // constructor: srand(GetTickCount()); three rand()*100 stored in fields nobody reads.
      this.rand = ctx.makeRand(ctx.now() >>> 0);
      this.rand(); this.rand(); this.rand();
    }
    const rand = this.rand;
    this.nv = 0;
    this.nt = 0;
    const beat = ctx.isBeat;
    this.frame = (this.frame + 1) | 0;
    this.phase = this.phase + K.PHASE_STEP;
    if (this.count <= this.phase) this.phase = 0;
    if (beat) {
      this.beats = (this.beats + 1) | 0;
      if (this.onBeat !== 0) this.phase = Math.imul(rand(), this.count) * K.INV_65536;
      if (this.count <= this.phase) this.phase = 0;
    }
    if (w !== this.zw || h !== this.zh) {
      this.zw = w; this.zh = h;
      this.zbuf = new Uint16Array(Math.max(0, w * h));
    } else {
      this.zbuf.fill(0);
    }

    const vis = ctx.visdataUnsigned;
    let v = spectrumLevel(vis, 0.0, K.BAND0_W, 0) & 0xff;
    this.s1 = ((v + v + this.s1) / 2) | 0;
    this.a1 = ((this.s1 - v + this.a1) / 2) | 0;
    v = spectrumLevel(vis, K.BAND1_P, K.BAND1_P, 0) & 0xff;
    this.s2 = ((v + v + this.s2) / 2) | 0;
    this.a2 = ((2 * (this.s2 - v) + this.a2) / 2) | 0;
    v = spectrumLevel(vis, K.BAND2_P, K.BAND2_W, 0) & 0xff;
    this.s3 = ((v + v + this.s3) / 2) | 0;
    this.a3 = ((3 * (this.s3 - v) + this.a3) / 2) | 0;

    const t = this.frame;
    let x = Math.sin(t * K.SPIN_A);
    let sg = x < 0 ? -1 : 1;
    const dA = Math.sin(t * K.SPIN_A2) * K.SPIN_A3 + ((Math.sqrt(Math.abs(x)) * this.a1) * sg) * K.SPIN_K;
    x = Math.sin(t * K.SPIN_B);
    sg = x < 0 ? -1 : 1;
    const dB = Math.sin(t * K.SPIN_B2) * K.SPIN_B3 + ((Math.sqrt(Math.abs(x)) * this.a2) * sg) * K.SPIN_K;
    x = Math.sin(t * K.SPIN_C);
    sg = x < 0 ? -1 : 1;
    const dC = Math.sin(t * K.SPIN_C2) * K.SPIN_C3 + ((Math.sqrt(Math.abs(x)) * this.a3) * sg) * K.SPIN_K;
    this.angC0 = this.angC0 + dA;
    this.angC8 = this.angC8 + dB;
    this.angD0 = this.angD0 + dC;
    this.angF8 = this.angF8 + dB;
    this.ang100 = dC + this.ang100;
    this.ang108 = this.ang108 + dA;

    this.polygonize(beat, rand);
    this.light();
    for (let i = 0; i < this.nt; i++) {
      this.drawTriangle(framebuffer, w, h, this.tidx[i * 3]!, this.tidx[i * 3 + 1]!, this.tidx[i * 3 + 2]!,
        this.tnrm[i * 3 + 2]!);
    }
    return 0;
  }

  /** Field object update (0x10004EF0): turn angles, beat kicks, radii, ball centres, level decay. */
  moveBalls(beat: boolean, rand: () => number): void {
    const A = this.turn, V = this.turnVel, R = this.radius;
    for (let i = 0; i < 12; i++) {
      A[i] = V[i]! + A[i]!;
      V[i] = V[i]! * K.DAMP;
    }
    if (beat) {
      for (let i = 0; i < 12; i++) V[i] = (rand() % 100) * K.VEL;
      for (let k = 0; k < 6; k++) R[k] = (R[k]! + 150) | 0;
    }
    const s1 = this.s1, s2 = this.s2, s3 = this.s3, d = this.radiusBias;
    const cap = (v: number): number => (K.R_MAX > v ? v : K.R_MAX);
    R[0] = ftol(cap(R[0]! * K.R_KEEP + s1 * K.R_BAND + d));
    R[1] = ftol(cap(R[1]! * K.R_KEEP + s2 * K.R_BAND + d));
    R[2] = ftol(cap(R[2]! * K.R_KEEP + s3 * K.R_BAND + d));
    R[3] = ftol(cap(R[3]! * K.R_KEEP + s1 * K.R_HALF + s2 * K.R_HALF + d));
    R[4] = ftol(cap(R[4]! * K.R_KEEP + s3 * K.R_HALF + s1 * K.R_HALF + d));
    R[5] = ftol(cap(R[5]! * K.R_KEEP + s3 * K.R_HALF + s2 * K.R_HALF + d));
    this.radiusBias = ((s1 + s2 + s3) | 0) * K.D_BAND + d * K.DECAY;
    const t = this.frame;
    const B = this.balls;
    for (let k = 0; k < 6; k++) {
      const ang = t * BALL_SPEED[k]!;
      const rk = R[k]!;
      B[k * 3] = ftol((Math.sin(ang) * rk) * K.ORBIT);
      B[k * 3 + 1] = ftol((Math.cos(ang) * rk) * K.ORBIT);
      B[k * 3 + 2] = 0;
      rotateBall(B, k * 3, A[k * 2]!, A[k * 2 + 1]!, 0.0);
      B[k * 3 + 2] = B[k * 3 + 2]! * K.BAND2_P;
    }
    this.s1 = ftol(this.s1 * K.DECAY);
    this.s2 = ftol(this.s2 * K.DECAY);
    this.s3 = ftol(this.s3 * K.DECAY);
  }

  /** 0x10004AE0: clear the edge cache, move the balls, march the 22³ cubes. The binary evaluates
   *  the field per cube corner (reusing the previous cube's four shared values); the field is a
   *  pure function of the grid point, so evaluating the 23³ lattice once gives the same numbers. */
  polygonize(beat: boolean, rand: () => number): void {
    this.cache.fill(-1);
    this.moveBalls(beat, rand);
    const L = this.lattice, B = this.balls;
    for (let k = 0; k < 23; k++) {
      for (let j = 0; j < 23; j++) {
        for (let i = 0; i < 23; i++) L[(k * 23 + j) * 23 + i] = fieldValue(B, GRID_XY[i]!, GRID_XY[j]!, GRID_Z[k]!);
      }
    }
    this.march();
  }

  /** The cube loop of 0x10004AE0: z outermost, then y, x innermost; the cache index grows by 3
   *  before each cube (so cube n uses 3n+3 .. 3n+5). */
  march(): void {
    this.cache.fill(-1);
    let idx = 0;
    for (let k = 0; k < 22; k++) {
      for (let j = 0; j < 22; j++) {
        for (let i = 0; i < 22; i++) {
          idx += 3;
          this.cube(i, j, k, idx);
        }
      }
    }
  }

  addVertex(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    v1: number, v2: number): number {
    const n = this.nv;
    vertexInterp(this.vpos, n * 3, ax, ay, az, bx, by, bz, v1, v2);
    this.vnrm[n * 3] = 0; this.vnrm[n * 3 + 1] = 0; this.vnrm[n * 3 + 2] = 0;
    this.vcnt[n] = 0;
    this.vcol[n] = 0;
    this.nv = n + 1;
    return n;
  }

  /** 0x10004450: one cube; i, j, k = indices along x (inner loop), y, z (outer loop). */
  cube(i: number, j: number, k: number, idx: number): void {
    if (this.nv + 8 >= 6000) return;
    if (this.nt + 4 >= 5000) return;
    const L = this.lattice;
    const at = (ii: number, jj: number, kk: number): number => L[(kk * 23 + jj) * 23 + ii]!;
    const v0 = at(i, j, k), v1 = at(i + 1, j, k), v2 = at(i + 1, j + 1, k), v3 = at(i, j + 1, k);
    const v4 = at(i, j, k + 1), v5 = at(i + 1, j, k + 1), v6 = at(i + 1, j + 1, k + 1), v7 = at(i, j + 1, k + 1);
    let ci = 0;
    if (v0 < 0) ci |= 1;
    if (v1 < 0) ci |= 2;
    if (v2 < 0) ci |= 4;
    if (v3 < 0) ci |= 8;
    if (v4 < 0) ci |= 16;
    if (v5 < 0) ci |= 32;
    if (v6 < 0) ci |= 64;
    if (v7 < 0) ci |= 128;
    const e = EDGE_TABLE[ci]!;
    if (e === 0) return;
    const xa = GRID_XY[i]!, xb = GRID_XY[i + 1]!, ya = GRID_XY[j]!, yb = GRID_XY[j + 1]!;
    const za = GRID_Z[k]!, zb = GRID_Z[k + 1]!;
    const fi = i === 0, fj = j === 0, fk = k === 0;
    const C = this.cache;
    const vl = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
    // corners: p0 (xa,ya,za) p1 (xb,ya,za) p2 (xb,yb,za) p3 (xa,yb,za) p4..p7 the same at zb
    if (e & 0x001) vl[0] = (fj || fk) ? this.addVertex(xa, ya, za, xb, ya, za, v0, v1) : C[idx - 1517]!;
    if (e & 0x002) vl[1] = fk ? this.addVertex(xb, ya, za, xb, yb, za, v1, v2) : C[idx - 1452]!;
    if (e & 0x004) vl[2] = fk ? this.addVertex(xb, yb, za, xa, yb, za, v2, v3) : C[idx - 1451]!;
    if (e & 0x008) vl[3] = (fi || fk) ? this.addVertex(xa, yb, za, xa, ya, za, v3, v0) : C[idx - 1455]!;
    if (e & 0x010) vl[4] = fj ? this.addVertex(xa, ya, zb, xb, ya, zb, v4, v5) : C[idx - 65]!;
    if (e & 0x020) { vl[5] = this.addVertex(xb, ya, zb, xb, yb, zb, v5, v6); C[idx] = vl[5]!; }
    if (e & 0x040) { vl[6] = this.addVertex(xb, yb, zb, xa, yb, zb, v6, v7); C[idx + 1] = vl[6]!; }
    if (e & 0x080) vl[7] = fi ? this.addVertex(xa, yb, zb, xa, ya, zb, v7, v4) : C[idx - 3]!;
    if (e & 0x100) vl[8] = (fi || fj) ? this.addVertex(xa, ya, za, xa, ya, zb, v0, v4) : C[idx - 67]!;
    if (e & 0x200) vl[9] = fj ? this.addVertex(xb, ya, za, xb, ya, zb, v1, v5) : C[idx - 64]!;
    if (e & 0x400) { vl[10] = this.addVertex(xb, yb, za, xb, yb, zb, v2, v6); C[idx + 2] = vl[10]!; }
    if (e & 0x800) vl[11] = fi ? this.addVertex(xa, yb, za, xa, yb, zb, v3, v7) : C[idx - 1]!;
    for (let q = ci * 16; TRI_TABLE[q] !== -1; q += 3) {
      const n = this.nt;
      this.tidx[n * 3] = vl[TRI_TABLE[q]!]!;
      this.tidx[n * 3 + 1] = vl[TRI_TABLE[q + 1]!]!;
      this.tidx[n * 3 + 2] = vl[TRI_TABLE[q + 2]!]!;
      this.nt = n + 1;
    }
  }

  /** 0x10005630: colour of the frame, triangle and vertex normals, two-light shading. */
  light(): void {
    const color = cycleColor(this.colors, this.count, this.phase);
    const P = this.vpos, N = this.vnrm, T = this.tidx, TN = this.tnrm;
    for (let i = 0; i < this.nt; i++) {
      const a = T[i * 3]! * 3, b = T[i * 3 + 1]! * 3, c = T[i * 3 + 2]! * 3;
      const e1x = P[a]! - P[b]!, e1y = P[a + 1]! - P[b + 1]!, e1z = P[a + 2]! - P[b + 2]!;
      const e2x = P[c]! - P[b]!, e2y = P[c + 1]! - P[b + 1]!, e2z = P[c + 2]! - P[b + 2]!;
      let nx = e2z * e1y - e2y * e1z;
      let ny = e2x * e1z - e2z * e1x;
      let nz = e2y * e1x - e2x * e1y;
      const len = Math.sqrt((nz * nz + ny * ny) + nx * nx);
      const inv = len < K.MIN_LEN ? 1.0 : 1.0 / len;
      nx = inv * nx; ny = inv * ny; nz = inv * nz;
      TN[i * 3] = nx; TN[i * 3 + 1] = ny; TN[i * 3 + 2] = nz;
      for (const o of [a, b, c]) {
        this.vcnt[o / 3] = (this.vcnt[o / 3]! + 1) | 0;
        N[o] = N[o]! + nx;
        N[o + 1] = N[o + 1]! + ny;
        N[o + 2] = N[o + 2]! + nz;
      }
    }
    // lights
    const l1x = Math.cos(this.angC0 * K.BAND2_W) * K.L1_XY;
    const l1y = Math.sin(this.angC8 * K.BAND2_W) * K.L1_XY;
    const l1z = Math.sin(this.angD0 * K.BAND2_W) * K.L_ZAMP + K.L1_Z;
    const l2x = Math.cos(this.angF8 * K.L2_SPD + K.ONE) * K.L2_XY;
    const l2y = Math.sin(this.ang100 * K.L2_SPD + K.ONE) * K.L2_XY;
    const l2z = Math.sin(this.ang108 * K.L2_ZSPD + K.THREE) * K.L_ZAMP + K.L2_Z;
    const unit = (len: number): number => (len < K.MIN_LEN ? 1.0 : 1.0 / len);
    for (let i = 0; i < this.nv; i++) {
      const o = i * 3;
      const cnt = this.vcnt[i]!;
      if (cnt === -1) continue;
      let nx = N[o]! / cnt, ny = N[o + 1]! / cnt, nz = N[o + 2]! / cnt;
      let s = unit(Math.sqrt((nz * nz + ny * ny) + nx * nx));
      nx = s * nx; ny = s * ny; nz = s * nz;
      const px = P[o]!, py = P[o + 1]!, pz = P[o + 2]!;
      let d1x = px - l1x, d1y = py - l1y, d1z = pz - l1z;
      s = unit(Math.sqrt((d1y * d1y + d1z * d1z) + d1x * d1x));
      d1x = d1x * s; d1y = d1y * s; d1z = d1z * s;
      let d2x = px - l2x, d2y = py - l2y, d2z = pz - l2z;
      s = unit(Math.sqrt((d2y * d2y + d2z * d2z) + d2x * d2x));
      d2x = s * d2x; d2y = s * d2y; d2z = s * d2z;
      const diff1 = (d1y * ny + d1z * nz) + d1x * nx;
      const diff2 = (ny * d2y + nz * d2z) + nx * d2x;
      const dmax = diff2 < diff1 ? diff1 : diff2;
      let ex = px, ey = py, ez = pz;
      s = unit(Math.sqrt((ey * ey + ez * ez) + ex * ex));
      ex = s * ex; ey = s * ey; ez = s * ez;
      const k2 = ((ny * ey + nz * ez) + nx * ex) * K.M_TWO;
      nx = nx * k2; ny = ny * k2; nz = k2 * nz;
      let rx = nx + ex, ry = ny + ey, rz = nz + ez;
      s = unit(Math.sqrt((ry * ry + rz * rz) + rx * rx));
      rx = s * rx; ry = s * ry; rz = s * rz;
      const sp1 = -((d1y * ry + d1z * rz) + d1x * rx);
      const sp2 = -((ry * d2y + rz * d2z) + rx * d2x);
      const smax = sp2 < sp1 ? sp1 : sp2;
      N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;   // the binary stores the scaled normal back
      // specular 0..254
      let sv = 0 < smax ? smax : 0;
      sv = sv * K.SPEC_K - K.SPEC_OFF;
      sv = 0 < sv ? sv : 0;
      sv = sv + this.vcol[i]!;                     // fiadd of the (still zero) colour slot
      sv = K.C254 > sv ? sv : K.C254;
      sv = 0 < sv ? sv : 0;
      const spec = ftol(sv) & 0xff;
      // diffuse 64..254
      let dv = dmax * K.DIFF_K;
      dv = K.C254 > dv ? dv : K.C254;
      dv = K.C64 < dv ? dv : K.C64;
      const diff = ftol(dv) & 0xff;
      this.vcol[i] = shadeColor(color, diff, spec);
    }
  }

  /** 0x10001880: one Gouraud triangle with the 16-bit 1/z buffer and the 0x010101 outline. */
  drawTriangle(fb: Int32Array, w: number, h: number, i0: number, i1: number, i2: number, nz: number): void {
    const P = this.vpos;
    const hw = w >> 1, hh = h >> 1;
    const scale = hh < hw ? hh : hw;
    if (K.ONE > P[i0 * 3 + 2]! || K.ONE > P[i1 * 3 + 2]! || K.ONE > P[i2 * 3 + 2]!) return;
    // projected copies: x, y, 1/z, colour
    const q = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ids = [i0, i1, i2];
    for (let n = 0; n < 3; n++) {
      const o = ids[n]! * 3;
      const z = P[o + 2]!;
      if (K.ONE < z) {
        const inv = K.ONE / z;
        q[n * 4] = (inv * P[o]!) * scale;
        q[n * 4 + 1] = (P[o + 1]! * inv) * scale;
        q[n * 4 + 2] = inv;
      } else {
        q[n * 4] = -w; q[n * 4 + 1] = -h; q[n * 4 + 2] = z;
      }
      q[n * 4 + 3] = this.vcol[ids[n]!]!;
    }
    if (nz < K.NEAR_NZ) return;
    const swap = (a: number, b: number): void => {
      for (let m = 0; m < 4; m++) { const t = q[a * 4 + m]!; q[a * 4 + m] = q[b * 4 + m]!; q[b * 4 + m] = t; }
    };
    if (q[5]! < q[1]!) swap(0, 1);
    if (q[9]! < q[5]!) swap(1, 2);
    if (q[5]! < q[1]!) swap(0, 1);
    if (!(hh > q[1]!)) return;
    if (-hh > q[9]!) return;
    const x0 = (ftol(q[0]!) + hw) | 0, x1 = (ftol(q[4]!) + hw) | 0, x2 = (ftol(q[8]!) + hw) | 0;
    const y0 = (ftol(q[1]!) + hh) | 0, y1 = (ftol(q[5]!) + hh) | 0, y2 = (ftol(q[9]!) + hh) | 0;
    if (y2 === y0) return;
    const z0 = ftol(q[2]! * K.Z_SCALE) & 0xffff, z1 = ftol(q[6]! * K.Z_SCALE) & 0xffff, z2 = ftol(q[10]! * K.Z_SCALE) & 0xffff;
    const c0 = q[3]!, c1 = q[7]!, c2 = q[11]!;
    const R0 = (c0 >> 16) & 0xff, G0 = (c0 >> 8) & 0xff, B0 = c0 & 0xff;
    const R1 = (c1 >> 16) & 0xff, G1 = (c1 >> 8) & 0xff, B1 = c1 & 0xff;
    const R2 = (c2 >> 16) & 0xff, G2 = (c2 >> 8) & 0xff, B2 = c2 & 0xff;

    // edge A (short edges) and edge B (long edge 0→2), all 8.8 fixed point
    let xA = x0 << 8, xB = x0 << 8, zA = z0 << 8, zB = z0 << 8;
    let rA = R0 << 8, rB = R0 << 8, gA = G0 << 8, gB = G0 << 8, bA = B0 << 8, bB = B0 << 8;
    let dxA: number, dxB: number, dzA: number, dzB: number, drA: number, drB: number;
    let dgA: number, dgB: number, dbA: number, dbB: number;
    let y: number;

    if (y1 !== y0) {
      const n1 = (y1 - y0) | 0, n2 = (y2 - y0) | 0;
      dxA = (((x1 - x0) << 8) / n1) | 0; dxB = (((x2 - x0) << 8) / n2) | 0;
      dzA = (((z1 - z0) << 8) / n1) | 0; dzB = (((z2 - z0) << 8) / n2) | 0;
      drA = (((R1 << 8) - (R0 << 8)) / n1) | 0; drB = (((R2 << 8) - (R0 << 8)) / n2) | 0;
      dgA = (((G1 << 8) - (G0 << 8)) / n1) | 0; dgB = (((G2 << 8) - (G0 << 8)) / n2) | 0;
      dbA = (((B1 << 8) - (B0 << 8)) / n1) | 0; dbB = (((B2 << 8) - (B0 << 8)) / n2) | 0;
      y = y0;
      for (;;) {
        if (y < 0) {
          y++;
          xA = (xA + dxA) | 0; xB = (xB + dxB) | 0; zA = (zA + dzA) | 0; zB = (zB + dzB) | 0;
          rA = (rA + drA) | 0; rB = (rB + drB) | 0; gA = (gA + dgA) | 0; gB = (gB + dgB) | 0;
          bA = (bA + dbA) | 0; bB = (bB + dbB) | 0;
          if (y < y1) continue;
        }
        if (y >= h) return;
        if (y >= y1) break;
        this.span(fb, w, h, y, xA, xB, zA, zB, rA, rB, gA, gB, bA, bB);
        xA = (xA + dxA) | 0; xB = (xB + dxB) | 0; zA = (zA + dzA) | 0; zB = (zB + dzB) | 0;
        rA = (rA + drA) | 0; rB = (rB + drB) | 0; gA = (gA + dgA) | 0; gB = (gB + dgB) | 0;
        bA = (bA + dbA) | 0; bB = (bB + dbB) | 0;
        y++;
      }
    }

    // lower half: edge A restarts at vertex 1, edge B is re-derived at row y1 (integer division)
    const nT = (y2 - y0) | 0, nL = (y2 - y1) | 0, nU = (y1 - y0) | 0;
    xA = x1 << 8; zA = z1 << 8; rA = R1 << 8; gA = G1 << 8; bA = B1 << 8;
    xB = (((Math.imul(nL, x0) + Math.imul(nU, x2)) / nT) | 0) << 8;
    zB = (((Math.imul(nL, z0) + Math.imul(nU, z2)) / nT) | 0) << 8;
    rB = (((Math.imul(R0, nL) << 8) / nT) | 0) + (((Math.imul(R2, nU) << 8) / nT) | 0);
    gB = (((Math.imul(G0, nL) << 8) / nT) | 0) + (((Math.imul(G2, nU) << 8) / nT) | 0);
    bB = (((Math.imul(nL, B0) << 8) / nT) | 0) + (((Math.imul(nU, B2) << 8) / nT) | 0);
    if (y2 === y1) return;
    dxA = (((x2 - x1) << 8) / nL) | 0; dxB = (((x2 - x0) << 8) / nT) | 0;
    dzA = (((z2 - z1) << 8) / nL) | 0; dzB = (((z2 - z0) << 8) / nT) | 0;
    drA = (((R2 << 8) - (R1 << 8)) / nL) | 0; drB = (((R2 << 8) - (R0 << 8)) / nT) | 0;
    dgA = (((G2 << 8) - (G1 << 8)) / nL) | 0; dgB = (((G2 << 8) - (G0 << 8)) / nT) | 0;
    dbA = (((B2 << 8) - (B1 << 8)) / nL) | 0; dbB = (((B2 << 8) - (B0 << 8)) / nT) | 0;
    y = y1;
    for (;;) {
      if (y < 0) {
        y++;
        xA = (xA + dxA) | 0; xB = (xB + dxB) | 0; zA = (zA + dzA) | 0; zB = (zB + dzB) | 0;
        rA = (rA + drA) | 0; rB = (rB + drB) | 0; gA = (gA + dgA) | 0; gB = (gB + dgB) | 0;
        bA = (bA + dbA) | 0; bB = (bB + dbB) | 0;
        if (y < y2) continue;
      }
      if (y >= h) return;
      if (y >= y2) return;
      this.span(fb, w, h, y, xA, xB, zA, zB, rA, rB, gA, gB, bA, bB);
      xA = (xA + dxA) | 0; xB = (xB + dxB) | 0; zA = (zA + dzA) | 0; zB = (zB + dzB) | 0;
      rA = (rA + drA) | 0; rB = (rB + drB) | 0; gA = (gA + dgA) | 0; gB = (gB + dgB) | 0;
      bA = (bA + dbA) | 0; bB = (bB + dbB) | 0;
      y++;
    }
  }

  /** One scanline of 0x10001880 (both halves use the same code). */
  span(fb: Int32Array, w: number, h: number, y: number,
    xA: number, xB: number, zA: number, zB: number, rA: number, rB: number,
    gA: number, gB: number, bA: number, bB: number): void {
    const zb = this.zbuf;
    let xmin = xB < xA ? xB : xA;
    const xmax1 = ((xB > xA ? xB : xA) + 1) | 0;
    const len = (xmax1 - xmin) | 0;
    let zL: number, rL: number, gL: number, bL: number, dz: number, dr: number, dg: number, db: number;
    if (xA === xmin) {
      zL = zA; dz = (((zB - zA) << 8) / len) | 0;
      rL = rA; dr = (((rB - rA) << 8) / len) | 0;
      gL = gA; dg = (((gB - gA) << 8) / len) | 0;
      bL = bA; db = (((bB - bA) << 8) / len) | 0;
    } else {
      zL = zB; dz = (((zA - zB) << 8) / len) | 0;
      rL = rB; dr = (((rA - rB) << 8) / len) | 0;
      gL = gB; dg = (((gA - gB) << 8) / len) | 0;
      bL = bB; db = (((bA - bB) << 8) / len) | 0;
    }
    if (xmin < 0) {
      // the binary's clip: (start - slope*xmin_8.8) >> 8, and blue uses the z slope
      const tz = Math.imul(dz, xmin);
      zL = (zL - tz) >> 8;
      rL = (rL - Math.imul(dr, xmin)) >> 8;
      gL = (gL - Math.imul(dg, xmin)) >> 8;
      bL = (bL - tz) >> 8;
      xmin = 0;
    }
    let x = xmin >> 8;
    let xend = xmax1 >> 8;
    if (xend > w - 2) xend = w - 2;
    if (xend <= 0) return;
    if (w - 1 <= x) return;
    const row = Math.imul(y, w);
    if (x > 0) {
      if (zb[row + x - 1] === 0 && x - 1 >= 0 && x - 1 < w && y >= 0 && y < h) fb[row + x - 1] = 0x010101;
    }
    if (zb[row + xend + 1] === 0 && xend + 1 >= 0 && xend + 1 < w && y >= 0 && y < h) fb[row + xend + 1] = 0x010101;
    if (xend < x) return;
    for (; x <= xend; x++) {
      if (y > 0 && zb[row - w + x] === 0 && x >= 0 && x < w && y - 1 >= 0 && y - 1 < h) fb[row - w + x] = 0x010101;
      if (y < h - 2 && zb[row + w + x] === 0 && x >= 0 && x < w && y + 1 >= 0 && y + 1 < h) fb[row + w + x] = 0x010101;
      const z = zL >> 8;
      if (zb[row + x]! < z) {
        zb[row + x] = z & 0xffff;
        if (x >= 0 && x < w && y >= 0 && y < h) {
          let r = rL >> 8, g = gL >> 8, b = bL >> 8;
          if (r <= 0) r = 0; if (r >= 255) r = 255;
          if (g <= 0) g = 0; if (g >= 255) g = 255;
          if (b <= 0) b = 0; if (b >= 255) b = 255;
          fb[row + x] = (r << 16) | (g << 8) | b | 0x010101;
        }
      }
      zL = (zL + dz) | 0; rL = (rL + dr) | 0; gL = (gL + dg) | 0; bL = (bL + db) | 0;
    }
  }
}

export const ape = {
  id: "Metaballs 3D",
  sha256: ["634e6a8fafd6c760dc8d35bb36b4566c80745cb8d8b7888e4f21bc5528324977"],
  create(config: Uint8Array): ApeEffect {
    return new Metaballs3D(parseMetaballs3DConfig(config));
  },
};
