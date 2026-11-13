/**
 * The Cthugha presets of "Klasyka retro" (frontend/scripts/retro-cthugha.mjs lists them; the
 * engine in index.ts is fetched when one is first shown). Their names are the programs' and the
 * displays' own (5.3's disparray[], spelling included, Cthugha-L 1.4's display list,
 * glcthugha's, Cthugha98's and Cthugha-4-Winamp's), so they are not translated.
 *
 * `group` puts a preset under another heading than "Cthugha": the ports of Cthugha98 and
 * Cthugha-4-Winamp take the places of the repository's own recreations of them (the catalog
 * leaves those out when this folder supplies the heading).
 *
 * Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions; Cthugha-L (c) 1995-97 Harald Deischinger;
 * Cthugha-4-Winamp (c) 1998 Krunoslav Pisacic. Non-commercial or personal use only, with credit
 * (COPYING-cthugha-53.txt, COPYING-cthugha-L.txt, SOURCE.md).
 */
export const CTHUGHA_PRESETS: readonly { id: string; name: string; group?: string }[] = [
  { id: "cthugha-53", name: "Cthugha 5.3 (DOS)" },
  { id: "cthugha-53-upwards", name: "Cthugha 5.3 · Upwards" },
  { id: "cthugha-53-kaleidescope", name: "Cthugha 5.3 · Kaleidescope" },
  { id: "cthugha-l", name: "Cthugha-L" },
  { id: "cthugha-l-320x200", name: "Cthugha-L · 320 × 200" },
  { id: "cthugha-l-kaleidoscope", name: "Cthugha-L · Kaleidoscope" },
  { id: "cthugha-l-90kal", name: "Cthugha-L · 90deg Kaleidoscope" },
  { id: "cthugha-l-roll", name: "Cthugha-L · Roll around x-axis" },
  { id: "cthugha-l-heightfield", name: "Cthugha-L · Heightfield" },
  { id: "cthugha-l-bent", name: "Cthugha-L · A bending plane" },
  { id: "cthugha-l-plate", name: "Cthugha-L · A rotating plate" },
  { id: "cthugha-l-gl", name: "glcthugha" },
  { id: "cthugha-l-gl-tube", name: "glcthugha · Simple Tube" },
  { id: "cthugha-l-gl-sheight", name: "glcthugha · Smooth Height" },
  { id: "cthugha-l-gl-nearring", name: "glcthugha · Almost a Ring" },
  { id: "cthugha-l-gl-2planes", name: "glcthugha · 2Planes" },
  { id: "cthugha-l-gl-cross", name: "glcthugha · Cross" },
  { id: "c98-auto", name: "Cthugha98", group: "cthugha98" },
  { id: "c98-kaleido", name: "Cthugha98 · Kaleidescope", group: "cthugha98" },
  { id: "c98-3dfx", name: "Cthugha98 3Dfx", group: "cthugha98" },
  { id: "c98-3dfx-low", name: "Cthugha98 3Dfx · Downwards", group: "cthugha98" },
  { id: "c4w-auto", name: "Cthugha-4-Winamp", group: "c4w" },
  { id: "c4w-quad", name: "Cthugha-4-Winamp · Kaleidoscope 2x2", group: "c4w" },
  { id: "c4w-mirror", name: "Cthugha-4-Winamp · Weidth 2x1", group: "c4w" },
  { id: "c4w-analyzer", name: "Cthugha-4-Winamp · Analyzer", group: "c4w" },
  { id: "c4w-320", name: "Cthugha-4-Winamp · 320 × 240", group: "c4w" },
  { id: "c4w-tabs", name: "Cthugha-4-Winamp · Tab generators", group: "c4w" }
];
