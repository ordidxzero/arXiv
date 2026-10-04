#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function ensureInstalled() {
  if (await hasPdfToImg()) return;
  const result = spawnSync('npm', ['install', '--no-save', 'pdf-to-img', '@napi-rs/canvas'], {
    cwd: SKILL_DIR,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('npm install failed');
  }
}

async function hasPdfToImg() {
  try {
    await import('pdf-to-img');
    return true;
  } catch {
    return false;
  }
}

function usage() {
  console.log('Usage: figure-pdf-to-png.mjs <pdf-file> [--out FILE] [--scale N]');
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }

  const pdfPath = path.resolve(args[0]);
  const outPath = path.resolve(argValue(args, '--out', pdfPath.replace(/\.pdf$/i, '.png')));
  const scale = Number(argValue(args, '--scale', '4')) || 4;

  await ensureInstalled();
  const { pdf } = await import('pdf-to-img');
  const document = await pdf(pdfPath, { scale });
  const image = await document.getPage(1);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, image);
  console.log(`Rendering ${path.relative(process.cwd(), pdfPath)} -> ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
