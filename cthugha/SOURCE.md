# Cthugha ports for "Klasyka retro" (vendor only, never committed)

Five programs live here: Cthugha-L 1.4 (the folder's top level, its OpenGL program in `gl/`),
Cthugha 5.3 for DOS (`dos/`), Cthugha98 0.6a with its 3Dfx build (`c98/`) and the Winamp
plug-in Cthugha-4-Winamp 1.50 (`c4w/`). The first two are ported from their source code; the
last two from their executables, by static analysis only (nothing of them was ever run).
`index.ts` hands the player the scene for a preset of `catalog.ts`; 5.3, Cthugha98 and
Cthugha-4-Winamp are chunks of their own.

## Cthugha-L 1.4

- **Source:** `cthugha-L-1.4.tar.gz` (Cthugha-L 1.4, 16 Jan 1999), from the ibiblio/sunsite mirror
  `pub/linux/apps/sound/lightshow/`.
- **Authors:** Cthugha, Audio Seeded Image Processing, © 1993–1995 Kevin "Zaph" Burfitt, Torps
  Productions. Cthugha-L © 1995–97 Harald Deischinger. Contributors named in the sources: waves
  by Pete, Aaron, Russ and Rus Maxham; translation generators after mkgentable by Zaph and the
  programs of Ofer Faigon (1994); smooth_palette by Stanislav V. Voronyi.
- **Licence:** `COPYING-cthugha-L.txt` (the original COPYING, unchanged). The code may be used in
  other programs non-commercially only, with credit to Cthugha, Torps Productions and Harald
  Deischinger. Commercial use needs permission. Keep this folder out of the repository.
- **What is ported, line by line, to TypeScript:**

  | File | Ported from |
  |---|---|
  | `context.ts` | `CthughaBuffer.cc`, `SoundAnalyze.cc`, `sound_tables.cc`, `imath.cc` |
  | `flames.ts` | `flames.cc` |
  | `waves.ts` | `waves.cc` |
  | `display.ts` | `display.cc`, `CthughaDisplay.cc` |
  | `translate.ts` | `translate.cc`, `tab/cmd_*.c` |
  | `sound.ts` | `SoundDevice.cc`, `SoundProcess.cc` |
  | `engine.ts` | `initExitDisp.cc` `run()`, `AutoChanger.cc`, `CoreOption.cc`, `Flashlight.cc`, `pcx.cc` `show_pcx()` |

  Our own: `index.ts` (the scene for the player) and `catalog.ts`.
- **Generated data:**
  - `palette-data.ts`: `src/initial_palettes.cc` and `map/*.map`, brightened as `load_palettes()` did.
  - `pcx-data.ts`: `pcx/*.pcx.gz`, decoded as `read_pcx()` did.
- **Deliberate changes:**
  - A picture taller than the buffer is centred; `show_pcx()` drew it from the wrong line.
  - A newly chosen table starts from no translation, instead of the last table's leftovers.
  - Silence messages have a drop shadow.
  - A new track shows a picture, standing in for the 'x' key.
  - "@fortune" is left out of the silence strings.

### glcthugha (Cthugha-L's OpenGL program), in `gl/`

| File | Ported from |
|---|---|
| `gl/display.ts` | `GL_display.cc` (the 17 displays, `mesh()`, the cameras), `GL_Light.cc`, `GL_Background.cc`, `GL_Fly.cc`, `CthughaDisplayGL.cc`, `joystick.cc` (the motion without a joystick), `DisplayDeviceGL.cc` (`setPalette()`, `initImages()`, the text) |
| `gl/scene.ts` | `DisplayDeviceGL.cc` sizes, `CthughaBuffer.cc` (up to three buffers), `AutoChanger.cc` |
| `gl/emulator.ts` | our own: the part of OpenGL 1.x and GLU it used (immediate mode, matrix stacks, fixed-function lighting of spot lights, exponential fog, blending), on WebGL 2 |
| `gl/stroke-font.ts` | GLUT's Mono Roman stroke font from freeglut's `fg_stroke_mono_roman.c` (© 1999–2000 Pawel W. Olszta, MIT-style licence, notice kept in the file), converted by `convert_stroke.py` (scratch) |

- The buffers run in `engine.ts`'s buffer mode (no AutoChanger, no 2D display of their own); one
  AutoChanger changes them all and the display, light, background and fly options together.
- As glcthugha ran: buffers of 256 × 256 (`-S 2`), a window of 600 lines (`-D 2`, 800 × 600) as
  wide as the panel's shape asks, colour 0 drawn grey (200, 200, 200) as `setPalette()` did,
  textures filtered linearly ("medium"), pictures with mipmaps, mesh size 32.
- Without a joystick the axes swung with time (`joystick.cc`), so the cameras move by themselves.
- The sphere and the cones are tessellated as Mesa 3's GLU did (its source was not at hand; the
  second cone, of negative height, is drawn, which today's GLU refuses).
- Deliberate changes: the 3D view is drawn on every frame of the panel (the camera's motion, which
  follows time, is smoother), the buffers at their 25 a second; text is only the silence message
  (the interface's menus have no use here).
- References: the author's screenshots on the Cthugha-L homepage (geocities, via the Wayback
  Machine). The newer ones were saved as RGB into TGA files, which are BGR, so their red and blue
  are swapped; the contact sheet shows them put back.

## Cthugha 5.3 (DOS), in `dos/`

- **Source:** the C and assembler source of Cthugha 5.3 (18 Jun 1995), `SOURCES.ZIP` inside
  `CTHUG53.ZIP` on the BURKS CD (Aug 1997); the distribution `cthug53.zip` (Simtel MS-DOS CD,
  Jan 1999) for its README, CTHUGHA.DOC, CTHUGHA.INI, HURR.TAB, ROTATE.TAB, TORUS.PCX and
  ZAPH-93.PCX; the extras `cthug53x.zip` (TEKNO 4-1996 CD) for MAPS.ZIP, PCX.ZIP, TAB.ZIP and
  CTH51DWK.ZIP. All read through discmaster.textfiles.com. No program of them was downloaded
  or run.
- **Authors:** Kevin "Zaph" Burfitt, Digital Aasvogel Group, Torps Productions 1993-1995, with
  Daniel Sachs, Jochen Quante, Ofer Faigon (translation tables HURR, SMOKE, SPACE, SPIR-OUT,
  VORTEX), Volker Muehle (PCX and Kaleidescope), Todd Hedenstrom (the 'chromatic' map).
  "Images and Colors for Cthugha" vol. 1: pictures (c) 1989, 1993-1994 Dmitry Altukhov.
- **Licence:** `COPYING-cthugha-53.txt` (the README's terms, unchanged, and the picture pack's
  legal note). The same terms as Cthugha-L: non-commercial use only, with credit to Cthugha and
  Torps Productions.
- **What is ported to TypeScript:**

  | File | Ported from |
  |---|---|
  | `dos/flames.ts` | the 15 flames of `FLAMES.C`, the inline assembler instruction by instruction (word writes of each pixel pair, the loop counts as written, `divsub[]`) |
  | `dos/waves.ts` | the 24 waves of `MODES.C` and `PETE.C`, in `wavearray[]` order |
  | `dos/engine.ts` | `CTHUGHA.C` `main()` and its change logic, `FLAMES.C` `flame_cro()` and the silence strings, `AUDIO.C` `get_stereo()`, `DISPLAY.C`, `TRANSLAT.C`, `PETE.C` `FFT()`, `MAPS.C`, `SHOWP.C`, Microsoft C's `rand()` |
  | `dos/scene.ts` | our own: 70 frames a second, 320 stereo samples a frame as a Sound Blaster gave them |

  `dos/data.ts` is generated by `convert_cthugha53.py` (scratch): the 8 built-in palettes of
  `MAPS.C`, the 32 map files that `LoadLuts()` accepts, 12 pictures, 6 translation tables and
  the character set of `CHARSET.C`.
- **Deliberate changes** (fomalhaut's list of 5.3's bugs names them too):
  - "Downwards" turns the picture upside down; 5.3 shifted it by a line.
  - Both kaleidoscopes mirror exactly; 5.3 placed the mirrored half a line or a pixel off.
  - The built-in palettes are all converted to the DAC's 6 bits; 5.3 converted the first 85
    colours only.
  - A picture larger than 320 x 200 shows its middle; 5.3 showed its top left corner.
  - The input level follows the music's peaks (a line-in set by hand); the presets other than
    "Cthugha 5.3 (DOS)" keep one display, as `disp-X=off` lines of CTHUGHA.INI would.

## Cthugha98 0.6a and its 3Dfx build, in `c98/`

- **Source:** the owner's copies of the program and the Cthugha 97 data archives, read as bytes
  only (Python under `-I`, MSVC `dumpbin /headers /imports /disasm`); never run, loaded or
  emulated. SHA-256: `cthugha98b06.zip` 1a2d7edd773066831006efa63b652e6736aee2646f291a513249c33127d55f3a
  (Cthugha98.exe, 663 552 bytes, and Cthugha98-3dfx.exe, 675 840 bytes: MSVC 6, MFC, unoptimised),
  `cthugha97map.zip` 6c1c60cf01f7e8f6ec34355e3a7fd1097d748c0d176905000a62fc21ec6c1760,
  `cthugha97pcx.zip` ec8a2a022b81a67728b01e45a34817f5a3916ebfe34a747b79e3894e55d7e431,
  `cthugha97tab.zip` d9016f948f009f28965d7750f09345c0e2eac78ca21d7cbf6c2de47be187b593.
  cthugha97tab.zip is damaged (162 stray bytes inside HURR.TAB's deflate data); ROTATE and
  SPIR-OUT came out of it by their local headers, HURR.TAB is Cthugha 5.3's file, whose CRC-32
  (0x6A8A03D5) is the one the archive records.
- **Author:** Kevin "Zaph" Burfitt, Torps Productions, 1998.
- **Licence:** `COPYING-cthugha98.txt` (the program's own terms: postcardware/CDware, with a
  registered version; Cthugha's source terms: non-commercial use only, with credit).
- **What is ported** (addresses of Cthugha98.exe; every function translated from its machine code):

  | File | From |
  |---|---|
  | `c98/flames.ts` | the 13 flames of `flamearray` (0x479110) in C, at any buffer size (0x40A82E…0x40BBA4), `divsub` (0x408E70) |
  | `c98/waves.ts` | the 28 waves of `wavearray` (0x4794E0: 23 at random, 5 never) and their helpers (0x408F06…0x40A1F0, 0x40CCC0…0x40E89C, 0x41130C…0x41252A) |
  | `c98/specials.ts` | the two particle effects of the special runs (0x40F6C2 swarm, 0x41071B fountain) and their set-up in 0x40F2D0 |
  | `c98/engine.ts` | start-up (0x405E7B, 0x405A1C, 0x4054A3), the main step and change (0x406198), the flame run (0x40A58C), the special run (0x40F2D0), palettes (0x4071A1, 0x40702B), the sound test (0x40C4E2), translate (0x408570), the text (0x40F03C), the 8 displays of `disparray` (0x479828, divisors 0x479928) and the blitter (0x40295D), MSVC `rand()` |
  | `c98/glide.ts` | the 3Dfx build's 3D frame (0x401122: height field 0x401528, points 0x40129B, matrices 0x40200B…0x40262B) and what Glide 2 and the Voodoo did with it, on WebGL 2 |
  | `c98/host.ts`, `c98/scene.ts` | our own: the shared state, and the scenes (2D at 30 frames a second; 3Dfx at its 60) |

  `c98/data.ts` is generated by `convert_c98.py` (scratch): the 8 built-in palettes, the
  character set and the 20 silence strings from the executable, the 65 maps its loader accepts,
  the 4 pictures as its PCX reader left them (shrunk to 320 × 200 and centred by its start-up
  options `-e0 -c`), the 3 tables.
- **Quirks kept** (the program did them): the "FFT" palette flashing is never called; palettes
  change at once; pictures come with the general palette (the PCX reader's palette needs a video
  mode never set); "Kaleidescope" repeats its left half instead of mirroring it; tables are
  stretched over the whole screen whatever the display's buffer; the silence text is turned about
  line 199; the "90deg" displays leave parts of the screen stale; "Left/Right Subtle" equal their
  "Slow" flames. 2D: DirectDraw keeps palette entries 0 and 255 black and white (the palette was
  made without `DDPCAPS_ALLOW256`; the program set 0…254 only). 3Dfx: vertices clamped to the
  screen, the W-buffer's coarse `1/(z + 100)`, the points' centre at (480, 360).
- **Not recovered, so chosen:** the 2D build's frame rate (it had no limit; 30 a second here),
  the sound card's level (a line-in set by hand), the Voodoo's exact rasterisation, dither and
  gamma (after MAME's Voodoo emulation), whether Glide changed the FPU's precision (taken not).
  The keyboard, menus, CD player and on-screen title are left out.
- **Not ported:** Cthugha97 alpha 0.5 (Cthugha97a5.exe, Cthugha97a5-3D.exe), an optimised build of
  an earlier version: its code would need a translation of its own (the 3Dfx notes in scratch list
  how its 3D view differs).
- **References:** torps.com's 3Dfx screenshots (cth3d-1…5, 1998) match the low camera; the top
  view's camera of those screenshots differs from 0.6a's. No capture of the 2D build was found.

## Cthugha-4-Winamp 1.50, in `c4w/`

- **Source:** the owner's copy of the plug-in, read as bytes only (as above): `vis_sh15.zip`
  SHA-256 69b9af912cf3f4abf9605fb1acfd0d2f88db184edaf28d7bb9b414f361a85afe (Plugins/Vis_sh.dll,
  285 184 bytes, MSVC 5, optimised; maps, objs, pics), and `tabgens_src.zip`
  6edf91c956e9f649462e5089fa488784ec27c5783de0b576d4ca316790adbadb (the C++ source of mkspace,
  mkhuricane, mkgentable and mkspiral, no author named).
- **Authors:** Krunoslav Pisacic, 1998; beat detection by Justin Frankel (Nullsoft); the tab
  generators Wintabs.exe by Tom Willaert, Wintab.exe by Simon Werner ("uses ideas from Tom
  Willaert") and TABMAKE.EXE by Kasuha (vis_sh.txt: "Two new tab generator in \tabs by Simon
  Werner and Kasuha"); after Cthugha (Zaph) and Cthugha-L (Harald Deischinger).
- **Licence:** `COPYING-cthugha4winamp.txt` (vis_sh.txt's licence and credits: free for personal
  use; performances and commercial use ask for a payment to the author).
- **What is ported:** all 16 flames, 20 waves and 4 displays of its tables, the render loop
  (0x1000A880) with the beat detection and the random changer (0x1000BCD0), translations (the
  five built-in tables the DLL writes at first start, and optionally the tables of the \tabs
  generators, below), palettes (the 73 maps, VOLCANO.MAP first), the two GIF pictures, the
  3D letters (objs/*.obj) spelling the title at a song's start, the title written on the beat.
  `c4w/data.ts` by `convert_c4w.py` (scratch). Notes with every address in scratch
  (`c4w-port/NOTES.md`).
- **Not recovered, so substituted:** the Windows fonts of the title (Times New Roman, Script,
  Courier New, Arial: the repository's own stroke faces at those fonts' widths), Winamp's
  spectrum maths (the repository's emulation of Winamp's VIS.cpp), the playlist number in the
  window title, the song position when the app knows none.
- **References:** the author's screenshots (shot_1…4, 320 × 240); the frame rate is the module's
  own 25 ms (40 a second).

### The \tabs generators (preset "Tab generators")

`c4w/tabs.ts` `extraTabs()` adds 16 tables, in the order of the programs' dates: mkspace (run
backwards), mkhuricane and mkgentable ported from `tabgens_src.zip`, then the three programs that
came without C source, ported from the programs in `c4w/tabgens.ts`:

| Program | Archive (SHA-256) | File (SHA-256) | Tables (darkening) |
|---|---|---|---|
| Wintabs.exe, Tom Willaert, 8 Jan 1998 | `Wintabs.zip` fba69e1035025fff90c12caf0a1a0265637c892a5d06fc9cf06bcc387eaacbdf | Wintabs.exe 34 521 bytes 1975cf337f9d6fea6fca75cec56f34edab78ad118d94e96acefaded95fced86f; wintabs.bas 4 145 bytes 1722b8e9075b1892df13408b4ce3fc126419dc8a7ad083c4147438d25e4b179c | slidever (4), slidehor (4), fourcorn (8), blocks (32) |
| TABMAKE.EXE, Kasuha, 20 Mar 1998 | `tabmake.zip` 8a2dc89c32d37f8e17913d3d77145253800252f72e0b9ddd67b9ae4a8d1e5c46 | 6 134 bytes 703bad9bb0352ec593a32891fd8859685cb95f7c1f117655a35d2dcd1fe0d468 | smoke (6 + squared distance, 7…127) |
| Wintab.exe, Simon Werner, 24 Mar 1998 | `Wintab.zip` a86ed430463337b8ea51921f8db5737f5df0c0178332d85a774edac71410377b | 61 722 bytes b7fe97711a7350d81c5c47f699e844c80d67270bd2df4904f1261b50b697f537 | slidehor, slidever, corners, squares (6), blocks (10), warp (6), ripple (10), warple (16) |

The same three files are in `vis_sh15.zip`'s tabs folder (same CRC-32s). They are 16-bit DOS
programs, read as bytes only (Python under `-I`: own MZ parsing, capstone's 16-bit disassembly);
none was run, loaded or emulated, and the extracted programs were deleted afterwards.

- **Wintabs.exe:** QuickBASIC 4.5 (BCOM45), packed with Microsoft EXEPACK; unpacked by a Python
  translation of its stub (the packed data ends exactly where the unpacked image starts). The
  compiled code is wintabs.bas: the same four subs, file names, constants and darkenings; its
  `Bind$` overwrites its `x` argument through `VARPTR` (QuickBASIC passes by reference), which
  changes nothing because every caller sets x2 again.
- **Wintab.exe:** Turbo C++ 1.0, small model, with its Turbo Debugger symbol table, which names
  every function and global (`createtab`, `warp`, `ripple`, `centerhole`, `blocks`, `init_blocks`,
  …). The 8087-emulator calls (INT 34h…3Dh) were read as the FPU instructions they stand for.
  Kept as it ran: ripple.tab measures each pixel's distance from the pixel before's result
  (ripple() leaves valx, valy and the distance for the next call; createtab never sets them for
  that table), starting from what warp.tab's last pixel left; on the middle line warp() steps y
  to 241 and keeps the angle of the line above's last pixel; centerhole() sends everything within
  23 of the centre to pixel 0; blocks.tab shuffles the 48 blocks of 80 × 80 with Turbo C's
  `rand()` after `srand(time)` (the scene's seed here).
- **TABMAKE.EXE:** Turbo Pascal 7, packed with WWPACK; unpacked by a Python translation of
  WWPACK's decompressor (stub at the end of the image; all 148 relocations of the unpacked
  program land on its three segment values). "SMOKE.TAB creator by Kasuha": from no
  translation, it swaps the entries of two pixels again and again (each new source within 3
  pixels, 11 for the last 99 joins) until a union-find (the file smoke.rep) holds every pixel in
  one set. `Randomize` is never called, so RandSeed starts at 0 and every run wrote the same
  smoke.tab; the port makes exactly that one (444 764 rounds, 0.2 s).
- **Verification:** for each table, an independent Python reference written from the
  disassembly gives the same file as the port, byte for byte (SHA-256, all 13). Wintab's
  floating point is double here, 80-bit on the x87: no value before a truncation lies within
  1e-9 of an integer (the exact integers come from zero offsets or whole distances, exact in
  both), and the float roundings of the angle and amplitude are exact ties or thousands of ulps
  from one, so the x87 gives the same files. None of these tables is shipped in the owner's
  archives (the only .tab files there are Cthugha 5's HURR, ROTATE and SPIR-OUT, 320 × 204
  words); Cthugha 5's own SMOKE.TAB (Ofer Faigon) is a different table. Sheet:
  `sheet/v2/retro-v4-c4w-tabgens.png` (scratch).
- **Deliberate changes:** Wintab writes slidehor.tab, slidever.tab and blocks.tab too, which in
  one folder would replace Wintabs'; both sets are kept, Wintabs' named "… (Wintabs)". The tables
  are made a little at a time while the scene runs (2 ms a frame; the plug-in loaded tables in a
  thread of its own), or at once when chosen before that. TABMAKE's ESC key is not modelled.
- **Cthugha98:** none of these tables applies: it reads Cthugha 5's 320 × 200 format, not the
  plug-in's 640 × 480 dwords.
