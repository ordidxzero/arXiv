// Where a translation lives in the Hugo (hugo-book) site, shared by assemble.mjs, check.mjs and publish.mjs.
//   figures   <site>/static/<id>/figures/<name>, referenced as /<id>/figures/<name> (hugo-book serves static/ at the
//             site root; relative paths break on deploy)
//   page      <site>/content/docs/<id>.md, with url "/<id>/" in its front matter
import fs from 'node:fs';
import path from 'node:path';

// Hugo site root: the nearest ancestor of `from` with a Hugo config file; falls back to the cwd.
export function siteRoot(from) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml'].some((f) => fs.existsSync(path.join(dir, f)))) return dir;
    if (dir === path.dirname(dir)) return process.cwd();
  }
}

export const paperIdOf = (paperDir) => path.basename(paperDir);
export const figuresDirFor = (paperDir) => path.join(siteRoot(paperDir), 'static', paperIdOf(paperDir), 'figures');
export const figuresUrlFor = (paperDir) => `/${paperIdOf(paperDir)}/figures`;
export const publishPathFor = (paperDir) => path.join(siteRoot(paperDir), 'content', 'docs', `${paperIdOf(paperDir)}.md`);

// {{< image src="..." alt="..." title="..." loading="lazy" >}} → [{ raw, attrs, index }]
export function imageShortcodes(text) {
  return [...text.matchAll(/\{\{<\s*image\s+([\s\S]*?)\s*>\}\}/g)].map((m) => ({
    raw: m[0],
    index: m.index,
    attrs: Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  }));
}

// Every local reference in the page, as the raw string written in the file.
export function rawLocalRefs(text) {
  const candidates = [
    ...imageShortcodes(text).map((s) => s.attrs.src).filter(Boolean),
    ...[...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/<img[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]),
  ];
  return [...new Set(candidates.filter((raw) => !/^([a-z][a-z0-9+.-]*:|#)/i.test(raw)))];
}

// Resolves a reference: "/..." is served from <site>/static, anything else is relative to the paper dir.
export function resolveRef(paperDir, raw) {
  const clean = decodeURI(raw.split('#')[0]);
  return clean.startsWith('/') ? path.join(siteRoot(paperDir), 'static', clean) : path.resolve(paperDir, clean);
}

const sanitize = (name) => name.replace(/[^A-Za-z0-9._-]/g, '-');

// Copies `from` into the paper's static figures dir and returns { name, copied }. The name is the basename,
// else the path under source/ joined with "-", else "<n>-<basename>"; a file already there with identical
// content is reused. `reserved` holds names taken earlier in the same run; dryRun only computes the name.
export function stageFile(paperDir, from, { dryRun = false, reserved = new Map() } = {}) {
  const dir = figuresDirFor(paperDir);
  const base = sanitize(path.basename(from));
  const candidates = [base, sanitize(path.relative(paperDir, from).replace(/^source[\\/]/, '').split(path.sep).join('-'))];
  for (let n = 2; n < 1000; n += 1) candidates.push(`${n}-${base}`);
  const data = fs.readFileSync(from);
  for (const name of candidates) {
    if (reserved.has(name)) {
      if (reserved.get(name) === from) return { name, copied: false };
      continue;
    }
    const to = path.join(dir, name);
    if (fs.existsSync(to) && !fs.readFileSync(to).equals(data)) continue;
    reserved.set(name, from);
    const copied = !fs.existsSync(to);
    if (copied && !dryRun) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(from, to);
    }
    return { name, copied };
  }
  throw new Error(`No free name for ${from} in ${dir}`);
}
