// Derives web media from the original paid assets. Originals in assets/ are only ever read.
//   node tools/build-media.mjs            -> stills (fast) + video if outputs are missing
//   node tools/build-media.mjs --force    -> re-encode everything
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The 4K edit feeds the hero loop and gallery stills; the final 1080p cut is the film visitors play.
const SOURCE = join(ROOT, 'assets', '15-1077AmauRd_VideoEdit.mov');
const FILM = join(ROOT, 'assets', '15-1077 AMAU RD, KEAAU - Video.mp4');
// Versioned so cached playlists and segments of an earlier cut are never mixed with this one.
const FILM_DIR = join(ROOT, 'public', 'media', 'film', 'v2');
const STILLS_DIR = join(ROOT, 'src', 'assets', 'derived');
const force = process.argv.includes('--force');

function ffmpeg(args, label, cwd = ROOT) {
  const t0 = Date.now();
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit', cwd });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${label}`);
  console.log(`  ✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

function probe(file) {
  const { stderr } = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  const v = /Video: .*?, (\d{3,5})x(\d{3,5})/.exec(stderr);
  if (!d || !v) throw new Error(`could not read ${file}`);
  return { seconds: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), width: Number(v[1]), height: Number(v[2]) };
}

// Real frames from the paid films. Sky-replaced moments (~29.6s, ~45.6s of the edit) are deliberately excluded.
// film-citrus.jpg (48.3 s of the edit) has a lizard retouched out, so it is kept as committed and never regenerated.
const STILLS = [
  { file: 'film-poster-v2.jpg', t: 1.6, src: FILM, note: 'The residence from the air, opening of the final cut (film poster)' },
  { file: 'film-stair-light.jpg', t: 16.2, note: 'Stair with step light linking the levels' },
];

mkdirSync(STILLS_DIR, { recursive: true });
console.log('Stills from film');
for (const s of STILLS) {
  const out = join(STILLS_DIR, s.file);
  if (!force && existsSync(out)) continue;
  ffmpeg(['-ss', String(s.t), '-i', s.src ?? SOURCE, '-frames:v', '1', '-q:v', '2', out], `${s.file} @ ${s.t}s`);
}

// Floor plans: CubiCasa canvases are ~45% whitespace. Crop to the drawing (dark pixels only, so the
// light-grey credit line is excluded and restated on the page instead) and save lossless.
const PLAN_DIRS = ['Floor Plan Without Dimensions', 'Floor Plan With Dimensions'];
const PLANS_OUT = join(STILLS_DIR, 'plans');
mkdirSync(PLANS_OUT, { recursive: true });
console.log('Floor plans');
for (const dir of PLAN_DIRS) {
  for (const f of readdirSync(join(ROOT, 'assets', dir)).filter((n) => n.endsWith('.jpg'))) {
    const out = join(PLANS_OUT, f.replace(/\.jpg$/, '.png'));
    if (!force && existsSync(out)) continue;
    const src = join(ROOT, 'assets', dir, f);
    const { data, info } = await sharp(src).greyscale().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[y * info.width + x] < 100) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
    const left = Math.max(0, minX - pad);
    const top = Math.max(0, minY - pad);
    const width = Math.min(info.width - left, maxX - minX + 2 * pad);
    const height = Math.min(info.height - top, maxY - minY + 2 * pad);
    await sharp(src).extract({ left, top, width, height }).png({ compressionLevel: 9 }).toFile(out);
    console.log(`  ✓ ${f} -> ${width}x${height}`);
  }
}

// Owner phone photos (garden fruit + Kaloli Point coast): auto-orient, cap at 4000px, strip EXIF/GPS.
// IMG_4741 is excluded: its GPS places it on Oʻahu's North Shore, not Kaloli Point.
const OWNER_DIR = join(ROOT, 'assets', 'Photos', 'Fruit and ocean photos');
const OWNER_OUT = join(STILLS_DIR, 'owner');
const OWNER = {
  'IMG_5203.jpeg': 'garden-coconuts.jpg',
  'IMG_5229.jpeg': 'garden-lilikoi.jpg',
  'IMG_5231.jpeg': 'garden-papaya.jpg',
  'IMG_5216.jpeg': 'garden-raised-beds.jpg',
  'IMG_5186.JPG': 'lanai-rainbow.jpg',
  'unnamed.jpg': 'kaloli-lookout.jpg',
  'IMG_3998.jpeg': 'kaloli-honu-lava.jpg',
  'IMG_8217.jpeg': 'kaloli-honu-shore.jpg',
};
if (existsSync(OWNER_DIR)) {
  mkdirSync(OWNER_OUT, { recursive: true });
  console.log('Owner photos');
  for (const [file, name] of Object.entries(OWNER)) {
    const src = join(OWNER_DIR, file);
    const out = join(OWNER_OUT, name);
    if (!existsSync(src) || (!force && existsSync(out))) continue;
    const info = await sharp(src)
      .rotate()
      .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(out);
    console.log(`  ✓ ${file} -> ${name} ${info.width}x${info.height}`);
  }
}

// HLS ladder. 4 s GOPs aligned across renditions so the player can switch cleanly. Rungs above the film's own
// resolution are skipped (never upscaled).
const LADDER = [
  { name: '2160p', w: 3840, h: 2160, crf: 20, maxrate: 18000, level: '5.1', codec: 'avc1.640033' },
  { name: '1440p', w: 2560, h: 1440, crf: 20, maxrate: 9000, level: '5.0', codec: 'avc1.640032' },
  { name: '1080p', w: 1920, h: 1080, crf: 21, maxrate: 6000, level: '4.1', codec: 'avc1.640029' },
  { name: '720p', w: 1280, h: 720, crf: 22, maxrate: 3200, level: '3.1', codec: 'avc1.64001f' },
  { name: '480p', w: 854, h: 480, crf: 23, maxrate: 1400, level: '3.0', codec: 'avc1.64001e' },
];
const GOP = ['-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-x264-params', 'scenecut=0:open_gop=0'];
const master = join(FILM_DIR, 'master.m3u8');
const film = probe(FILM);

console.log(`HLS film ladder (${film.width}x${film.height}, ${film.seconds.toFixed(2)} s)`);
if (force) rmSync(FILM_DIR, { recursive: true, force: true });
const variants = [];
for (const r of LADDER.filter((l) => l.h <= film.height)) {
  const dir = join(FILM_DIR, r.name);
  if (force || !existsSync(join(dir, 'init.mp4')) || !existsSync(join(dir, 'index.m3u8'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    ffmpeg([
      '-i', FILM,
      '-vf', `scale=${r.w}:${r.h}:flags=lanczos,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', r.level,
      '-crf', String(r.crf), '-maxrate', `${r.maxrate}k`, '-bufsize', `${r.maxrate * 2}k`, ...GOP,
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
      // ffmpeg writes the fMP4 init file relative to the CWD, so encode from inside the rendition folder.
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', 'seg_%03d.m4s',
      'index.m3u8',
    ], `HLS ${r.name}`, dir);
    if (!existsSync(join(dir, 'init.mp4'))) throw new Error(`missing init.mp4 for ${r.name}`);
  }
  const segs = readdirSync(dir).filter((f) => f.endsWith('.m4s'));
  const peak = Math.max(...segs.map((f) => statSync(join(dir, f)).size));
  const total = segs.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  variants.push({ ...r, peakBps: Math.ceil((peak * 8) / 4), avgBps: Math.ceil((total * 8) / film.seconds) });
}
const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
for (const v of variants) {
  lines.push(
    `#EXT-X-STREAM-INF:BANDWIDTH=${v.peakBps},AVERAGE-BANDWIDTH=${v.avgBps},RESOLUTION=${v.w}x${v.h},FRAME-RATE=30.000,CODECS="${v.codec},mp4a.40.2"`,
    `${v.name}/index.m3u8`,
  );
}
writeFileSync(master, lines.join('\n') + '\n');
console.log('  ✓ master.m3u8', variants.map((v) => `${v.name}:${(v.avgBps / 1e6).toFixed(2)}Mbps`).join(' '));

// Progressive fallback for browsers with neither native HLS nor MSE (must stay under 25 MiB per asset).
const fallback = join(FILM_DIR, 'film-1080p.mp4');
if (force || !existsSync(fallback)) {
  ffmpeg([
    '-i', FILM, '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', '22', '-maxrate', '3000k', '-bufsize', '6000k',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', fallback,
  ], 'MP4 fallback 1080p');
}

// Hero loop: an eight-beat trailer of authentic film moments, slowed with motion interpolation, cross-dissolved,
// ending on the owners' sunset photograph and closed on itself so the loop has no seam. Never the master itself;
// silent; sky-replaced frames (~29.0-30.0 s, ~45.3-46.6 s) stay out. `x` is the horizontal focal point for the
// portrait phone crop. Beat labels and their start times are written to src/data/hero-beats.json.
const HERO_DIR = join(ROOT, 'public', 'media', 'hero');
const HERO_VERSION = 'v2';
const HERO_BEATS = [
  { label: 'Life at Kaloli Point', from: 54.15, to: 55.75, slow: 1.5, x: 0.5, note: 'Over Kaloli Point to the Pacific' },
  { label: 'Three levels', from: 1.9, to: 2.5, slow: 2.8, x: 0.42, note: 'The three-level residence from the air' },
  { label: 'Three lanais', from: 44.5, to: 45.25, slow: 2.6, x: 0.5, note: 'All three lanai levels from the lawn' },
  { label: 'Three lanais', from: 26.6, to: 27.4, slow: 2.4, x: 0.42, note: 'Along the upper wraparound lanai' },
  { label: 'Garden level', from: 9.3, to: 10.05, slow: 2.6, x: 0.36, note: 'Garden living room open to the covered lanai' },
  { label: 'Living level', from: 20.05, to: 21.3, slow: 1.6, x: 0.38, note: 'Kitchen and waterfall-edge island' },
  { label: 'Primary retreat', from: 30.35, to: 31.1, slow: 2.6, x: 0.66, note: 'Primary bedroom wrapped in windows' },
  { label: 'The half acre', from: 38.9, to: 39.65, slow: 2.6, x: 0.32, note: 'Over the walled lawn and planted borders' },
  { label: 'Island evenings', still: 'assets-listing/listing-sunset-house.jpg', seconds: 2.8, x: 0.56, y: 0.42, zoom: 0.06, note: 'Sunset over the house (owner photograph)' },
];
const HERO_FADE = 0.6;
const HERO_VARIANTS = [
  // 1600x900: a 13 s loop at 1080p would cost ~5 MB; this keeps it under 4 MB with fewer compression artefacts.
  { name: 'wide', w: 1600, h: 900, crf: 26, maxrate: 3000 },
  { name: 'tall', w: 864, h: 1080, crf: 26, maxrate: 1800 },
];

// A still becomes a slow push-in: crop to the output shape around the focal point, upscale 3x so zoompan's
// whole-pixel steps are invisible, then zoom by `zoom` over the beat.
async function stillFilter(b, v) {
  const { width: iw, height: ih } = await sharp(join(ROOT, b.still)).metadata();
  const aspect = v.w / v.h;
  const cw = Math.min(iw, Math.round(ih * aspect));
  const ch = Math.round(cw / aspect);
  const cx = Math.round(Math.min(Math.max(b.x * iw - cw / 2, 0), iw - cw));
  const cy = Math.round(Math.min(Math.max(b.y * ih - ch / 2, 0), ih - ch));
  const frames = Math.round(b.seconds * 30);
  return `crop=${cw}:${ch}:${cx}:${cy},scale=${v.w * 3}:${v.h * 3}:flags=lanczos,` +
    `zoompan=z='1+${b.zoom}*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${v.w}x${v.h}:fps=30,format=yuv420p`;
}

mkdirSync(HERO_DIR, { recursive: true });
console.log('Hero loop');
for (const v of HERO_VARIANTS) {
  const out = join(HERO_DIR, `hero-${v.name}-${HERO_VERSION}.mp4`);
  if (!force && existsSync(out)) continue;
  const tmp = join(HERO_DIR, `.tmp-${v.name}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const lengths = [];
  for (const [i, b] of HERO_BEATS.entries()) {
    const seg = join(tmp, `m${i}.mp4`);
    if (b.still) {
      const frames = Math.round(b.seconds * 30);
      ffmpeg([
        '-loop', '1', '-framerate', '30', '-t', String(b.seconds), '-i', join(ROOT, b.still), '-an',
        '-vf', await stillFilter(b, v), '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', seg,
      ], `hero ${v.name} beat ${i + 1}: ${b.note}`);
      lengths.push(frames / 30);
      continue;
    }
    // Portrait: a 4:5 window of the 3840x2160 master centred on the subject.
    const crop = v.name === 'tall' ? `crop=1728:2160:${Math.round(Math.min(Math.max(b.x * 3840 - 864, 0), 3840 - 1728))}:0,` : '';
    ffmpeg([
      '-ss', String(b.from), '-t', String(b.to - b.from), '-i', SOURCE, '-an',
      '-vf', `${crop}scale=${v.w}:${v.h}:flags=lanczos,minterpolate=fps=${Math.round(30 * b.slow)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,setpts=${b.slow}*PTS,fps=30,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', seg,
    ], `hero ${v.name} beat ${i + 1}: ${b.note}`);
    lengths.push(Math.round((b.to - b.from) * b.slow * 30) / 30);
  }
  // m0 … m8 m0 cross-dissolved, then trimmed to start and end inside m0 at the same frame: a seamless loop.
  const inputs = [...HERO_BEATS.keys(), 0].flatMap((i) => ['-i', join(tmp, `m${i}.mp4`)]);
  const seq = [...lengths, lengths[0]];
  let chain = '';
  let prev = '[0:v]';
  let offset = 0;
  const starts = [0];
  for (let i = 1; i < seq.length; i++) {
    offset += seq[i - 1] - HERO_FADE;
    // Labels change halfway through each dissolve, on the trimmed timeline.
    starts.push(offset - HERO_FADE / 2);
    const label = `[x${i}]`;
    chain += `${prev}[${i}:v]xfade=transition=fade:duration=${HERO_FADE}:offset=${offset.toFixed(3)}${label};`;
    prev = label;
  }
  const end = offset + HERO_FADE;
  chain += `${prev}trim=start=${HERO_FADE}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[out]`;
  ffmpeg([
    ...inputs, '-filter_complex', chain, '-map', '[out]', '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', String(v.crf),
    '-maxrate', `${v.maxrate}k`, '-bufsize', `${v.maxrate * 2}k`, '-g', '60', '-movflags', '+faststart', out,
  ], `hero-${v.name}-${HERO_VERSION}.mp4 (${(end - HERO_FADE).toFixed(1)} s)`);
  rmSync(tmp, { recursive: true, force: true });
  if (v.name === 'wide') {
    const names = [...new Set(HERO_BEATS.map((b) => b.label))];
    const beats = starts
      .map((t, i) => ({ t: Math.round(Math.max(t, 0) * 100) / 100, label: HERO_BEATS[i % HERO_BEATS.length].label }))
      .filter((b, i, all) => i === 0 || b.label !== all[i - 1].label)
      .map((b) => ({ ...b, n: names.indexOf(b.label) + 1 }));
    writeFileSync(
      join(ROOT, 'src', 'data', 'hero-beats.json'),
      JSON.stringify({ version: HERO_VERSION, duration: Math.round((end - HERO_FADE) * 100) / 100, count: names.length, beats }, null, 2) + '\n',
    );
    console.log(`  ✓ hero-beats.json (${beats.length} label changes)`);
  }
}

// Portrait phones: a square crop of the hero photograph centred on the house, so the first paint downloads
// a phone-sized file instead of the full 16:9 frame.
const HERO_PHONE = join(STILLS_DIR, 'hero-phone.jpg');
if (force || !existsSync(HERO_PHONE)) {
  const src = join(ROOT, 'assets', 'Photos', 'DJI_20261001133743_0632_D.jpg');
  const { width, height } = await sharp(src).metadata();
  const side = Math.min(width, height);
  await sharp(src)
    .extract({ left: Math.round((width - side) / 2), top: Math.round((height - side) / 2), width: side, height: side })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(HERO_PHONE);
  console.log(`  ✓ hero-phone.jpg ${side}x${side}`);
}

// Files supplied with spaces in their names get clean-named copies (spaces would break srcset URLs).
const SUPPLIED = [
  // The owners' retouch of C04A4985: a healthy plant by the door.
  { src: join(ROOT, 'assets', 'Photos', 'lanai second floor new photo.jpg'), out: 'lanai-wraparound.jpg' },
  { src: join(ROOT, 'assets', 'misti pic.avif'), out: 'agent-misti.jpg' },
];
for (const s of SUPPLIED) {
  const out = join(STILLS_DIR, s.out);
  if (!existsSync(s.src) || (!force && existsSync(out))) continue;
  const info = await sharp(s.src).rotate().jpeg({ quality: 92, mozjpeg: true }).toFile(out);
  console.log(`  ✓ ${s.out} ${info.width}x${info.height}`);
}

// Hard guard for the Workers static-asset limit.
const tooBig = [];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  const st = statSync(p);
  if (st.isDirectory()) walk(p);
  else if (st.size > 25 * 1024 * 1024) tooBig.push(`${p} ${(st.size / 1048576).toFixed(1)} MiB`);
});
walk(join(ROOT, 'public'));
if (tooBig.length) {
  console.error('Files over the 25 MiB Workers asset limit:\n' + tooBig.join('\n'));
  process.exit(1);
}
console.log('Media OK');
