#!/usr/bin/env node
// Flattens a paper's LaTeX source and writes everything the translation step works from into <paper-dir>/work/:
//   flat.tex       main .tex with every \input/\include inlined, comments and \iffalse blocks removed
//   outline.md     sections (with flat.tex line ranges), figures, tables, warnings — read this first
//   outline.json   the same data for check.mjs
//   labels.json    \label key -> { type, number } so \ref/\eqref/\cref can be rendered as numbers
//   macros.tex     user macro definitions, needed to expand custom commands inside math
//   references.md  the bibliography, cleaned to Markdown and kept in the original language
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIGURE_TO_PNG = path.resolve(SCRIPT_DIR, '../../arxiv-download/scripts/figure-pdf-to-png.mjs');

function usage() {
  console.log('Usage: prepare.mjs <arxiv-id | arxiv-url | paper-dir> [--main FILE]');
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
}

function resolvePaperDir(input) {
  if (fs.existsSync(input) && fs.statSync(input).isDirectory()) return path.resolve(input);
  let id = input;
  const m = input.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+)/i);
  if (m) id = m[1];
  id = id.replace(/^arxiv:/i, '').replace(/[?#].*$/, '').replace(/\.pdf$/i, '');
  return path.resolve('papers', id.replace(/\//g, '_'));
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const posix = (p) => p.split(path.sep).join('/');

// ---------- LaTeX text helpers ----------

function stripComments(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    // A whole-line comment is dropped entirely; keeping it as an empty line would create a paragraph break.
    if (/^\s*%/.test(line)) continue;
    out.push(line.replace(/((?:^|[^\\])(?:\\\\)*)%.*$/, '$1'));
  }
  return out.join('\n');
}

function removeDeadBlocks(text) {
  text = text.replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, '');
  let out = '';
  let i = 0;
  const re = /\\iffalse(?![a-zA-Z])/g;
  let m;
  while ((m = re.exec(text))) {
    out += text.slice(i, m.index);
    let depth = 1;
    let end = text.length;
    const tok = /\\(if(?!thenelse)[a-zA-Z]*|fi)(?![a-zA-Z])/g;
    tok.lastIndex = re.lastIndex;
    let t;
    while ((t = tok.exec(text))) {
      if (t[1] === 'fi') {
        if (--depth === 0) {
          end = tok.lastIndex;
          break;
        }
      } else depth++;
    }
    i = end;
    re.lastIndex = end;
  }
  return out + text.slice(i);
}

function readGroup(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

function readOpt(s, i) {
  let k = i;
  while (k < s.length && /\s/.test(s[k])) k++;
  if (s[k] !== '[') return { text: null, end: i };
  let depth = 0;
  for (let j = k + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ']' && depth === 0) return { text: s.slice(k + 1, j), end: j + 1 };
  }
  return { text: null, end: i };
}

const ACCENTS = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', u: '̆', H: '̋', k: '̨', r: '̊' };
const LETTERS = { ss: 'ß', ae: 'æ', AE: 'Æ', aa: 'å', AA: 'Å', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'i', j: 'j' };

// Best-effort LaTeX -> Markdown for short text (titles, captions, bibliography entries). Math is left untouched.
function cleanLatex(s) {
  const keep = [];
  const stash = (v) => `\u0000${keep.push(v) - 1}\u0000`;
  s = s.replace(/\$[^$]*\$/g, stash);
  s = s.replace(/\\url\s*\{([^}]*)\}/g, (_, u) => stash(`<${u}>`));
  s = s.replace(/\\href\s*\{([^}]*)\}\s*\{([^}]*)\}/g, (_, u, t) => `${t} (${stash(u)})`);
  s = s.replace(/\\doi\s*\{([^}]*)\}/g, (_, d) => stash(`doi:${d}`));
  s = s.replace(/\\([&%_$#{}])/g, (_, c) => stash(c));
  s = s.replace(/\\(?:cite[a-zA-Z]*|ref|eqref|cref|Cref|autoref)\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g, (_, k) => `[ref:${k}]`);
  s = s.replace(/\\\\(\[[^\]]*\])?/g, ' ');
  s = s.replace(/\\[,;: !]/g, ' ').replace(/\\-/g, '');
  s = s.replace(/\\(?:newblock|penalty0|urlprefix|relax|protect|allowbreak|ignorespaces|bibinitperiod|bibinitdelim|bibnamedelim[a-z]?)(?![a-zA-Z])/g, ' ');
  s = s.replace(/\\(?:bibinfo|bibfield)\s*\{[^}]*\}/g, '');
  s = s.replace(/\\natexlab\s*\{([^}]*)\}/g, '$1');
  s = s.replace(/\\(ss|ae|AE|aa|AA|oe|OE|o|O|l|L|i|j)(?![a-zA-Z])(?:\{\})?/g, (_, l) => LETTERS[l]);
  s = s.replace(/\\(['`^"~=.])\s*(?:\{\s*([a-zA-Z])\s*\}|([a-zA-Z]))/g, (_, a, b, c) => (b || c) + ACCENTS[a]);
  s = s.replace(/\\([cvuHkr])\s*(?:\{\s*([a-zA-Z])\s*\}|\s+([a-zA-Z]))/g, (_, a, b, c) => (b || c) + ACCENTS[a]);
  s = s.replace(/\{\\(?:em|it|itshape|sl)\s+([^{}]*)\}/g, '*$1*');
  s = s.replace(/\{\\(?:bf|bfseries)\s+([^{}]*)\}/g, '**$1**');
  s = s.replace(/\{\\(?:sc|scshape|rm|sf|tt|small|footnotesize)\s+([^{}]*)\}/g, '$1');
  for (let k = 0; k < 6; k++) {
    s = s
      .replace(/\\(?:emph|textit|textsl)\s*\{([^{}]*)\}/g, '*$1*')
      .replace(/\\textbf\s*\{([^{}]*)\}/g, '**$1**')
      .replace(/\\(?:thanks|footnote|label)\s*\{[^{}]*\}/g, '')
      .replace(/\\[a-zA-Z]+\*?\s*\{([^{}]*)\}/g, '$1');
  }
  s = s.replace(/\\[a-zA-Z]+\*?/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/~/g, ' ').replace(/---/g, '—').replace(/--/g, '–').replace(/``|''/g, '"');
  s = s.replace(/\s+/g, ' ').trim();
  for (let k = 0; k < 3 && s.includes('\u0000'); k++) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
  return s.normalize('NFC');
}

// ---------- flattening ----------

const INPUT_RE = /\\(input|include|subfile)\s*\{([^}]*)\}|\\(sub)?import\s*\{([^}]*)\}\s*\{([^}]*)\}|\\input\s+([^\s{}\\%]+)/g;

function resolveTex(name, dirs) {
  name = name.trim();
  for (const dir of dirs) {
    for (const cand of [name, `${name}.tex`]) {
      const p = path.resolve(dir, cand);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

function flatten(file, rootDir, stack, warnings, rel) {
  const text = removeDeadBlocks(stripComments(fs.readFileSync(file, 'utf8')));
  const fileDir = path.dirname(file);
  return text.replace(INPUT_RE, (match, cmd, name, sub, impDir, impFile, bare) => {
    let target;
    if (impFile !== undefined) target = resolveTex(impFile, [path.resolve(sub ? fileDir : rootDir, impDir)]);
    else target = resolveTex(name ?? bare, [rootDir, fileDir]);
    if (!target) {
      // Inputs of TeX-distribution files (e.g. glyphtounicode) are expected to be missing.
      if (!/glyphtounicode|^\s*$/.test(name ?? bare ?? impFile)) warnings.push(`unresolved ${match.trim()} in ${rel(file)}`);
      return match;
    }
    if (stack.includes(target)) {
      warnings.push(`recursive input skipped: ${rel(target)}`);
      return '';
    }
    return flatten(target, rootDir, [...stack, target], warnings, rel);
  });
}

function findMain(sourceDir, explicit) {
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.resolve(sourceDir, explicit);
    return fs.existsSync(p) ? { main: p, others: [] } : null;
  }
  const files = walk(sourceDir);
  const bblBases = new Set(files.filter((f) => /\.bbl$/i.test(f)).map((f) => f.replace(/\.bbl$/i, '')));
  const cands = files
    .filter((f) => /\.tex$/i.test(f))
    .filter((f) => {
      const t = stripComments(fs.readFileSync(f, 'utf8'));
      return /\\document(class|style)/.test(t) && /\\begin\s*\{document\}/.test(t);
    })
    .map((f) => {
      let score = 0;
      if (bblBases.has(f.replace(/\.tex$/i, ''))) score += 4;
      if (/^(main|ms|paper|manuscript|arxiv)\.tex$/i.test(path.basename(f))) score += 2;
      if (path.dirname(f) === sourceDir) score += 1;
      return { f, score, size: fs.statSync(f).size };
    })
    .sort((a, b) => b.score - a.score || b.size - a.size);
  if (!cands.length) return null;
  return { main: cands[0].f, others: cands.slice(1).map((c) => c.f) };
}

// ---------- macros ----------

function extractMacros(text) {
  const out = [];
  const re = /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|def|gdef|edef)(?![a-zA-Z])\*?/g;
  let m;
  while ((m = re.exec(text))) {
    let k = re.lastIndex;
    while (k < text.length && /\s/.test(text[k])) k++;
    let name;
    if (text[k] === '{') {
      const g = readGroup(text, k);
      if (!g) continue;
      name = g.text.trim();
      k = g.end;
    } else if (text[k] === '\\') {
      name = text.slice(k).match(/^\\([a-zA-Z@]+|.)/)[0];
      k += name.length;
    } else continue;
    if (name.includes('@')) continue;
    if (m[1].endsWith('def')) {
      const start = k;
      while (k < text.length && text[k] !== '{' && k - start < 40) k++;
    } else {
      for (let t = 0; t < 2; t++) {
        const o = readOpt(text, k);
        if (o.text === null) break;
        k = o.end;
      }
    }
    const body = readGroup(text, k);
    if (!body) continue;
    const def = text.slice(m.index, body.end).replace(/\s*\n\s*/g, ' ');
    if (def.length <= 400) out.push(def);
    re.lastIndex = body.end;
  }
  return out;
}

// ---------- bibliography ----------

function parseTheBibliography(text) {
  const start = text.search(/\\begin\{thebibliography\}/);
  const endIdx = text.search(/\\end\{thebibliography\}/);
  const body = text.slice(start, endIdx < 0 ? text.length : endIdx);
  const parts = body.split(/\\bibitem(?![a-zA-Z])/).slice(1);
  const entries = parts.map((part, idx) => {
    const opt = readOpt(part, 0);
    const key = readGroup(part, opt.end);
    let rest = key ? part.slice(key.end) : part.slice(opt.end);
    rest = rest.replace(/\\providecommand[\s\S]*$/, '');
    let label = null;
    let citeLabel = String(idx + 1);
    if (opt.text !== null) {
      label = opt.text.replace(/^\{([\s\S]*)\}$/, '$1').replace(/\{?\\natexlab\s*\{([^}]*)\}\}?/g, '$1');
      const ay = label.match(/^([\s\S]*?)\(([^()]*)\)/);
      citeLabel = cleanLatex(ay ? `${ay[1].trim()}, ${ay[2]}` : label);
    }
    return { n: idx + 1, key: key ? key.text.trim() : null, label, cite: citeLabel, text: cleanLatex(rest) };
  });
  const withOpt = entries.filter((e) => e.label !== null);
  let style = 'numeric';
  if (withOpt.length) {
    const authorYear = withOpt.filter((e) => /^[^()]+\([^()]*\)/.test(e.label)).length;
    style = authorYear >= 0.8 * withOpt.length ? 'author-year' : 'custom-label';
  }
  return { style, entries };
}

function biblatexNames(block) {
  const names = [];
  const re = /family=\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let m;
  const starts = [];
  while ((m = re.exec(block))) starts.push(m);
  starts.forEach((fm, i) => {
    const seg = block.slice(fm.index, i + 1 < starts.length ? starts[i + 1].index : block.length);
    const given = seg.match(/(?:^|[\s,])given=\{((?:[^{}]|\{[^{}]*\})*)\}/);
    names.push(cleanLatex(given ? `${given[1]} ${fm[1]}` : fm[1]));
  });
  return names;
}

function parseBiblatex(text) {
  const entries = [];
  const re = /\\entry\{([^}]*)\}\{([^}]*)\}[\s\S]*?\\endentry/g;
  let m;
  while ((m = re.exec(text))) {
    const block = m[0];
    const field = (name) => {
      const idx = block.search(new RegExp(`\\\\field\\{${name}\\}`));
      if (idx < 0) return null;
      const g = readGroup(block, idx + `\\field{${name}}`.length);
      return g ? cleanLatex(g.text) : null;
    };
    const nameIdx = block.search(/\\name\{author\}/);
    let authors = [];
    if (nameIdx >= 0) {
      let k = nameIdx + '\\name{author}'.length;
      const count = readGroup(block, k);
      k = count ? count.end : k;
      const empty = readGroup(block, k);
      k = empty ? empty.end : k;
      const list = readGroup(block, k);
      if (list) authors = biblatexNames(list.text);
    }
    const url = block.match(/\\verb\{url\}\s*\\verb\s+(\S+)/);
    const venue = field('journaltitle') || field('booktitle') || field('eprinttype');
    const pieces = [
      authors.join(', '),
      field('year'),
      field('title'),
      [venue, field('volume') && `${field('volume')}${field('number') ? `(${field('number')})` : ''}`, field('pages')].filter(Boolean).join(', '),
      field('eprint') && (field('eprinttype') || 'arXiv') !== field('eprint') ? `${field('eprinttype') || 'arXiv'}:${field('eprint')}` : null,
      url ? `<${url[1]}>` : null,
    ].filter(Boolean);
    entries.push({ n: entries.length + 1, key: m[1], label: field('labelalpha'), cite: null, text: pieces.join('. ').replace(/\.\./g, '.') });
  }
  return { style: entries.some((e) => e.label) ? 'custom-label' : 'biblatex', entries };
}

function findBibliography(flat, mainFile, sourceDir) {
  if (/\\begin\{thebibliography\}/.test(flat)) return { source: 'inline thebibliography', ...parseTheBibliography(flat) };
  const bbls = walk(sourceDir).filter((f) => /\.bbl$/i.test(f));
  if (!bbls.length) return null;
  const same = mainFile.replace(/\.tex$/i, '.bbl');
  const pick = bbls.find((f) => f === same) ?? bbls.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  const text = stripComments(fs.readFileSync(pick, 'utf8'));
  const source = posix(path.relative(sourceDir, pick));
  if (/\\begin\{thebibliography\}/.test(text)) return { source, ...parseTheBibliography(text) };
  if (/\\entry\{/.test(text)) return { source, ...parseBiblatex(text) };
  return null;
}

function referencesMarkdown(bib) {
  const lines = ['## References', ''];
  for (const e of bib.entries) {
    if (bib.style === 'numeric' || bib.style === 'biblatex') lines.push(`[${e.n}] ${e.text}`, '');
    else if (bib.style === 'custom-label') lines.push(`[${e.label ? cleanLatex(e.label) : e.n}] ${e.text}`, '');
    else lines.push(`- ${e.text}`);
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}

// ---------- structure scan ----------

const FLOAT_TYPES = { figure: 'figure', wrapfigure: 'figure', SCfigure: 'figure', table: 'table', wraptable: 'table', SCtable: 'table', algorithm: 'algorithm' };
const MATH_ENVS = new Set(['equation', 'align', 'gather', 'multline', 'eqnarray', 'flalign', 'alignat', 'xalignat']);
const MULTI_ROW = new Set(['align', 'gather', 'eqnarray', 'flalign', 'alignat', 'xalignat']);
const MD_IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;

const letter = (n) => (n <= 26 ? String.fromCharCode(64 + n) : `A${String.fromCharCode(64 + n - 26)}`);

function parseTheorems(text) {
  const theorems = {};
  const within = [];
  let m;
  const NEWTHM = /\\newtheorem(\*?)\s*\{([^}]+)\}\s*(?:\[([^\]]+)\])?\s*\{([^}]+)\}\s*(?:\[([^\]]+)\])?/g;
  while ((m = NEWTHM.exec(text))) {
    const [, star, name, shared, title, parent] = m;
    theorems[name.trim()] = { title: cleanLatex(title), counter: (shared ?? name).trim(), starred: !!star };
    if (parent && !shared) within.push([name.trim(), parent.trim()]);
  }
  const DECL = /\\declaretheorem\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g;
  while ((m = DECL.exec(text))) {
    const opts = Object.fromEntries((m[1] ?? '').split(',').map((kv) => kv.split('=').map((x) => x.trim())).filter((kv) => kv[0]));
    const name = m[2].trim();
    const title = opts.name ?? opts.title ?? name.charAt(0).toUpperCase() + name.slice(1);
    theorems[name] = { title, counter: opts.sibling ?? opts.sharenumber ?? name, starred: opts.numbered === 'no' };
    if (opts.numberwithin ?? opts.parent) within.push([name, opts.numberwithin ?? opts.parent]);
  }
  return { theorems, within };
}

function scan(flat, ctx) {
  const lineStarts = [0];
  for (let i = 0; i < flat.length; i++) if (flat[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (idx) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const docStart = Math.max(0, flat.search(/\\begin\s*\{document\}/));
  let docEnd = flat.search(/\\end\s*\{document\}/);
  if (docEnd < 0) docEnd = flat.length;
  const preamble = flat.slice(0, docStart);

  const { theorems, within: thmWithin } = parseTheorems(flat);
  const hasChapter = /\\chapter\*?\s*[{[]/.test(flat.slice(docStart, docEnd));
  const within = new Map(thmWithin);
  const NUMBERWITHIN = /\\(?:numberwithin|counterwithin\*?)\s*\{([^}]+)\}\s*\{([^}]+)\}/g;
  let nw;
  while ((nw = NUMBERWITHIN.exec(flat))) within.set(nw[1].trim(), nw[2].trim());
  if (hasChapter) for (const c of ['figure', 'table', 'equation']) if (!within.has(c)) within.set(c, 'chapter');

  const counters = new Map();
  let inAppendix = false;
  const display = (counter) => {
    const v = counters.get(counter) || 0;
    if (counter === 'chapter') return inAppendix ? letter(v) : String(v);
    if (counter === 'section') return hasChapter ? `${display('chapter')}.${v}` : inAppendix ? letter(v) : String(v);
    if (counter === 'subsection') return `${display('section')}.${v}`;
    if (counter === 'subsubsection') return `${display('subsection')}.${v}`;
    const parent = within.get(counter);
    return parent ? `${display(parent)}.${v}` : String(v);
  };
  const reset = (counter) => {
    for (const [c, p] of within) if (p === counter) counters.set(c, 0);
    const children = { chapter: ['section'], section: ['subsection'], subsection: ['subsubsection'] }[counter] ?? [];
    for (const c of children) {
      counters.set(c, 0);
      reset(c);
    }
  };
  const step = (counter) => {
    counters.set(counter, (counters.get(counter) || 0) + 1);
    reset(counter);
  };

  const graphicsDirs = [];
  const gp = preamble.match(/\\graphicspath\s*\{((?:\s*\{[^}]*\})+)\s*\}/);
  if (gp) for (const d of gp[1].matchAll(/\{([^}]*)\}/g)) graphicsDirs.push(d[1]);

  const resolveImage = (name, line) => {
    name = name.replace(/[{}"]/g, '').trim();
    const dirs = [ctx.mainDir, ...graphicsDirs.map((d) => path.resolve(ctx.mainDir, d))];
    const ext = path.extname(name).toLowerCase();
    const stem = ext ? name.slice(0, -ext.length) : name;
    const order = ext === '.pdf' || ext === '.eps' || ext === '.ps' ? ['.png', ext] : ext ? [ext] : ['.png', '.pdf', '.jpg', '.jpeg', '.eps'];
    for (const dir of dirs) {
      for (const e of order) {
        const p = path.resolve(dir, stem + e);
        if (!fs.existsSync(p)) continue;
        if (e === '.pdf' && fs.existsSync(FIGURE_TO_PNG)) {
          const png = p.replace(/\.pdf$/i, '.png');
          spawnSync(process.execPath, [FIGURE_TO_PNG, p, '--out', png], { stdio: 'ignore' });
          if (fs.existsSync(png)) return { tex: name, line, status: 'ok', path: posix(path.relative(ctx.paperDir, png)) };
        }
        const relp = posix(path.relative(ctx.paperDir, p));
        return { tex: name, line, status: MD_IMAGE.test(p) ? 'ok' : `unsupported ${e}`, path: relp };
      }
    }
    return { tex: name, line, status: 'missing', path: null };
  };

  const sections = [];
  const floats = [];
  const images = [];
  const labels = {};
  const envStack = [];
  let lastSection = null;
  let equations = 0;
  const marks = { abstractLine: null, appendixLine: null, bibLine: null, docStartLine: lineAt(docStart), docEndLine: lineAt(docEnd) };
  const titleMatch = flat.match(/\\(?:title|icmltitle)\s*(?:\[[^\]]*\])?\s*\{/);
  const titleGroup = titleMatch ? readGroup(flat, titleMatch.index + titleMatch[0].length - 1) : null;
  const title = titleGroup ? cleanLatex(titleGroup.text) : null;
  const titleLine = titleMatch ? lineAt(titleMatch.index) : null;

  const innermost = (pred) => {
    for (let k = envStack.length - 1; k >= 0; k--) if (pred(envStack[k])) return envStack[k];
    return null;
  };

  const sectionLabel = (line) =>
    lastSection
      ? { type: lastSection.appendix && (lastSection.level === 'section' || lastSection.level === 'chapter') ? 'appendix' : lastSection.level, number: lastSection.number, line }
      : { type: 'unknown', number: null, line };

  const attachLabel = (key, line) => {
    for (let k = envStack.length - 1; k >= 0; k--) {
      const env = envStack[k];
      if (env.kind === 'math') {
        if (env.numbered || env.tag != null) {
          env.pending.push(key);
          return;
        }
        continue;
      }
      if (env.kind === 'sub') {
        env.labels.push(key);
        return;
      }
      if (env.kind === 'float') {
        if (env.current) labels[key] = { type: env.type, number: env.current.number, line };
        else env.pending.push(key);
        return;
      }
      if (env.kind === 'theorem') {
        labels[key] = { type: 'theorem', name: env.title, number: env.number, line };
        return;
      }
    }
    labels[key] = sectionLabel(line);
  };

  const finishRow = (env, pos, line) => {
    const content = flat.slice(env.rowStart, pos).replace(/\\(?:nonumber|notag)(?![a-zA-Z])|\\label\s*\{[^}]*\}|\\tag\*?\s*\{[^}]*\}/g, '');
    const blankTrailingRow = env.multi && !content.trim();
    let number = null;
    if (env.tag != null) number = env.tag;
    else if (env.numbered && !env.nonumber && !blankTrailingRow) {
      step('equation');
      equations++;
      number = display('equation');
    }
    for (const key of env.pending) labels[key] = { type: 'equation', number, line };
    env.pending = [];
    env.tag = null;
    env.nonumber = false;
  };

  const closeEnv = (env, pos, line) => {
    if (env.kind === 'math') finishRow(env, pos, line);
    else if (env.kind === 'sub') innermost((e) => e.kind === 'float')?.subs.push(env);
    else if (env.kind === 'float') {
      const last = env.current;
      for (const s of env.subs) for (const key of s.labels) labels[key] = { type: env.type, number: last ? `${last.number}${s.letter ?? ''}` : null, line: s.line };
      for (const key of env.pending) labels[key] = { type: env.type, number: null, line: env.line };
      floats.push({ type: env.type, line: env.line, endLine: line, items: env.items, images: env.images });
    }
  };

  const TOKEN_RE = /\\(chapter|section|subsection|subsubsection|paragraph)(?![a-zA-Z])(\*?)|\\(appendix|label|caption|includegraphics|begin|end|bibliography|printbibliography|nonumber|notag|tag|setcounter|renewcommand)(?![a-zA-Z])\*?|\\\\/g;
  TOKEN_RE.lastIndex = docStart;
  let m;
  while ((m = TOKEN_RE.exec(flat)) && m.index < docEnd) {
    const after = TOKEN_RE.lastIndex;
    const line = lineAt(m.index);
    if (m[1]) {
      const level = m[1];
      const starred = m[2] === '*';
      const opt = readOpt(flat, after);
      const g = readGroup(flat, opt.end);
      let number = null;
      if (!starred && level !== 'paragraph') {
        step(level);
        number = display(level);
      }
      lastSection = { level, starred, number, title: g ? cleanLatex(g.text) : '', line, appendix: inAppendix };
      sections.push(lastSection);
      continue;
    }
    if (!m[3]) {
      const top = envStack[envStack.length - 1];
      if (top?.kind === 'math' && top.multi) {
        finishRow(top, m.index, line);
        const o = readOpt(flat, after);
        top.rowStart = o.end;
        TOKEN_RE.lastIndex = o.end;
      }
      continue;
    }
    switch (m[3]) {
      case 'appendix':
        if (!inAppendix) marks.appendixLine = line;
        inAppendix = true;
        counters.set(hasChapter ? 'chapter' : 'section', 0);
        reset(hasChapter ? 'chapter' : 'section');
        break;
      case 'setcounter': {
        const a = readGroup(flat, after);
        const b = a && readGroup(flat, a.end);
        if (b && /^\d+$/.test(b.text.trim())) counters.set(a.text.trim(), Number(b.text.trim()));
        break;
      }
      case 'renewcommand': {
        const rest = flat.slice(after, after + 60);
        if (/^\s*\{?\\the(section|chapter)\}?\s*\{\s*\\Alph/.test(rest) && !inAppendix) {
          inAppendix = true;
          marks.appendixLine = line;
        }
        break;
      }
      case 'label': {
        const g = readGroup(flat, after);
        if (g) attachLabel(g.text.trim(), line);
        break;
      }
      case 'caption': {
        const opt = readOpt(flat, after);
        const g = readGroup(flat, opt.end);
        const env = innermost((e) => e.kind === 'float' || e.kind === 'sub');
        if (!env) break;
        if (env.kind === 'sub') {
          const parent = innermost((e) => e.kind === 'float');
          if (parent) {
            parent.subCount = (parent.subCount || 0) + 1;
            env.letter = String.fromCharCode(96 + parent.subCount);
          }
          break;
        }
        step(env.type);
        const item = { number: display(env.type), caption: g ? cleanLatex(g.text).slice(0, 90) : '', line };
        env.items.push(item);
        env.current = item;
        for (const key of env.pending.splice(0)) labels[key] = { type: env.type, number: item.number, line };
        break;
      }
      case 'includegraphics': {
        const opt = readOpt(flat, after);
        const g = readGroup(flat, opt.end);
        if (!g) break;
        const img = resolveImage(g.text, line);
        images.push(img);
        innermost((e) => e.kind === 'float')?.images.push(img);
        break;
      }
      case 'begin': {
        const g = readGroup(flat, after);
        if (!g) break;
        const name = g.text.trim();
        const base = name.replace(/\*$/, '');
        let env = { name, kind: 'other', line };
        if (FLOAT_TYPES[base]) env = { name, kind: 'float', type: FLOAT_TYPES[base], line, items: [], pending: [], subs: [], images: [], current: null };
        else if (/^sub(figure|table)$/.test(base)) env = { name, kind: 'sub', line, labels: [], letter: null };
        else if (MATH_ENVS.has(base)) env = { name, kind: 'math', numbered: !name.endsWith('*'), multi: MULTI_ROW.has(base), pending: [], tag: null, nonumber: false, rowStart: g.end, line };
        else if (theorems[base] && !theorems[base].starred) {
          step(theorems[base].counter);
          env = { name, kind: 'theorem', title: theorems[base].title, number: display(theorems[base].counter), line };
        } else if (base === 'abstract') marks.abstractLine ??= line;
        else if (base === 'thebibliography') marks.bibLine ??= line;
        else if (base === 'appendices' && !inAppendix) {
          inAppendix = true;
          marks.appendixLine = line;
          counters.set(hasChapter ? 'chapter' : 'section', 0);
          reset(hasChapter ? 'chapter' : 'section');
        }
        envStack.push(env);
        TOKEN_RE.lastIndex = g.end;
        break;
      }
      case 'end': {
        const g = readGroup(flat, after);
        if (!g) break;
        if (g.text.trim() === 'thebibliography') marks.bibEndLine ??= line;
        const idx = envStack.map((e) => e.name).lastIndexOf(g.text.trim());
        if (idx < 0) break;
        while (envStack.length > idx) closeEnv(envStack.pop(), m.index, line);
        TOKEN_RE.lastIndex = g.end;
        break;
      }
      case 'bibliography':
      case 'printbibliography':
        marks.bibLine ??= line;
        break;
      case 'nonumber':
      case 'notag': {
        const env = innermost((e) => e.kind === 'math');
        if (env) env.nonumber = true;
        break;
      }
      case 'tag': {
        const g = readGroup(flat, after);
        const env = innermost((e) => e.kind === 'math');
        if (g && env) env.tag = g.text.trim();
        break;
      }
    }
  }
  while (envStack.length) closeEnv(envStack.pop(), docEnd, lineAt(docEnd));

  // The bibliography gets its own row so no section range swallows it; the translation replaces it with references.md.
  if (marks.bibLine) {
    const bib = { level: 'bibliography', starred: true, number: null, title: '(bibliography — do not translate; use work/references.md as the last part)', line: marks.bibLine, appendix: inAppendix, bibEndLine: marks.bibEndLine ?? marks.bibLine };
    const at = sections.findIndex((s) => s.line > marks.bibLine);
    sections.splice(at < 0 ? sections.length : at, 0, bib);
  }
  sections.forEach((s, i) => {
    const next = (i + 1 < sections.length ? sections[i + 1].line : marks.docEndLine) - 1;
    s.endLine = s.level === 'bibliography' ? Math.min(next, s.bibEndLine) : next;
  });

  return { title, titleLine, marks, sections, floats, images, labels, equations, hasChapter };
}

// ---------- output ----------

function outlineMarkdown(o) {
  const L = [];
  const mk = o.marks;
  L.push(`# Outline: ${o.title ?? '(title not found)'}`, '');
  L.push(`- main: \`${o.main}\` → flattened into \`work/flat.tex\` (${o.lines} lines)`);
  if (o.titleLine) L.push(`- title: flat.tex line ${o.titleLine}`);
  const firstSection = o.sections[0]?.line ?? mk.docEndLine;
  L.push(`- front matter (title/authors/abstract/teaser): lines ${mk.docStartLine}–${firstSection - 1}${mk.abstractLine ? ` (abstract at ${mk.abstractLine})` : ''}`);
  L.push(`- appendix starts: ${mk.appendixLine ? `line ${mk.appendixLine}` : 'none detected'}`);
  if (o.bibliography) {
    const where = mk.bibLine ? `at line ${mk.bibLine}${mk.appendixLine && mk.bibLine < mk.appendixLine ? ' (before the appendix → move it to the end)' : ''}` : '';
    L.push(`- bibliography: ${o.bibliography.entries} entries, ${o.bibliography.style} style, from \`${o.bibliography.source}\` ${where} → \`work/references.md\``);
  } else L.push('- bibliography: **not found in source** — take the reference list from the PDF (see references/pdf-fallback.md)');
  L.push(`- macros: ${o.macroCount} definitions → \`work/macros.tex\``);
  L.push(`- labels: ${Object.keys(o.labels).length} → \`work/labels.json\` (${o.equations} numbered equations; numbering is best-effort, confirm odd ones against the PDF)`);
  if (o.otherMains.length) L.push(`- other candidate main files (re-run with --main if the choice is wrong): ${o.otherMains.map((f) => `\`${f}\``).join(', ')}`);
  L.push('', '## Sections', '', '| number | level | title | flat.tex lines | appendix |', '|---|---|---|---|---|');
  for (const s of o.sections) L.push(`| ${s.number ?? (s.starred ? '(unnumbered)' : '')} | ${s.level} | ${s.title.replace(/\|/g, '\\|')} | ${s.line}–${s.endLine} | ${s.appendix ? 'yes' : ''} |`);
  L.push('', '## Floats', '');
  for (const f of o.floats) {
    const nums = f.items.map((it) => `${f.type} ${it.number}`).join(', ') || `${f.type} (no caption)`;
    L.push(`- **${nums}** — lines ${f.line}–${f.endLine}: ${f.items.map((it) => it.caption).join(' / ')}`);
    for (const img of f.images) L.push(`  - \`${img.tex}\` → ${img.path ? `\`${img.path}\`` : '—'} [${img.status}]`);
    for (const it of f.items) if (f.type === 'table' && it.imageStatus) L.push(`  - rendered table ${it.number} → ${it.image ? `\`${it.image}\`` : '—'} [${it.imageStatus}]`);
  }
  const loose = o.images.filter((img) => !o.floats.some((f) => f.images.includes(img)));
  if (loose.length) {
    L.push('', '## Images outside floats', '');
    for (const img of loose) L.push(`- line ${img.line}: \`${img.tex}\` → ${img.path ? `\`${img.path}\`` : '—'} [${img.status}]`);
  }
  if (o.warnings.length) {
    L.push('', '## Warnings', '');
    for (const w of o.warnings) L.push(`- ${w}`);
  }
  return `${L.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }
  const paperDir = resolvePaperDir(args[0]);
  const sourceDir = path.join(paperDir, 'source');
  const workDir = path.join(paperDir, 'work');
  const rel = (p) => posix(path.relative(paperDir, p));

  const found = findMain(sourceDir, argValue(args, '--main', null));
  if (!found) {
    const pdf = path.join(paperDir, 'paper.pdf');
    console.error(`No LaTeX main file under ${rel(sourceDir) || sourceDir}.`);
    console.error(fs.existsSync(pdf) ? `Use PDF mode with ${rel(pdf)} (see references/pdf-fallback.md).` : 'Download the paper first with the arxiv-download skill.');
    process.exit(2);
  }

  const warnings = [];
  const flat = flatten(found.main, path.dirname(found.main), [found.main], warnings, rel);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'flat.tex'), flat);

  const result = scan(flat, { mainDir: path.dirname(found.main), paperDir });
  for (const img of result.images) if (img.status !== 'ok') warnings.push(`image ${img.status}: \`${img.tex}\` (line ${img.line})`);

  const macros = extractMacros(flat);
  fs.writeFileSync(path.join(workDir, 'macros.tex'), `${macros.join('\n')}\n`);
  fs.writeFileSync(path.join(workDir, 'labels.json'), `${JSON.stringify(result.labels, null, 1)}\n`);

  const bib = findBibliography(flat, found.main, sourceDir);
  const refPath = path.join(workDir, 'references.md');
  if (bib && bib.entries.length) {
    fs.writeFileSync(refPath, referencesMarkdown(bib));
    fs.writeFileSync(path.join(workDir, 'references.json'), `${JSON.stringify(bib.entries, null, 1)}\n`);
  } else fs.rmSync(refPath, { force: true });

  const outline = {
    paperDir: posix(path.relative(process.cwd(), paperDir)),
    main: rel(found.main),
    otherMains: found.others.map(rel),
    lines: flat.split('\n').length,
    ...result,
    macroCount: macros.length,
    bibliography: bib && bib.entries.length ? { style: bib.style, entries: bib.entries.length, source: bib.source } : null,
    warnings,
  };
  fs.writeFileSync(path.join(workDir, 'outline.json'), `${JSON.stringify(outline, null, 1)}\n`);

  // Tables are shown as crops of the compiled PDF, so they look exactly as TeX typeset them.
  const pdfPath = path.join(paperDir, 'paper.pdf');
  if (result.floats.some((f) => f.type === 'table')) {
    if (fs.existsSync(pdfPath)) {
      const crop = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'crop-tables.mjs'), paperDir], { encoding: 'utf8' });
      const tablesPath = path.join(workDir, 'tables.json');
      const tables = crop.status === 0 && fs.existsSync(tablesPath) ? JSON.parse(fs.readFileSync(tablesPath, 'utf8')) : [];
      if (crop.status !== 0) warnings.push(`table cropping failed: ${(crop.stderr || '').trim().split('\n').pop()}`);
      for (const f of result.floats.filter((x) => x.type === 'table')) {
        for (const item of f.items) {
          const t = tables.find((x) => x.number === item.number);
          item.image = t?.path ?? null;
          item.imageStatus = t?.status ?? 'not cropped';
          if (!item.image) warnings.push(`table ${item.number} could not be cropped from paper.pdf — write it as a Markdown table`);
        }
      }
      fs.writeFileSync(path.join(workDir, 'outline.json'), `${JSON.stringify(outline, null, 1)}\n`);
    } else warnings.push('paper.pdf not found — tables cannot be cropped; write them as Markdown tables (or download the PDF and re-run)');
  }
  fs.writeFileSync(path.join(workDir, 'outline.md'), outlineMarkdown(outline));

  const numbered = result.sections.filter((s) => s.number);
  console.log(`Main file: ${outline.main}`);
  console.log(`Wrote ${rel(workDir)}/: flat.tex (${outline.lines} lines), outline.md, outline.json, labels.json, macros.tex${bib ? ', references.md' : ''}`);
  console.log(`Sections: ${result.sections.length} (${numbered.length} numbered), floats: ${result.floats.length}, images: ${result.images.length}, equations: ${result.equations}`);
  console.log(`Bibliography: ${outline.bibliography ? `${outline.bibliography.entries} entries (${outline.bibliography.style})` : 'not found'}`);
  if (warnings.length) console.log(`Warnings: ${warnings.length} (see outline.md)`);
}

main();
