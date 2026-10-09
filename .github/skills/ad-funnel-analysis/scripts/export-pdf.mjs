// Print report-public.html to PDF with headless Microsoft Edge, keep it in the run folder as report.pdf and file a copy
// under "daily ad report/" in the repository. The public HTML is checked for account IDs, email addresses, phone
// numbers, IP addresses and local paths first; anything found keeps the PDF out of the repository.
//   node export-pdf.mjs --run reports/ad-funnel-analysis/<run-id> [--out "<folder>"] [--no-publish]
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadSiteConfig, parseArgs, readJson, readJsonIfExists } from '../../_shared/config.mjs';
import { configIds, pdfName, sensitiveMatches } from './lib/publish.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SKILL_DIR, '..', '..', '..');
const args = parseArgs();
const run = args.run && resolve(args.run);
const html = run && join(run, 'report-public.html');
if (!run || !existsSync(html)) {
  console.error('usage: node export-pdf.mjs --run <run folder containing report-public.html> [--out <folder>] [--no-publish]');
  process.exit(2);
}
const m = readJson(join(run, 'funnel.json'));

// 1. Nothing private in what will be shared.
let site = {};
try {
  site = loadSiteConfig();
} catch {}
const insights = readJsonIfExists(join(run, 'meta', 'insights', 'insights.json'));
const ids = [...configIds(site), ...(insights?.campaigns ?? []).map((c) => c.id).filter(Boolean)];
const problems = sensitiveMatches(readFileSync(html, 'utf8'), ids);

// 2. Print.
const edge = [
  process.env.EDGE_PATH,
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((p) => p && existsSync(p));
if (!edge) {
  console.error('export-pdf: Microsoft Edge was not found (set EDGE_PATH)');
  process.exit(4);
}
const pdf = join(run, 'report.pdf');
rmSync(pdf, { force: true });
const profile = mkdtempSync(join(tmpdir(), 'ad-report-pdf-'));
const res = spawnSync(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--virtual-time-budget=10000',
    `--print-to-pdf=${pdf}`,
    pathToFileURL(html).href,
  ],
  { timeout: 180e3, windowsHide: true },
);
rmSync(profile, { recursive: true, force: true });
const bytes = existsSync(pdf) ? readFileSync(pdf) : null;
if (!bytes || bytes.subarray(0, 5).toString('latin1') !== '%PDF-' || bytes.length < 20e3) {
  console.error(`export-pdf: Edge did not produce a PDF (exit ${res.status ?? res.error?.code ?? '?'})`);
  process.exit(4);
}
const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

// 3. File it in the repository.
const name = pdfName({ campaigns: m.campaigns.map((c) => c.metaCampaign), reportDate: m.run.until, extractedAt: m.run.generatedAt, timeZone: m.run.metaTimezone });
const outDir = resolve(REPO, args.out ?? 'daily ad report');
const target = join(outDir, name);
const info = { file: pdf, pages, bytes: bytes.length, name, repoPath: null, sensitive: problems };
if (problems.length) {
  console.error(`export-pdf: not filed in the repository; the shared report contains ${problems.join(', ')}`);
} else if (!args['no-publish']) {
  mkdirSync(outDir, { recursive: true });
  copyFileSync(pdf, target);
  info.repoPath = relative(REPO, target).replace(/\\/g, '/');
}
writeFileSync(join(run, 'pdf.json'), JSON.stringify(info, null, 2));
console.log(`pdf: ${pages} pages, ${Math.round(bytes.length / 1024)} KB${info.repoPath ? ` -> ${info.repoPath}` : ''}`);
process.exit(problems.length ? 3 : 0);
