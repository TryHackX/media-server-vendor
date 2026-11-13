/**
 * Cthugha-L 1.4's palettes and pictures, decoded once (src/palettes.cc, src/pcx.cc). Cthugha (c)
 * Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald Deischinger.
 * Non-commercial use only, with credit (COPYING-cthugha-L.txt).
 *
 * The list is in Cthugha-L's order: the built-in palettes, the map files (both brightened as
 * load_palettes() brightened them), then the palette of each picture, added when it was loaded.
 */

import { PALETTES } from "./palette-data";
import { PICTURES } from "./pcx-data";

export interface Picture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /** Its palette's index in the palette list, or −1 for a picture without one. */
  readonly palette: number;
}

function decode(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

let cache: { palettes: { name: string; colours: Uint8Array }[]; pictures: Picture[] } | null = null;

export function library(): { palettes: readonly { name: string; colours: Uint8Array }[]; pictures: readonly Picture[] } {
  if (cache) return cache;
  const palettes = PALETTES.map(([name, data]) => ({ name, colours: decode(data) }));
  const pictures: Picture[] = [];
  for (const [name, width, height, pixels, palette] of PICTURES) {
    let index = -1;
    if (palette) {
      palettes.push({ name, colours: decode(palette) });
      index = palettes.length - 1;
    }
    pictures.push({ name, width, height, pixels: decode(pixels), palette: index });
  }
  cache = { palettes, pictures };
  return cache;
}
