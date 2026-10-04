#!/usr/bin/env node
// Renders selected PDF pages to PNG (PDF mode: figures have no separate image files).
// Reuses the pdf-to-img install that the arxiv-download skill manages.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ARXIV_SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../arxiv-download');
const PDF_TO_IMG = path.join(ARXIV_SKILL, 'node_modules/pdf-to-img/dist/index.js');

function usage() {
  console.log('Usage: pdf-pages-to-png.mjs <pdf-file> --pages 3,5-7 [--out DIR] [--scale N]');
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
}

function parsePages(spec) {
  const pages = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((x) => Number(x.trim()));
    if (!a) continue;
    for (let p = a; p <= (b || a); p++) pages.add(p);
  }
  return [...pages].sort((x, y) => x - y);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help') || !args.includes('--pages')) {
    usage();
    process.exit(args.includes('-h') || args.includes('--help') ? 0 : 1);
  }
  const pdfPath = path.resolve(args[0]);
  const outDir = path.resolve(argValue(args, '--out', path.join(path.dirname(pdfPath), 'work', 'pages')));
  const scale = Number(argValue(args, '--scale', '2')) || 2;
  const pages = parsePages(argValue(args, '--pages', ''));

  if (!existsSync(PDF_TO_IMG)) {
    const result = spawnSync('npm', ['install', '--no-save', 'pdf-to-img', '@napi-rs/canvas'], { cwd: ARXIV_SKILL, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('npm install failed');
  }
  const { pdf } = await import(pathToFileURL(PDF_TO_IMG).href);
  const document = await pdf(pdfPath, { scale });
  await fs.mkdir(outDir, { recursive: true });
  for (const p of pages) {
    if (p > document.length) {
      console.error(`Skipping page ${p}: the PDF has ${document.length} pages`);
      continue;
    }
    const out = path.join(outDir, `page-${p}.png`);
    await fs.writeFile(out, await document.getPage(p));
    console.log(`Saved ${path.relative(process.cwd(), out)}`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
