#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function usage() {
  console.log('Usage: source-pdfs-to-png.mjs <source-dir> [--scale N]');
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }

  const sourceDir = path.resolve(args[0]);
  const scale = argValue(args, '--scale', '4');
  const figureScript = fileURLToPath(new URL('./figure-pdf-to-png.mjs', import.meta.url));
  const pdfFiles = (await walk(sourceDir)).filter((p) => path.basename(p).toLowerCase() !== 'paper.pdf');

  let failed = 0;
  for (const pdfPath of pdfFiles) {
    const pngPath = pdfPath.replace(/\.pdf$/i, '.png');
    const result = spawnSync(process.execPath, [figureScript, pdfPath, '--out', pngPath, '--scale', scale], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      failed += 1;
      console.error(`Failed: ${path.relative(sourceDir, pdfPath)}`);
    }
  }
  if (failed) console.error(`Skipped ${failed} PDF(s) that could not be converted.`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
