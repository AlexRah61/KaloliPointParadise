import { getImage } from 'astro:assets';
import type { MediaItem } from '../data/media';

// Candidate widths; anything above the source width is dropped, so images are never upscaled.
export const WIDTHS = [480, 640, 828, 1080, 1280, 1600, 2048, 2560, 3200, 3840];

// Per-format quality tuned for foliage-heavy photography (AVIF and WebP scales differ).
export const QUALITY = {
  photo: { avif: 64, webp: 84, jpg: 84 },
  plan: { avif: 80, webp: 92, jpg: 90 },
} as const;

export function widthsFor(srcWidth: number, max = Infinity): number[] {
  const cap = Math.min(srcWidth, max);
  return [...new Set([...WIDTHS.filter((w) => w < cap), cap])];
}

export interface ResponsiveSet {
  avif: string;
  webp: string;
  fallback: string;
  width: number;
  height: number;
}

export async function responsive(item: MediaItem, maxWidth = Infinity): Promise<ResponsiveSet> {
  const { src } = item;
  const q = item.source === 'floor-plan' ? QUALITY.plan : QUALITY.photo;
  const widths = widthsFor(src.width, maxWidth);
  const top = widths[widths.length - 1]!;
  const [avif, webp, jpg] = await Promise.all([
    getImage({ src, widths, format: 'avif', quality: q.avif }),
    getImage({ src, widths, format: 'webp', quality: q.webp }),
    getImage({ src, width: Math.min(1600, top), format: 'jpg', quality: q.jpg }),
  ]);
  return {
    avif: avif.srcSet.attribute,
    webp: webp.srcSet.attribute,
    fallback: jpg.src,
    width: src.width,
    height: src.height,
  };
}

export interface LightboxData {
  href: string;
  srcset: string;
  width: number;
  height: number;
}

// Full-resolution WebP for the lightbox (universally supported, loaded only on demand).
export async function lightbox(item: MediaItem): Promise<LightboxData> {
  const { src } = item;
  const q = item.source === 'floor-plan' ? QUALITY.plan : QUALITY.photo;
  const widths = widthsFor(src.width);
  const [full, set] = await Promise.all([
    getImage({ src, width: src.width, format: 'webp', quality: q.webp }),
    getImage({ src, widths, format: 'webp', quality: q.webp }),
  ]);
  return { href: full.src, srcset: set.srcSet.attribute, width: src.width, height: src.height };
}
