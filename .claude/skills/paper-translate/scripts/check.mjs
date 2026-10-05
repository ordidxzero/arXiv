#!/usr/bin/env node
// Checks an assembled translation against work/outline.json and the hugo-book rendering rules, and reports what is
// missing or out of place. Exit code 0 = no errors (warnings may remain), 1 = errors to fix.
//   content   every numbered section in order, captions for every figure/table, references last, no leftover LaTeX,
//             no untranslated paragraphs, no section that looks much shorter than the original
//   hugo      front matter (title, linkTitle, url "/<id>/"), no H1 in the body, figures as {{< image >}} served from
//             static/<id>/figures/, math as {{< katex >}}, no relative links, Goldmark bold/~ fixes applied
//   style     (warnings) paragraphs with many long inline glosses, idioms translated word for word
import fs from 'node:fs';
import path from 'node:path';
import { fixMarkdown } from './markdown-fixes.mjs';
import { imageShortcodes, paperIdOf, rawLocalRefs, resolveRef } from './hugo-site.mjs';

function usage() {
  console.log('Usage: check.mjs <paper-dir> [--file translation.ko.md] [--ratios]');
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
}

const blank = (m) => m.replace(/[^\n]/g, ' ');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KATEX = /\{\{<\s*katex\b([^>]*?)\s*>\}\}([\s\S]*?)\{\{<\s*\/katex\s*>\}\}/g;
const BLOCK = 'display=true';

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }
  const paperDir = path.resolve(args[0]);
  const id = paperIdOf(paperDir);
  const mdPath = path.resolve(paperDir, argValue(args, '--file', 'translation.ko.md'));
  if (!fs.existsSync(mdPath)) {
    console.error(`Not found: ${mdPath}`);
    process.exit(1);
  }
  const md = fs.readFileSync(mdPath, 'utf8');
  const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const outline = readJson(path.join(paperDir, 'work', 'outline.json'));
  const figuresMap = readJson(path.join(paperDir, 'work', 'figures-map.json')) ?? {};

  const errors = [];
  const warnings = [];
  const lines = md.split('\n');
  const lineOf = (idx) => md.slice(0, idx).split('\n').length;

  // Prose = everything except front matter, code, math, shortcodes and HTML comments, with line positions preserved.
  const prose = md
    .replace(/^---\n[\s\S]*?\n---\n/, blank)
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(KATEX, blank)
    .replace(/\{\{<[\s\S]*?>\}\}/g, blank)
    .replace(/`[^`\n]+`/g, blank);
  const proseLines = prose.split('\n');

  // 0. Front matter: the title lives here (hugo-book shows linkTitle in the menu), not in an H1.
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) errors.push('the file must start with Hugo front matter (---) holding title, linkTitle and url — put it at the top of work/parts/00-front.md');
  else {
    const meta = {};
    for (const line of fm[1].split('\n').filter((l) => l.trim())) {
      const kv = line.match(/^(\w+):\s*"((?:[^"\\]|\\.)*)"\s*$/);
      if (kv) meta[kv[1]] = kv[2];
      else errors.push(`front matter line must be key: "value" (double-quoted): ${line}`);
    }
    if (!meta.title?.trim()) errors.push('front matter title is missing (the original paper title)');
    if (!meta.linkTitle?.trim()) errors.push('front matter linkTitle is missing (short name shown in the sidebar)');
    // The slashes matter: Hugo treats "2309.06180" as a file with extension ".06180" and writes a file of that
    // name, which collides with the static/<id>/figures/ directory and drops the page from the build.
    if (meta.url !== `/${id}/`) errors.push(`front matter url must be the arXiv ID with slashes: url: "/${id}/". Found: ${meta.url ?? '(missing)'}`);
    for (const key of Object.keys(meta)) if (!['title', 'linkTitle', 'url'].includes(key)) warnings.push(`unexpected front matter key: ${key}`);
  }

  const headings = [];
  lines.forEach((l, i) => {
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h && proseLines[i].trim()) headings.push({ level: h[1].length, text: h[2].trim(), line: i + 1 });
  });
  for (const h of headings.filter((x) => x.level === 1)) errors.push(`line ${h.line}: no "# " (H1) in the body — the title goes in the front matter title`);
  const refIdx = headings.findIndex((h) => /^References$|Bibliography|참고\s*문헌/i.test(h.text));

  // 1. Headings stay in the original language (sections, Abstract, References).
  for (const h of headings) if (/[가-힣]/.test(h.text)) errors.push(`line ${h.line}: heading was translated — keep the original title: "${h.text}"`);

  // 2. Every numbered section appears as a heading starting with its number, in the original order.
  if (outline) {
    let lastLine = 0;
    for (const s of outline.sections.filter((x) => x.number)) {
      const re = new RegExp(`^${escapeRe(s.number)}(?:[.\\s]|$)`);
      const h = headings.find((x) => re.test(x.text));
      if (!h) errors.push(`missing heading for ${s.level} ${s.number} "${s.title}"`);
      else {
        if (h.line < lastLine) errors.push(`out of order: heading "${h.text}" (line ${h.line}) comes before an earlier section`);
        lastLine = Math.max(lastLine, h.line);
      }
    }
    const unnumbered = outline.sections.filter((x) => !x.number && x.level !== 'bibliography' && x.level !== 'paragraph');
    for (const s of unnumbered) if (!headings.some((h) => h.text.includes(`(${s.title})`) || h.text.includes(s.title))) warnings.push(`unnumbered ${s.level} "${s.title}" — no heading containing its original title; make sure it was translated`);
  }

  // 3. The reference list is the final top-level section and is not translated away.
  if (outline?.bibliography) {
    if (refIdx < 0) errors.push('no references heading (expected "## References")');
    else if (headings.slice(refIdx + 1).some((h) => h.level <= headings[refIdx].level)) errors.push(`references heading (line ${headings[refIdx].line}) is not the last section — move appendix sections above it`);
  }
  const bodyEnd = refIdx >= 0 ? headings[refIdx].line : lines.length + 1;
  // Author block before the first section heading is mostly names and affiliations, which stay in English.
  const bodyStart = headings.find((h) => h.level >= 2)?.line ?? 1;

  // 4. Figures: {{< image >}} shortcodes whose src is /<id>/figures/<name> under static/; no ![]() or <img>.
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) errors.push(`line ${lineOf(m.index)}: Markdown image ![](${m[1]}) left — its file was not found when assembling; fix the path in the part file and re-assemble`);
  for (const m of md.matchAll(/<img\s[^>]*>/gi)) errors.push(`line ${lineOf(m.index)}: <img> tag — write ![alt](path) in the part file and let assemble.mjs make the image shortcode`);
  const seen = new Set();
  for (const { raw, attrs, index } of imageShortcodes(md)) {
    const src = attrs.src ?? '';
    const at = `line ${lineOf(index)}`;
    if (!src) { errors.push(`${at}: image shortcode without src`); continue; }
    if (!attrs.alt?.trim()) errors.push(`${at}: image without alt text — write ![<그림이 무엇인지 짧게>](path): ${src}`);
    if (!attrs.title?.trim()) warnings.push(`${at}: image without title (no **그림 N.**/**표 N.** caption next to it?): ${src}`);
    if (attrs.loading !== 'lazy') errors.push(`${at}: image shortcode must have loading="lazy": ${src}`);
    const rest = raw.replace(/\w+="[^"]*"/g, '').replace(/\{\{<\s*image|>\}\}/g, '').trim();
    if (rest) errors.push(`${at}: image shortcode has unparsed text (a " inside alt/title?): ${rest.slice(0, 60)}`);
    if (!src.startsWith(`/${id}/figures/`)) errors.push(`${at}: image src must be /${id}/figures/<name> (served from static/): ${src}`);
    else if (!fs.existsSync(resolveRef(paperDir, src))) errors.push(`${at}: image file not found in static/: ${src}`);
    if (/\.(pdf|eps|ps)$/i.test(src)) errors.push(`${at}: browsers cannot show ${path.extname(src)} — convert to PNG: ${src}`);
    if (seen.has(src)) warnings.push(`${at}: image used more than once: ${src}`);
    seen.add(src);
  }
  for (const raw of rawLocalRefs(md)) {
    if (!raw.startsWith('/')) errors.push(`relative link "${raw}" — it breaks once published; local files must be images under /${id}/figures/`);
    else if (!fs.existsSync(resolveRef(paperDir, raw))) errors.push(`link target not found in static/: ${raw}`);
  }
  if (outline) {
    const mapped = (p) => seen.has(figuresMap[p]);
    for (const img of outline.images.filter((x) => x.status === 'ok')) if (!mapped(img.path)) warnings.push(`image from source not used: ${img.path} (line ${img.line} of flat.tex)`);
    for (const f of outline.floats.filter((x) => x.type === 'table'))
      for (const it of f.items) if (it.image && !mapped(it.image)) warnings.push(`cropped table image not used: ${it.image} — show table ${it.number} as this image`);
  }

  // 5. Every figure/table number has a caption label in Korean.
  if (outline) {
    const kinds = { figure: '그림', table: '표', algorithm: '알고리즘' };
    for (const f of outline.floats) {
      for (const it of f.items) {
        const word = kinds[f.type];
        if (word && !new RegExp(`${word}\\s*${escapeRe(it.number)}(?![0-9])`).test(md)) errors.push(`no caption/mention for ${word} ${it.number}`);
      }
    }
  }

  // 6. Math: hugo-book katex shortcode only ($ math is converted by assemble.mjs; \$ is a literal dollar sign).
  const opens = md.match(/\{\{<\s*katex\b[^>]*>\}\}/g) ?? [];
  const closes = md.match(/\{\{<\s*\/katex\s*>\}\}/g) ?? [];
  if (opens.length !== closes.length) errors.push(`katex shortcode: ${opens.length} opening vs ${closes.length} closing tags`);
  // Counts can balance while one katex sits inside another (a `$` inside $$…$$); that renders as raw text.
  let depth = 0;
  for (const m of md.matchAll(/\{\{<\s*(\/?)katex\b[^>]*>\}\}/g)) {
    if (m[1]) depth = Math.max(0, depth - 1);
    else if (++depth > 1) errors.push(`line ${lineOf(m.index)}: katex shortcode nested inside another — a $ inside $$…$$ (e.g. \\text{ctx$=$2048}); write \\text{ctx}=2048 instead`);
  }
  let mathCount = 0;
  for (const m of md.matchAll(KATEX)) {
    const [raw, rawArgs, body] = m;
    const a = rawArgs.trim();
    const at = `line ${lineOf(m.index)}`;
    mathCount++;
    if (/displayMode/.test(a)) errors.push(`${at}: use {{< katex ${BLOCK} >}}, not displayMode (it renders inline)`);
    else if (a && a !== BLOCK) errors.push(`${at}: unexpected katex arguments "${a}"`);
    if (!body.trim()) errors.push(`${at}: empty math`);
    if (!a && body.includes('\n')) warnings.push(`${at}: inline math spans lines — use $$ ... $$ for a display equation: ${raw.slice(0, 60)}`);
    const bad = body.match(/\\(cite[a-zA-Z]*|ref|cref|Cref|eqref|label)\b/);
    if (bad) errors.push(`${at}: math contains \\${bad[1]}, which KaTeX cannot render — write the rendered number instead`);
    if (/^\s*\|/.test(lines[lineOf(m.index) - 1]) && /\|/.test(body)) errors.push(`${at}: "|" inside math in a table row splits the cell — use \\vert or \\mid`);
  }
  lines.forEach((line, i) => {
    if (/\{\{<\s*katex\s+display=true/.test(line) && !/^\s*\{\{<\s*katex/.test(line)) warnings.push(`line ${i + 1}: display math inside a sentence — put $$ ... $$ in its own paragraph`);
  });
  proseLines.forEach((line, i) => {
    if (/(?<!\\)\$/.test(line)) errors.push(`line ${i + 1}: unmatched $ (write a literal dollar sign as \\$): ${line.trim().slice(0, 80)}`);
  });

  // 7. Leftover LaTeX in prose.
  const LATEX = /\\(cite[a-zA-Z]*|ref|eqref|cref|Cref|autoref|label|textbf|textit|emph|texttt|begin|end|footnote|url|href|includegraphics|caption|section|subsection|paragraph|item|centering|vspace|hspace)(?![a-zA-Z])/g;
  let leftovers = 0;
  proseLines.forEach((l, i) => {
    if (i + 1 >= bodyEnd) return;
    for (const m of l.matchAll(LATEX)) {
      if (++leftovers <= 15) errors.push(`line ${i + 1}: leftover LaTeX \\${m[1]}: ${l.trim().slice(0, 80)}`);
    }
  });
  if (leftovers > 15) errors.push(`… ${leftovers - 15} more leftover LaTeX commands`);

  // 8. Goldmark quirks (bold next to punctuation, stray ~ strikethrough): assemble.mjs fixes them.
  for (const c of fixMarkdown(md).changed) errors.push(`line ${c.line}: needs "\\ " next to * / ** or "\\~" — re-run assemble.mjs instead of editing translation.ko.md: ${c.before.trim().slice(0, 60)}`);

  // 9. Paragraphs that look untranslated (long, almost no Hangul) before the references.
  let untranslated = 0;
  let start = 0;
  const flush = (end) => {
    const para = proseLines.slice(start, end).join(' ');
    if (start + 1 >= bodyEnd || start + 1 < bodyStart) return;
    const trimmed = para.trim();
    if (!trimmed || /^(\||<|!\[|#)/.test(trimmed)) return;
    const letters = (trimmed.match(/[A-Za-z가-힣]/g) || []).length;
    const hangul = (trimmed.match(/[가-힣]/g) || []).length;
    if (letters >= 120 && hangul / letters < 0.1 && ++untranslated <= 10) errors.push(`line ${start + 1}: paragraph looks untranslated: ${trimmed.slice(0, 80)}…`);
  };
  proseLines.forEach((l, i) => {
    if (!l.trim()) {
      flush(i);
      start = i + 1;
    }
  });
  flush(proseLines.length);
  if (untranslated > 10) errors.push(`… ${untranslated - 10} more untranslated-looking paragraphs`);

  // 10. Per-section volume vs. the original: free translation makes dropped sentences easy to miss.
  if (outline && fs.existsSync(path.join(paperDir, 'work', 'flat.tex'))) {
    const flatLines = fs.readFileSync(path.join(paperDir, 'work', 'flat.tex'), 'utf8').split('\n');
    const rank = { chapter: 0, section: 1, subsection: 2, subsubsection: 3 };
    const secs = outline.sections.filter((x) => x.number && rank[x.level] === 1);
    for (const sec of secs) {
      const idx = outline.sections.indexOf(sec);
      const next = outline.sections.slice(idx + 1).find((x) => rank[x.level] !== undefined && rank[x.level] <= 1 || x.level === 'bibliography');
      const src = flatLines.slice(sec.line, (next ? next.line : outline.marks.docEndLine) - 1).join('\n')
        .replace(/\\begin\{(equation|align|table|tabular|figure)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
        .replace(/\$[^$]*\$/g, ' ').replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, ' ');
      const english = (src.match(/[A-Za-z]/g) || []).length;
      const h = headings.find((x) => new RegExp(`^${escapeRe(sec.number)}(?:[.\\s]|$)`).test(x.text));
      if (!h || english < 400) continue;
      const end = headings.find((x) => x.line > h.line && x.level <= h.level)?.line ?? lines.length + 1;
      const hangul = (proseLines.slice(h.line, end - 1).join('\n').match(/[가-힣]/g) || []).length;
      const ratio = hangul / english;
      if (ratio < 0.25) warnings.push(`section ${sec.number}: translation looks short (${hangul} Hangul vs ${english} English letters, ratio ${ratio.toFixed(2)}) — check for dropped content`);
      if (args.includes('--ratios')) console.log(`ratio ${sec.number}: ${ratio.toFixed(2)}`);
    }
  }

  // 11. Readability (warnings only, see style-guide.md): paragraphs buried under long inline glosses, and idioms
  // translated word for word.
  // A gloss = a top-level parenthesis with at least GLOSS_MIN Hangul characters (shorter ones are mostly "(정적)"-style
  // translations of a single word).
  const GLOSS_MIN = 10;
  const GLOSS_MAX = 35;
  const GLOSSES_PER_PARAGRAPH = 4;
  const glossLengths = (text) => {
    const found = [];
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') stack.push(i);
      else if (text[i] === ')' && stack.length) {
        const open = stack.pop();
        const hangul = (text.slice(open + 1, i).match(/[가-힣]/g) || []).length;
        if (!stack.length && hangul >= GLOSS_MIN) found.push(hangul);
      }
    }
    return found;
  };
  let pileups = 0;
  let paraStart = 0;
  const checkGlosses = (end) => {
    if (paraStart + 1 >= bodyEnd || paraStart + 1 < bodyStart || ++pileups > 10) return;
    const glosses = glossLengths(proseLines.slice(paraStart, end).join(' '));
    const at = `line ${paraStart + 1}`;
    if (glosses.length >= GLOSSES_PER_PARAGRAPH) warnings.push(`${at}: ${glosses.length} inline glosses in one paragraph — keep the essential ones and move the rest into a 역주 block or to the term's first use in the body`);
    else if (glosses.some((n) => n > GLOSS_MAX)) warnings.push(`${at}: an inline gloss of ${Math.max(...glosses)} Hangul characters — a gloss is one short clause; move the explanation into a 역주 block`);
    else pileups--;
  };
  proseLines.forEach((l, i) => {
    if (!l.trim()) {
      checkGlosses(i);
      paraStart = i + 1;
    }
  });
  checkGlosses(proseLines.length);

  const TRANSLATIONESE = [
    [/결정적으로/, '결정적으로 (Crucially) → 특히 / 무엇보다 / 생략'],
    [/중요하게도/, '중요하게도 (Importantly) → 중요한 점은 / 생략'],
    [/흥미롭게도/, '흥미롭게도 (Interestingly) → 눈여겨볼 점은 / 생략'],
    [/약속(?:하|한|했)/, '약속하다 (promise) → 기대할 수 있다 / 가능성을 보여 주다'],
    [/(?:한|몇)\s*자릿수/, '한 자릿수 (an order of magnitude) → 약 10배'],
    [/에 있어서/, '~에 있어서 → ~에서'],
    [/되어진/, '~되어진다 → ~된다'],
  ];
  let idioms = 0;
  proseLines.forEach((l, i) => {
    if (i + 1 >= bodyEnd || i + 1 < bodyStart) return;
    for (const [re, hint] of TRANSLATIONESE) {
      const m = l.match(re);
      if (m && ++idioms <= 15) warnings.push(`line ${i + 1}: translationese "${m[0]}" — ${hint}`);
    }
  });
  if (idioms > 15) warnings.push(`… ${idioms - 15} more translationese expressions`);

  const hangulTotal = (md.match(/[가-힣]/g) || []).length;
  console.log(`Checked ${path.relative(process.cwd(), mdPath)}: ${lines.length} lines, ${headings.length} headings, ${seen.size} images, ${mathCount} math, ${hangulTotal} Hangul characters`);
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : 'OK');
  process.exit(errors.length ? 1 : 0);
}

main();
