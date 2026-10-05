// One-off: rasterises the octagon mark into favicons + web manifest. node tools/gen-icons.mjs
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const svg = (pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${pad ? 0 : 12}" fill="#151815"/>
  <g fill="none" stroke="#c6a77b" stroke-linejoin="round" transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})">
    <path d="M24.2 11h15.6l11.2 11.2v15.6L39.8 49H24.2L13 37.8V22.2z" stroke-width="2.6" transform="translate(0 2)"/>
    <path d="M27.4 23h9.2l6.6 6.6v9.2l-6.6 6.6h-9.2l-6.6-6.6v-9.2z" stroke-width="2" opacity="0.6" transform="translate(0 -2.2)"/>
  </g>
</svg>`;

writeFileSync(join(PUB, 'favicon.svg'), svg());
await sharp(Buffer.from(svg())).resize(32, 32).png().toFile(join(PUB, 'favicon-32.png'));
await sharp(Buffer.from(svg(6))).resize(180, 180).png().toFile(join(PUB, 'apple-touch-icon.png'));
await sharp(Buffer.from(svg(6))).resize(192, 192).png().toFile(join(PUB, 'icon-192.png'));
await sharp(Buffer.from(svg(10))).resize(512, 512).png().toFile(join(PUB, 'icon-512.png'));
writeFileSync(
  join(PUB, 'site.webmanifest'),
  JSON.stringify(
    {
      name: '15–1077 Amau Rd · Kaloli Point Residence',
      short_name: 'Amau Rd',
      start_url: '/',
      display: 'browser',
      background_color: '#151815',
      theme_color: '#151815',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    null,
    2,
  ),
);
console.log('icons written');
