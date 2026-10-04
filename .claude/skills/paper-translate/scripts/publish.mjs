#!/usr/bin/env node
// Publishes a finished translation and cleans up its working files. Figures are already in
// <site>/static/<id>/figures/ (assemble.mjs) and referenced as /<id>/figures/<name>, so this:
//   1. runs check.mjs and aborts if it fails (it needs work/outline.json and flat.tex, deleted below);
//   2. places translation.ko.md at <site>/content/docs/<id>.md and builds the site in memory with hugo
//      (KaTeX errors only show up here); on failure the page is taken out again and nothing else changes;
//   3. deletes everything in <paper-dir> (paper.pdf, source/, tables/, work/ with the part files) and <paper-dir> itself;
//   4. deletes files in static/<id>/figures/ that the page does not reference (staged earlier, then dropped).
// --dry-run runs the check and the build test (the page is placed only for the build and removed afterwards) and lists
// what would be deleted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { figuresDirFor, publishPathFor, rawLocalRefs, resolveRef, siteRoot } from './hugo-site.mjs';

function usage() {
  console.log('Usage: publish.mjs <paper-dir> [--dry-run]   (e.g. ./papers/1706.03762)');
  console.log('  Moves translation.ko.md to content/docs/<id>.md, then deletes <paper-dir> and the');
  console.log('  unreferenced files in static/<id>/figures/.');
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

// Removes empty directories bottom-up; returns true when `dir` itself became empty.
function pruneEmptyDirs(dir, dryRun, deleted) {
  let empty = true;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && pruneEmptyDirs(full, dryRun, deleted)) {
      if (!dryRun) fs.rmdirSync(full);
    } else if (!deleted.has(full)) {
      empty = false;
    }
  }
  return empty;
}

const checker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check.mjs');

function runCheck(paperDir) {
  const check = spawnSync(process.execPath, [checker, paperDir], { encoding: 'utf8' });
  if (check.status !== 0) {
    process.stdout.write(check.stdout);
    process.stderr.write(check.stderr);
  }
  return check.status === 0;
}

// Builds the whole site in memory. Returns true on success, null when hugo is not installed. The cache goes to the
// temp dir: KaTeX rendering needs a writable cache, and the default one (~/Library/Caches) may be off limits.
function runHugo(site) {
  const cacheDir = path.join(os.tmpdir(), 'hugo_cache');
  const build = spawnSync('hugo', ['--source', site, '--renderToMemory', '--logLevel', 'error', '--cacheDir', cacheDir], { encoding: 'utf8' });
  if (build.error?.code === 'ENOENT') return null;
  if (build.status !== 0) {
    process.stdout.write(build.stdout);
    process.stderr.write(build.stderr);
  }
  return build.status === 0;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((a) => a !== '--dry-run');
  if (positional.length !== 1 || positional[0] === '-h' || positional[0] === '--help') {
    usage();
    process.exit(positional.length === 1 ? 0 : 1);
  }

  const paperDir = path.resolve(positional[0]);
  const mdPath = path.join(paperDir, 'translation.ko.md');
  const rel = (f) => path.relative(process.cwd(), f);
  if (!fs.existsSync(mdPath)) throw new Error(`Missing ${rel(mdPath)}. Nothing is deleted before the translation exists.`);
  const publishPath = publishPathFor(paperDir);
  if (fs.existsSync(publishPath)) throw new Error(`${rel(publishPath)} already exists. Ask the user before replacing it; nothing was changed.`);
  if (!runCheck(paperDir)) throw new Error('check.mjs failed. Fix the translation before publishing; nothing was changed.');

  const text = fs.readFileSync(mdPath, 'utf8');
  const publishDir = path.dirname(publishPath);
  const newDir = !fs.existsSync(publishDir);
  fs.mkdirSync(publishDir, { recursive: true });
  fs.copyFileSync(mdPath, publishPath);
  const built = runHugo(siteRoot(paperDir));
  if (built === false || dryRun) {
    fs.rmSync(publishPath);
    if (newDir) fs.rmdirSync(publishDir);
  }
  if (built === false) throw new Error(`hugo build failed with ${rel(publishPath)} in place (see above; KaTeX errors name the formula). Took the page out again; nothing else was changed.`);
  if (built === null) console.log('WARN hugo not found; skipped the build test.');

  const toDelete = walk(paperDir);
  if (!dryRun) {
    fs.rmSync(paperDir, { recursive: true });
  }

  const figuresDir = figuresDirFor(paperDir);
  const referenced = new Set(rawLocalRefs(text).filter((raw) => raw.startsWith('/')).map((raw) => resolveRef(paperDir, raw)));
  const unused = fs.existsSync(figuresDir) ? walk(figuresDir).filter((f) => !referenced.has(f)) : [];
  for (const f of unused) if (!dryRun) fs.rmSync(f);
  if (fs.existsSync(figuresDir)) pruneEmptyDirs(figuresDir, dryRun, new Set(unused));

  const prefix = dryRun ? '[dry run] ' : '';
  console.log(`${prefix}hugo build: ${built === null ? 'skipped' : 'OK'}`);
  console.log(`${prefix}translation.ko.md ${dryRun ? '->' : 'published to'} ${rel(publishPath)}`);
  console.log(`${prefix}${rel(paperDir)}/: ${dryRun ? 'would delete' : 'deleted'} ${toDelete.length} files and the folder itself.`);
  console.log(`${prefix}${rel(figuresDir)}/: ${referenced.size} referenced, ${unused.length} unused ${dryRun ? 'to delete' : 'deleted'}${unused.length ? ':' : '.'}`);
  if (unused.length) console.log(unused.map((f) => `  ${path.relative(figuresDir, f)}`).join('\n'));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
