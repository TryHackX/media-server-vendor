/**
 * Trans: Normalise — normalise.ape (sha256 1a306a4fa835a4c259a8557777fa3f8d54d936cc9778969c20816a8e5521853f),
 * port by static reading of the binary (notes: scratch/avs-reference/apes/normalise.md).
 *
 * Config: one int, enabled (a shorter config keeps the default, on).
 * Render (in place, returns 0): one minimum and maximum over the blue, green and red bytes of the
 * frame, scanned in pixel pairs (with an odd pixel count the last pixel is not scanned); then for
 * every pixel and channel c: ((max(c − min, 0) · ⌊0xFFFF / (max − min)⌋) & 0xFFFF) >> 8 (MMX psubusb,
 * pmullw, psrlw), the top byte 0. A frame of one value turns black (the scale is 0).
 *
 * The engine carries grandchild/vis_avs's re-implementation (float table); this port replaces it.
 */

export interface ApeContext {
  readonly w: number;
  readonly h: number;
}

export interface ApeEffect {
  render(ctx: ApeContext, framebuffer: Int32Array, fbout: Int32Array): number;
}

export function parseConfig(config: Uint8Array): { enabled: boolean } {
  if (config.length >= 4) {
    const value = config[0]! | (config[1]! << 8) | (config[2]! << 16) | (config[3]! << 24);
    return { enabled: value !== 0 };
  }
  return { enabled: true };
}

/** One frame of the binary's arithmetic. */
export function normalise(framebuffer: Int32Array, pixels: number): void {
  let max = 0;
  let min = 255;
  const scanned = (pixels >> 1) * 2;
  for (let i = 0; i < scanned; i++) {
    const p = framebuffer[i]!;
    const b = p & 255;
    const g = (p >>> 8) & 255;
    const r = (p >>> 16) & 255;
    if (b > max) max = b;
    if (g > max) max = g;
    if (r > max) max = r;
    if (b < min) min = b;
    if (g < min) min = g;
    if (r < min) min = r;
  }
  const scale = max !== min ? Math.floor(0xffff / (max - min)) : 0;
  const channel = (c: number) => {
    const t = c > min ? c - min : 0;
    return (Math.imul(t, scale) & 0xffff) >>> 8;
  };
  for (let i = 0; i < pixels; i++) {
    const p = framebuffer[i]!;
    framebuffer[i] = (channel((p >>> 16) & 255) << 16) | (channel((p >>> 8) & 255) << 8) | channel(p & 255);
  }
}

export const ape = {
  id: "Trans: Normalise",
  sha256: ["1a306a4fa835a4c259a8557777fa3f8d54d936cc9778969c20816a8e5521853f"],
  create(config: Uint8Array): ApeEffect {
    const { enabled } = parseConfig(config);
    return {
      render(ctx, framebuffer) {
        if (enabled) normalise(framebuffer, ctx.w * ctx.h);
        return 0;
      },
    };
  },
};
