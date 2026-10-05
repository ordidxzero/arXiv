#!/usr/bin/env node
// Makes the Hugo site buildable, so publish.mjs can test the page (KaTeX errors only show up in a real build):
//   1. checks out the theme named in the site config when its folder is empty (git submodule update --init);
//   2. reads the theme's min_version from themes/<theme>/theme.toml;
//   3. returns a hugo binary at least that new: $HUGO_BIN, then `hugo` on PATH, then a copy cached in
//      ~/.cache/paper-translate/hugo-<version>/, else downloads hugo_extended_<min_version> from the GitHub
//      releases into that cache.
// As a CLI it prints the binary's path: node ensure-hugo.mjs [site-dir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { siteRoot } from './hugo-site.mjs';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

const parseVersion = (s) => s?.match(/v?(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) ?? null;
const atLeast = (v, min) => {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};

function themeName(site) {
  for (const f of ['hugo.yaml', 'hugo.toml', 'config.toml', 'hugo.json']) {
    const file = path.join(site, f);
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/^\s*"?theme"?\s*[:=]\s*["']?([\w.-]+)["']?/m);
    if (m) return m[1];
  }
  return null;
}

// Checks out the theme submodule when its folder is missing or empty. Returns the theme dir (or null if no theme).
function ensureTheme(site) {
  const name = themeName(site);
  if (!name) return null;
  const dir = path.join(site, 'themes', name);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) return dir;
  console.log(`Theme ${name} is not checked out; running git submodule update --init themes/${name}`);
  const r = run('git', ['-C', site, 'submodule', 'update', '--init', '--depth', '1', `themes/${name}`], { stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(dir) || !fs.readdirSync(dir).length) {
    throw new Error(`Could not check out the theme into ${dir} (git submodule update failed).`);
  }
  return dir;
}

function minVersion(themeDir) {
  const toml = themeDir && path.join(themeDir, 'theme.toml');
  if (!toml || !fs.existsSync(toml)) return null;
  return parseVersion(fs.readFileSync(toml, 'utf8').match(/^\s*min_version\s*=\s*"([^"]+)"/m)?.[1]);
}

function versionOf(bin) {
  const r = run(bin, ['version']);
  return r.status === 0 ? parseVersion(r.stdout) : null;
}

function releaseAsset(version) {
  const v = version.join('.');
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (process.platform === 'linux' && arch) return `hugo_extended_${v}_linux-${arch}.tar.gz`;
  if (process.platform === 'darwin') return `hugo_extended_${v}_darwin-universal.tar.gz`;
  return null;
}

function download(version, dir) {
  const asset = releaseAsset(version);
  if (!asset) throw new Error(`No Hugo download for ${process.platform}/${process.arch}; install Hugo >= ${version.join('.')} and set HUGO_BIN.`);
  const url = `https://github.com/gohugoio/hugo/releases/download/v${version.join('.')}/${asset}`;
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, asset);
  console.log(`Downloading Hugo ${version.join('.')} (${url})`);
  const get = run('curl', ['-sSfL', '--retry', '3', '-o', archive, url]);
  if (get.status !== 0) throw new Error(`Hugo download failed: ${(get.stderr || get.error?.message || '').trim()}`);
  const untar = run('tar', ['-xzf', archive, '-C', dir, 'hugo']);
  fs.rmSync(archive, { force: true });
  if (untar.status !== 0) throw new Error(`Could not unpack ${asset}: ${untar.stderr.trim()}`);
  return path.join(dir, 'hugo');
}

// Returns the path of a hugo binary that can build `site`; throws with the reason when there is none.
export function ensureHugo(site) {
  const themeDir = ensureTheme(site);
  const min = minVersion(themeDir) ?? [0, 0, 0];
  const cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'paper-translate', `hugo-${min.join('.')}`);
  const found = [];
  for (const bin of [process.env.HUGO_BIN, 'hugo', path.join(cacheDir, 'hugo')].filter(Boolean)) {
    const v = versionOf(bin);
    if (v && atLeast(v, min)) return bin;
    if (v) found.push(`${bin} is ${v.join('.')}`);
  }
  if (found.length) console.log(`Hugo too old for the theme (needs >= ${min.join('.')}): ${found.join(', ')}`);
  const bin = download(min, cacheDir);
  const v = versionOf(bin);
  if (!v || !atLeast(v, min)) throw new Error(`Downloaded Hugo at ${bin} does not run or is older than ${min.join('.')}.`);
  return bin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(ensureHugo(siteRoot(process.argv[2] ?? process.cwd())));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
