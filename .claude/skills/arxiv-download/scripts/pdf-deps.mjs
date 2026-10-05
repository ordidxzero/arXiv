// npm packages for PDF rendering (pdf-to-img, pdfjs-dist, @napi-rs/canvas), shared by the arxiv-download and
// paper-translate scripts. They are not committed: node_modules/ is gitignored, versions are pinned by
// package.json + package-lock.json next to it, and ensurePdfDeps() installs them on first use.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODULES = path.join(SKILL_DIR, 'node_modules');
export const PDF_TO_IMG = path.join(MODULES, 'pdf-to-img/dist/index.js');
export const PDFJS = path.join(MODULES, 'pdfjs-dist/legacy/build/pdf.mjs');

const RETRY_ENV = 'PDF_DEPS_RETRY';

// Loading pdfjs is the real test: it needs @napi-rs/canvas built for this platform (pdfjs takes DOMMatrix from it),
// and a missing binary only shows up as "ReferenceError: DOMMatrix is not defined" when the module is evaluated.
async function loads() {
  if (!existsSync(PDF_TO_IMG) || !existsSync(PDFJS)) return false;
  try {
    await import(pathToFileURL(PDFJS).href);
    return true;
  } catch (err) {
    if (process.env[RETRY_ENV]) console.error(err?.stack || err);
    return false;
  }
}

// Makes sure the packages load; installs them from package-lock.json when they don't. Node caches a module whose
// evaluation threw, so after installing, the calling script is re-run in a fresh process and this one exits with
// its status. Call it before importing any of the packages.
export async function ensurePdfDeps() {
  if (await loads()) return;
  if (process.env[RETRY_ENV]) throw new Error('PDF packages still fail to load after npm ci (see the error above).');
  console.error(`Installing PDF rendering packages in ${SKILL_DIR} (npm ci)…`);
  // npm's output goes to stderr so that a caller reading this script's stdout only sees the script's own output.
  const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: SKILL_DIR, stdio: ['ignore', process.stderr, process.stderr] });
  if (install.status !== 0) throw new Error('npm ci failed in the arxiv-download skill');
  const rerun = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, [RETRY_ENV]: '1' } });
  process.exit(rerun.status ?? 1);
}
