#!/usr/bin/env node
// Concatenates work/parts/*.md (alphabetical = paper order) into translation.ko.md, rendered for hugo-book:
//   - ![alt](path) → the image is copied to <site>/static/<id>/figures/ and becomes
//     {{< image src="/<id>/figures/<name>" alt="..." title="<caption>" loading="lazy" >}}; title is taken from the
//     **그림 N.** / **표 N.** caption paragraph next to it;
//   - $$...$$ → {{< katex display=true >}} ... {{< /katex >}}, $...$ → {{< katex >}}...{{< /katex >}} (\$ stays text);
//   - Goldmark quirks are fixed (markdown-fixes.mjs): "\ " after bold that ends in punctuation, "\~" for every "~".
// Part files keep plain Markdown ($ math, ![]() images); only the assembled file carries the Hugo syntax.
// Also writes work/figures-map.json (source image path → src) for check.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fixMarkdown } from './markdown-fixes.mjs';
import { figuresDirFor, figuresUrlFor, stageFile } from './hugo-site.mjs';

function usage() {
  console.log('Usage: assemble.mjs <paper-dir> [--out translation.ko.md]');
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
}

const posix = (p) => p.split(path.sep).join('/');
const IMG = /!\[([^\]]*)\]\(\s*<?([^)>\s]+(?: [^)>]+)?)>?(?:\s+"[^"]*")?\s*\)/g;
const CAPTION = /^\*\*(그림|표|알고리즘)\s*[A-Z]?[\d.]+[a-z]?\.?\*\*/;

// Text that is safe inside a shortcode attribute: no markdown, math delimiters or double quotes.
const attrText = (s, max = 300) => {
  const t = s
    .replace(/\\ /g, '')
    .replace(/[*`$]/g, '')
    .replace(/\{\{<[^>]*>\}\}/g, '')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// Code blocks and inline code are held out of every conversion.
function protectCode(text) {
  const saved = [];
  const hold = (s) => `${saved.push(s) - 1}`;
  const out = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, hold).replace(/`[^`\n]+`/g, hold);
  return { out, restore: (s) => s.replace(/(\d+)/g, (m, i) => saved[i]) };
}

function convertMath(text) {
  let display = 0;
  let inline = 0;
  const out = text
    .replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, (m, tex) => {
      display++;
      return `{{< katex display=true >}}\n${tex.trim()}\n{{< /katex >}}`;
    })
    .replace(/(?<![\\$])\$(?!\$)((?:\\.|[^$\\\n])+?)\$(?!\$)/g, (m, tex) => {
      inline++;
      return `{{< katex >}}${tex.trim()}{{< /katex >}}`;
    });
  return { out, display, inline };
}

function convertImages(text, paperDir) {
  const lines = text.split('\n');
  // Paragraph blocks (runs of non-blank lines), so each image can find the caption paragraph next to it.
  const blocks = [];
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    if (i > 0 && lines[i - 1].trim()) blocks.at(-1).end = i;
    else blocks.push({ start: i, end: i });
  });
  const blockText = (b) => lines.slice(b.start, b.end + 1).join(' ');
  const hasImage = (b) => /!\[[^\]]*\]\(/.test(blockText(b));
  const captionFor = (bi) => {
    for (let j = bi + 1; j < Math.min(blocks.length, bi + 5); j++) {
      const t = blockText(blocks[j]);
      if (/^#/.test(t) || hasImage(blocks[j])) break;
      if (CAPTION.test(t)) return t;
    }
    const prev = blocks[bi - 1] && blockText(blocks[bi - 1]);
    return prev && CAPTION.test(prev) ? prev : '';
  };

  const urlBase = figuresUrlFor(paperDir);
  const reserved = new Map();
  const map = {};
  const missing = [];
  let count = 0;
  for (const [bi, b] of blocks.entries()) {
    if (!hasImage(b)) continue;
    const title = attrText(captionFor(bi));
    for (let i = b.start; i <= b.end; i++) {
      lines[i] = lines[i].replace(IMG, (m, alt, src) => {
        src = src.trim();
        if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return m;
        const from = path.resolve(paperDir, decodeURI(src));
        if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
          missing.push(src);
          return m;
        }
        const { name } = stageFile(paperDir, from, { reserved });
        const url = `${urlBase}/${name}`;
        map[posix(path.relative(paperDir, from))] = url;
        count++;
        const a = attrText(alt);
        return `{{< image src="${url}" alt="${a}" title="${title || a}" loading="lazy" >}}`;
      });
    }
  }
  return { out: lines.join('\n'), map, missing, count };
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }
  const paperDir = path.resolve(args[0]);
  const outPath = path.resolve(paperDir, argValue(args, '--out', 'translation.ko.md'));
  const partsDir = path.join(paperDir, 'work', 'parts');
  const parts = fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((f) => f.endsWith('.md')).sort() : [];
  if (!parts.length) {
    console.error(`No part files in ${partsDir}`);
    process.exit(1);
  }

  const joined = parts.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8').replace(/\s*$/, '\n')).join('\n');
  const fm = joined.match(/^---\n[\s\S]*?\n---\n/);
  if (!fm) console.error('WARN: work/parts/00-front.md should start with the front matter (title, linkTitle, url). See SKILL.md.');
  const frontMatter = fm ? fm[0] : '';

  const { out: protectedBody, restore } = protectCode(joined.slice(frontMatter.length));
  const images = convertImages(protectedBody, paperDir);
  const math = convertMath(images.out);
  const { text, changed } = fixMarkdown(frontMatter + restore(math.out));

  fs.writeFileSync(outPath, text);
  fs.writeFileSync(path.join(paperDir, 'work', 'figures-map.json'), `${JSON.stringify(images.map, null, 1)}\n`);
  console.log(
    `Wrote ${path.relative(process.cwd(), outPath)} from ${parts.length} parts: ${images.count} images -> ${path.relative(process.cwd(), figuresDirFor(paperDir))}/, ` +
      `${math.display} display + ${math.inline} inline math, ${changed.length} line(s) with bold/~ fixes`,
  );
  for (const m of images.missing) console.error(`ERROR image file not found (left as Markdown): ${m}`);
  if (images.missing.length) process.exit(1);
}

main();
