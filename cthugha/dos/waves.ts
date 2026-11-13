/**
 * Cthugha 5.3's waves (MODES.C, PETE.C): the sound written into the buffer before the next
 * flame. Cthugha (c) 1993-1995 Kevin "Zaph" Burfitt, Torps Productions; Pete's waves as
 * credited in PETE.C. Non-commercial use only, with credit (COPYING-cthugha-53.txt).
 *
 * stereo[x][c] is the sound card's unsigned 8-bit sample (128 is silence), [x][0] the left
 * channel, 320 of them a frame; flat here: stereo[2x + c]. The static variables of the C
 * functions are fields of Waves. Where the C code read before or after table[][] (a sine as an
 * index), this reads 0.
 */

const W = 320;
const H = 204;
const BOTTOM = 200;

/** sine[320] (init_pete): 128 sin, in 1/320 of a turn. */
const SINE = new Int32Array(320);
for (let i = 0; i < 320; i += 1) SINE[i] = Math.trunc(128 * Math.sin(i * 0.03927));

export class Waves {
  /** wave_buff9's column, wave_buff10's row. */
  private col = 128;
  private row = 0;
  /** wave_pete0 (FireFlies), wave_fract1 and wave_fract2 (Zippy 1, 2): their offsets. */
  private readonly flies = [W / 2, H / 2, W / 2, H / 2];
  private readonly zippy1 = [W / 2, H / 2, W / 2, H / 2];
  private readonly zippy2 = [W / 2, H / 2, W / 2, H / 2];

  /** `b` is the buffer drawn into; the engine points it at buff again after a translation swapped them. */
  constructor(public b: Uint8Array, private readonly stereo: Int32Array, private readonly table: Int32Array) {}

  /** wavearray[], in its order and with its names. */
  readonly list: readonly { name: string; draw: (t: number) => void }[] = [
    { name: "Dot HS", draw: (t) => this.dotH(t, 2) },
    { name: "Dot HL", draw: (t) => this.dotH(t, 1) },
    { name: "Line VW", draw: (t) => this.dotV(t, 2) },
    { name: "Spike S", draw: (t) => this.spikeS(t) },
    { name: "Spike L", draw: (t) => this.spikeL(t) },
    { name: "Line HS", draw: (t) => this.lineH(t, 2) },
    { name: "Line HL", draw: (t) => this.lineH(t, 1) },
    { name: "Dot VL", draw: (t) => this.dotV(t, 1) },
    { name: "Spike", draw: (t) => this.spike(t) },
    { name: "Walking", draw: (t) => this.walking(t) },
    { name: "Falling", draw: (t) => this.falling(t) },
    { name: "Lissa", draw: (t) => this.lissa(t) },
    { name: "Line VS", draw: (t) => this.lineV(t, W / 2, W / 2, 2) },
    { name: "Line VL", draw: (t) => this.lineV(t, W / 2, W / 2, 1) },
    { name: "Line X", draw: (t) => this.lineX(t) },
    { name: "Lightning1", draw: () => this.lightning(16, true) },
    { name: "Lightning2", draw: () => this.lightning(32, false) },
    { name: "Dot VS", draw: (t) => this.dotV(t, 2) },
    { name: "FireFlies", draw: (t) => this.fireflies(t) },
    { name: "Pete", draw: (t) => this.pete(t, 160) },
    { name: "Dot VS", draw: (t) => this.dotVsSine(t) },
    { name: "Zippy 1", draw: (t) => this.zippy(t, this.zippy1, 1) },
    { name: "Zippy 2", draw: (t) => this.zippy(t, this.zippy2, 0) },
    { name: "Zaph Test", draw: (t) => this.pete(t, 128) }
  ];

  private s(x: number, c: number): number {
    return this.stereo[2 * x + c]!;
  }

  /** table[curtable][i], flat as the C array lay; outside it, 0. */
  private tc(t: number, i: number): number {
    const at = t * 256 + i;
    return at >= 0 && at < this.table.length ? this.table[at]! : 0;
  }

  private vwave(ystart: number, yend: number, x: number, val: number): void {
    if (ystart >= H && yend >= H) {
      ystart -= H;
      yend -= H;
    }
    if (ystart < 0 && yend < 0) {
      ystart += H;
      yend += H;
    }
    ystart = Math.min(Math.max(ystart, 0), H - 1);
    yend = Math.min(Math.max(yend, 0), H - 1);
    x = Math.min(Math.max(x, 0), W - 1);
    const ys = Math.min(ystart, yend);
    const ye = Math.max(ystart, yend);
    for (let y = ys; y <= ye; y += 1) this.b[y * W + x] = val;
  }

  private hwave(xstart: number, xend: number, y: number, val: number): void {
    if (xstart >= W && xend >= W) {
      xstart -= W;
      xend -= W;
    }
    if (xstart < 0 && xend < 0) {
      xstart += W;
      xend += W;
    }
    xstart = Math.min(Math.max(xstart, 0), W - 1);
    xend = Math.min(Math.max(xend, 0), W - 1);
    y = Math.min(Math.max(y, 0), H - 1);
    const xs = Math.min(xstart, xend);
    const xe = Math.max(xstart, xend);
    for (let x = xs; x <= xe; x += 1) this.b[y * W + x] = val;
  }

  /** wave_buff0 (shift 2), wave_buff1 (shift 1): dots along the bottom, left half and right half. */
  private dotH(t: number, shift: number): void {
    for (let x = 0; x < W; x += 1) {
      let temp = this.s(x, 0);
      this.b[(BOTTOM - (temp >> shift) - 20) * W + (x >> 1)] = this.tc(t, temp);
      temp = this.s(x, 1);
      this.b[(BOTTOM - (temp >> shift) - 20) * W + ((x + W) >> 1)] = this.tc(t, temp);
    }
  }

  /** wave_buff2, wave_buff17 (shift 2), wave_buff7 (shift 1): dots down the middle. */
  private dotV(t: number, shift: number): void {
    for (let x = 0; x < BOTTOM; x += 1) {
      let temp = this.s(x, 0);
      this.b[x * W + 160 - (temp >> shift)] = this.tc(t, temp);
      temp = this.s(x, 1);
      this.b[x * W + 160 + (temp >> shift)] = this.tc(t, temp);
    }
  }

  /** wave_buff3: spikes from the bottom, coloured along their length. */
  private spikeS(t: number): void {
    for (let x = 0; x < W; x += 1) {
      let temp = Math.abs(128 - this.s(x, 0)) >> 1;
      for (let i = 0; i < temp; i += 1) this.b[(BOTTOM - i) * W + (x >> 1)] = this.tc(t, i);
      temp = Math.abs(128 - this.s(x, 1)) >> 1;
      for (let i = 0; i < temp; i += 1) this.b[(BOTTOM - i) * W + ((x + W) >> 1)] = this.tc(t, i);
    }
  }

  /** wave_buff4: long spikes, each in one colour. */
  private spikeL(t: number): void {
    for (let x = 0; x < W; x += 1) {
      const temp = Math.abs(128 - this.s(x, 0));
      for (let i = 0; i < temp; i += 1) this.b[(BOTTOM - i) * W + (x >> 1)] = this.tc(t, temp);
    }
    for (let x = 0; x < W; x += 1) {
      const temp = Math.abs(128 - this.s(x, 1));
      for (let i = 0; i < temp; i += 1) this.b[(BOTTOM - i) * W + ((x + W) >> 1)] = this.tc(t, temp);
    }
  }

  /** wave_buff5 (shift 2), wave_buff6 (shift 1): a line along the bottom. */
  private lineH(t: number, shift: number): void {
    let last = 128;
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const temp = this.s(x, y);
        this.vwave(BOTTOM - (temp >> shift), BOTTOM - (last >> shift), y ? (x + W) >> 1 : x >> 1, this.tc(t, temp));
        last = temp;
      }
    }
  }

  /** wave_buff8: hollow spikes. */
  private spike(t: number): void {
    let last = 0;
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const temp = Math.abs(128 - this.s(x, y));
        this.vwave(BOTTOM - temp, BOTTOM - last, y ? (x + W) >> 1 : x >> 1, this.tc(t, temp));
        last = temp;
      }
    }
  }

  /** wave_buff9: the line walking across. */
  private walking(t: number): void {
    let last1 = 128;
    let last2 = 128;
    this.col = (this.col + 1) % W;
    for (let x = 0; x < BOTTOM; x += 1) {
      let temp = this.s(x, 0);
      this.hwave(this.col - (temp >> 2), this.col - (last1 >> 2), x, this.tc(t, temp));
      last1 = temp;
      temp = this.s(x, 1);
      this.hwave(this.col + (temp >> 2), this.col + (last2 >> 2), x, this.tc(t, temp));
      last2 = temp;
    }
  }

  /** wave_buff10: two rows of colours, falling. */
  private falling(t: number): void {
    this.row = (this.row + 1) % (BOTTOM - 1);
    const r = this.row;
    for (let i = 0; i < 160; i += 1) {
      this.b[(r + 1) * W + i] = this.tc(t, this.s(i, 0));
      this.b[(r + 1) * W + i + 160] = this.tc(t, this.s(i, 1));
      this.b[r * W + i] = this.tc(t, this.s(i + 160, 0));
      this.b[r * W + i + 160] = this.tc(t, this.s(i + 160, 1));
    }
  }

  /** wave_buff11 */
  private lissa(t: number): void {
    for (let x = 0; x < W; x += 1) {
      const temp = this.s(x, 0);
      const temp2 = this.s(x, 1);
      this.b[((temp + 200 - 28) % BOTTOM) * W + ((temp2 + 32) % W)] = this.tc(t, temp);
    }
  }

  /** wave_buff12 (shift 2), wave_buff13 (shift 1): lines either side of the middle. */
  private lineV(t: number, leftCentre: number, rightCentre: number, shift: number): void {
    let last1 = 128;
    let last2 = 128;
    for (let x = 0; x < BOTTOM; x += 1) {
      let temp = this.s(x, 0);
      this.hwave(leftCentre - (temp >> shift), leftCentre - (last1 >> shift), x, this.tc(t, temp));
      last1 = temp;
      temp = this.s(x, 1);
      this.hwave(rightCentre + (temp >> shift), rightCentre + (last2 >> shift), x, this.tc(t, temp));
      last2 = temp;
    }
  }

  /** wave_buff14 */
  private lineX(t: number): void {
    let last = 128;
    for (let x = 0; x < BOTTOM; x += 1) {
      const temp = this.s(x, 0);
      this.hwave(160 - (temp >> 2), 160 - (last >> 2), x, this.tc(t, temp));
      last = temp;
    }
    for (let x = 0; x < BOTTOM; x += 1) {
      const temp = this.s(x, 1);
      this.hwave(120 + (temp >> 2), 120 + (last >> 2), x, this.tc(t, temp));
      last = temp;
    }
  }

  /** wave_buff15 (÷16) and wave_buff16 (÷32, its second line without the modulo). */
  private lightning(div: number, wrapSecond: boolean): void {
    let last = 100;
    for (let x = 0; x < BOTTOM; x += 1) {
      let temp = Math.trunc((this.s(x, 0) - 127) / div) + last;
      if (temp >= W) temp = W - 1;
      if (temp < 0) last = 0;
      temp %= W;
      this.hwave(temp, last, x, 255);
      last = temp;
    }
    last = 200;
    for (let x = 0; x < BOTTOM; x += 1) {
      let temp = Math.trunc((this.s(x, 1) - 127) / div) + last;
      if (temp >= W) temp = W - 1;
      if (temp < 0) last = 0;
      if (wrapSecond) temp %= W;
      this.hwave(temp, last, x, 255);
      last = temp;
    }
  }

  /** wave_pete0 */
  private fireflies(t: number): void {
    const o = this.flies;
    o[0] = o[0]! + (this.s(0, 0) % 9) - 4;
    o[1] = o[1]! + (this.s(1, 0) % 9) - 4;
    o[2] = o[2]! + (this.s(0, 1) % 9) - 4;
    o[3] = o[3]! + (this.s(1, 1) % 9) - 4;
    if (o[0]! < 0) o[0] = o[0]! + W;
    if (o[1]! < 0) o[1] = o[1]! + BOTTOM;
    if (o[2]! < 0) o[2] = o[2]! + W;
    if (o[3]! < 0) o[3] = o[3]! + BOTTOM;
    o[0] = o[0]! % W;
    o[2] = o[2]! % W;
    o[1] = o[1]! % H;
    o[3] = o[3]! % H;
    for (let x = 0; x < W; x += 1) {
      let temp = this.s(x, 0);
      let temp2 = this.s((x + 80) % W, 0);
      this.b[(((temp >> 2) + o[1]!) % BOTTOM) * W + (((temp2 >> 2) + o[0]!) % W)] = this.tc(t, temp);
      temp = this.s(x, 1);
      temp2 = this.s((x + 80) % W, 1);
      this.b[(((temp >> 2) + o[3]!) % BOTTOM) * W + (((temp2 >> 2) + o[2]!) % W)] = this.tc(t, temp);
    }
  }

  /** wave_pete1 (÷160) and wave_test, "Zaph Test" (÷128): a sine hump as tall as the level. */
  private pete(t: number, div: number): void {
    let left = 0;
    let right = 0;
    for (let x = 0; x < W; x += 1) {
      left += Math.abs(this.s(x, 0) - 128);
      right += Math.abs(this.s(x, 1) - 128);
    }
    left = Math.min(Math.trunc(left / div), 199);
    right = Math.min(Math.trunc(right / div), 199);
    for (let x = 0; x < 160; x += 1) {
      this.b[(200 - (Math.abs(left * SINE[x]!) >> 8)) * W + x] = this.tc(t, this.s(x, 0));
    }
    for (let x = 160; x < 320; x += 1) {
      this.b[(200 - (Math.abs(right * SINE[x]!) >> 8)) * W + x] = this.tc(t, this.s(x, 1));
    }
  }

  /** wave_pete2 */
  private dotVsSine(t: number): void {
    for (let x = 0; x < 200; x += 1) {
      let temp = this.s(x, 0);
      this.b[x * W + 160 - (temp >> 2)] = this.tc(t, SINE[temp] ?? 0);
      temp = this.s(x, 1);
      this.b[x * W + 160 + (temp >> 2)] = this.tc(t, SINE[temp] ?? 0);
    }
  }

  /** wave_fract1 (shift 1) and wave_fract2 (shift 0): [xoff0, yoff0, xoff1, yoff1]. */
  private zippy(t: number, o: number[], shift: number): void {
    let temp = this.s(0, 0);
    for (let x = 0; x < W - 2; x += 2) {
      o[0] = o[0]! + ((this.s(x, 0) - temp) >> shift);
      temp = this.s(x, 0);
      if (o[0]! < 0) o[0] = W - 1;
      o[0] = o[0]! % W;
      this.b[o[1]! * W + o[0]!] = this.tc(t, temp);
      o[1] = o[1]! + ((this.s(x + 1, 0) - temp) >> shift);
      temp = this.s(x + 1, 0);
      if (o[1]! < 0) o[1] = H - 1;
      o[1] = o[1]! % H;
      this.b[o[1]! * W + o[0]!] = this.tc(t, temp);
    }
    temp = this.s(0, 1);
    for (let x = 0; x < W - 2; x += 2) {
      o[2] = o[2]! + ((this.s(x, 1) - temp) >> shift);
      temp = this.s(x, 1);
      if (o[2]! < 0) o[2] = W - 1;
      o[2] = o[2]! % W;
      this.b[o[3]! * W + o[2]!] = this.tc(t, temp);
      o[3] = o[3]! - ((this.s(x + 1, 1) - temp) >> shift);
      temp = this.s(x + 1, 1);
      if (o[3]! < 0) o[3] = H - 1;
      o[3] = o[3]! % H;
      this.b[o[3]! * W + o[2]!] = this.tc(t, temp);
    }
  }
}
