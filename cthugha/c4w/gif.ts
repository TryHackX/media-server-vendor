/**
 * Cthugha-4-Winamp 1.50 (c) 1998 Krunoslav Pisacic; based on Cthugha by Kevin "Zaph" Burfitt and
 * Cthugha-L by Harald Deischinger; free for personal use (vis_sh.txt); never committed.
 *
 * The plug-in read its pictures (pics\*.gif) through gbm.dll; this is a plain GIF reader in its
 * place: the first image of a GIF87a/89a file, its palette indices top to bottom (interlacing
 * undone) and its colour table, which is what the plug-in used of them (8-bit pictures only).
 */

export interface GifImage {
  width: number;
  height: number;
  /** One palette index per pixel, rows top to bottom. */
  pixels: Uint8Array;
  /** 256 × r, g, b (0…255); entries past the file's table are 0. */
  palette: Uint8Array;
  /** Bits per pixel of the colour table (gbm read 8-bit GIFs only). */
  bits: number;
}

export function decodeGif(bytes: Uint8Array): GifImage | null {
  if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  const u16 = (at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
  let at = 6;
  const flags = bytes[at + 4]!;
  at += 7;
  const palette = new Uint8Array(768);
  let bits = (flags & 7) + 1;
  if (flags & 0x80) {
    const size = 3 << ((flags & 7) + 1);
    palette.set(bytes.subarray(at, at + size));
    at += size;
  }
  while (at < bytes.length) {
    const block = bytes[at++]!;
    if (block === 0x21) {
      at += 1;
      for (let size = bytes[at++]!; size; size = bytes[at++]!) at += size;
      continue;
    }
    if (block !== 0x2c) return null;
    const width = u16(at + 4);
    const height = u16(at + 6);
    const local = bytes[at + 8]!;
    at += 9;
    if (local & 0x80) {
      const size = 3 << ((local & 7) + 1);
      palette.fill(0);
      palette.set(bytes.subarray(at, at + size));
      bits = (local & 7) + 1;
      at += size;
    }
    const interlaced = (local & 0x40) !== 0;
    const minimum = bytes[at++]!;
    // The image's data sub-blocks, joined.
    let length = 0;
    for (let p = at, size = bytes[p]!; size; p += size + 1, size = bytes[p]!) length += size;
    const data = new Uint8Array(length);
    for (let p = at, size = bytes[p]!, put = 0; size; p += size + 1, size = bytes[p]!) {
      data.set(bytes.subarray(p + 1, p + 1 + size), put);
      put += size;
    }
    const linear = lzw(data, minimum, width * height);
    const pixels = new Uint8Array(width * height);
    if (interlaced) {
      let row = 0;
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) {
        for (let y = start; y < height; y += step) {
          pixels.set(linear.subarray(row * width, (row + 1) * width), y * width);
          row += 1;
        }
      }
    } else {
      pixels.set(linear);
    }
    return { width, height, pixels, palette, bits };
  }
  return null;
}

/** GIF's variable-length LZW, `count` indices out. */
function lzw(data: Uint8Array, minimum: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minimum;
  const end = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i += 1) {
    suffix[i] = i;
    first[i] = i;
    prefix[i] = -1;
  }
  let size = minimum + 1;
  let next = end + 1;
  let previous = -1;
  let bitBuffer = 0;
  let bitCount = 0;
  let put = 0;
  let p = 0;
  while (put < count) {
    while (bitCount < size && p < data.length) {
      bitBuffer |= data[p++]! << bitCount;
      bitCount += 8;
    }
    if (bitCount < size) break;
    const code = bitBuffer & ((1 << size) - 1);
    bitBuffer >>>= size;
    bitCount -= size;
    if (code === clear) {
      size = minimum + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    let depth = 0;
    let walk: number;
    if (previous < 0) {
      out[put++] = suffix[code]!;
      previous = code;
      continue;
    }
    if (code < next) {
      walk = code;
    } else {
      // KwKwK: the previous string plus its own first byte.
      stack[depth++] = first[previous]!;
      walk = previous;
    }
    while (walk >= 0 && depth < stack.length) {
      stack[depth++] = suffix[walk]!;
      walk = prefix[walk]!;
    }
    if (next < 4096) {
      prefix[next] = previous;
      suffix[next] = code < next ? first[code]! : first[previous]!;
      first[next] = first[previous]!;
      next += 1;
      if (next === 1 << size && size < 12) size += 1;
    }
    while (depth > 0 && put < count) out[put++] = stack[--depth]!;
    previous = code;
  }
  return out;
}
