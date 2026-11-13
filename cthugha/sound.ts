/**
 * Cthugha-L 1.4's sound input and sound processes (src/SoundDevice.cc, src/SoundProcess.cc).
 * Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald
 * Deischinger. Non-commercial use only, with credit (COPYING-cthugha-L.txt).
 *
 * Cthugha-L read the sound card as 16-bit samples and kept the high byte of each: the newest
 * 1024 stereo samples, signed 8-bit. A sound process then makes dataProc from them, which most
 * waves draw: the samples as they are, two smoothing filters, or their FFT — whose integers
 * wrap in a char, so the spectrum comes out as a sparkle of noise.
 */

import type { SoundData } from "./context";

/**
 * The newest 1024 samples of each channel (−1…1) as SoundDevice::convert left them: the high
 * byte of a 16-bit sample, [i][1] the left channel and [i][0] the right. `gain` is the input level.
 */
export function readSound(sound: SoundData, left: Float32Array, right: Float32Array, gain: number): void {
  const data = sound.data;
  const from = left.length - 1024;
  for (let i = 0; i < 1024; i += 1) {
    const l = Math.floor((left[from + i] ?? 0) * gain * 128);
    const r = Math.floor((right[from + i] ?? 0) * gain * 128);
    data[2 * i] = r < -128 ? -128 : r > 127 ? 127 : r;
    data[2 * i + 1] = l < -128 ? -128 : l > 127 ? 127 : l;
  }
}

function none(sound: SoundData): void {
  sound.proc.set(sound.data);
}

/** Massage1 ("Filter1"): no sample more than 10 from the one before. */
function filter1(sound: SoundData): void {
  const proc = sound.proc;
  proc.set(sound.data);
  let temp = proc[1]!;
  let temp2 = proc[0]!;
  for (let x = 1; x < 1024; x += 1) {
    const l = 2 * x + 1;
    const r = 2 * x;
    if (proc[l]! - temp > 10) proc[l] = temp + 10;
    else if (proc[l]! - temp < -10) proc[l] = temp - 10;
    if (proc[r]! - temp2 > 10) proc[r] = temp2 + 10;
    else if (proc[r]! - temp2 < -10) proc[r] = temp2 - 10;
    temp = proc[l]!;
    temp2 = proc[r]!;
  }
}

/** Massage2 ("Filter2", a low pass filter): each sample a sixteenth of the way to the input. */
function filter2(sound: SoundData): void {
  const proc = sound.proc;
  const data = sound.data;
  let temp = data[1]!;
  let temp2 = data[0]!;
  for (let x = 1; x < 1024; x += 1) {
    proc[2 * x + 1] = proc[2 * x - 1]! + Math.trunc((data[2 * x + 1]! - temp) / 16);
    proc[2 * x] = proc[2 * x - 2]! + Math.trunc((data[2 * x]! - temp2) / 16);
    temp2 = proc[2 * x]!;
    temp = proc[2 * x + 1]!;
  }
}

const N = 1024;
const wpRe = new Float64Array(N);
const wpIm = new Float64Array(N);
const reverse = new Int32Array(N);
for (let i = 0; i < N; i += 1) {
  wpRe[i] = Math.cos((2 * Math.PI / N) * i);
  wpIm[i] = Math.sin((2 * Math.PI / N) * i);
  let r = 0;
  let k = i;
  for (let n = N; n > 1; n >>= 1) {
    r = (r << 1) | (k & 1);
    k >>= 1;
  }
  reverse[i] = r;
}
const re = new Float64Array(N);
const im = new Float64Array(N);

/**
 * FFT (from Akl, The Design and Analysis of Parallel Algorithms, p. 244, as Cthugha-L had it):
 * right channel as the real part, left as the imaginary; eleven passes, the last of which (p = 0)
 * doubles every value; scaled by 2/√1024 into chars, which wrap.
 */
function fft(sound: SoundData): void {
  const data = sound.data;
  for (let k = 0; k < N; k += 1) {
    re[k] = data[2 * k]!;
    im[k] = data[2 * k + 1]!;
  }
  let p = N / 2;
  let z = 1;
  for (let h = N; h !== 0; h >>= 1) {
    let zp = 0;
    for (let k = 0; k < N; k += 1) {
      if ((k & p) === 0) {
        const tr = re[k]! + re[k + p]!;
        const ti = im[k]! + im[k + p]!;
        const dr = re[k]! - re[k + p]!;
        const di = im[k]! - im[k + p]!;
        re[k + p] = dr * wpRe[zp]! - di * wpIm[zp]!;
        im[k + p] = dr * wpIm[zp]! + di * wpRe[zp]!;
        re[k] = tr;
        im[k] = ti;
      }
      zp = (zp + z) % N;
    }
    p >>= 1;
    z *= 2;
  }
  const a = 2 / Math.sqrt(N);
  const proc = sound.proc;
  for (let k = 0; k < N; k += 1) {
    // int(), then stored in a char: the low eight bits.
    proc[2 * reverse[k]!] = Math.trunc(re[k]! * a);
    proc[2 * reverse[k]! + 1] = Math.trunc(im[k]! * a);
  }
}

export const SOUND_PROCESSES: readonly { name: string; run(sound: SoundData): void }[] = [
  { name: "none", run: none },
  { name: "Filter1", run: filter1 },
  { name: "Filter2", run: filter2 },
  { name: "FFT", run: fft }
];
