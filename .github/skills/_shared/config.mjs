// Shared paths and config loading for the repo's agent skills.
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export const SHARED_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = resolve(SHARED_DIR, '..');
export const REPO_ROOT = resolve(SKILLS_DIR, '..', '..');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export function readJsonIfExists(path, fallback = null) {
  return existsSync(path) ? readJson(path) : fallback;
}

export function loadSiteConfig(path = join(SHARED_DIR, 'site.local.json')) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}: copy site.example.json to site.local.json (git-ignored) and fill in the IDs.`);
  }
  const cfg = readJson(path);
  for (const key of ['site', 'ga4', 'meta', 'cloudflare', 'd1']) {
    if (!cfg[key]) throw new Error(`${path} lacks the "${key}" section`);
  }
  return cfg;
}

// Run Wrangler's JavaScript entry point with Node directly (the repo's copy first, then a global install):
// no shell, so arguments are passed verbatim.
export function runWrangler(args, options = {}) {
  const candidates = [
    join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  ];
  const js = candidates.find((p) => existsSync(p));
  if (!js) throw new Error('Wrangler is not installed: run "npm install" in the repo.');
  return execFileSync(process.execPath, [js, ...args], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=', 2);
    out[k] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}
