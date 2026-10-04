#!/usr/bin/env node
// Crops each table out of the compiled paper.pdf so the translation can show the table exactly as TeX typeset it.
// Locates "Table N:" captions and the table's cell text (taken from flat.tex) in the PDF text layer, then grows the
// box over the rendered pixels to pick up rules. Writes <paper-dir>/tables/table-<N>.png and work/tables.json.
// Run after prepare.mjs (needs work/outline.json and work/flat.tex). prepare.mjs calls it when paper.pdf exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ARXIV_MODULES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../arxiv-download/node_modules');
const PDFJS = path.join(ARXIV_MODULES, 'pdfjs-dist/legacy/build/pdf.mjs');

function usage() {
  console.log('Usage: crop-tables.mjs <paper-dir> [--scale N] [--with-caption]');
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
}

const STOP = new Set(['the', 'and', 'of', 'on', 'in', 'to', 'for', 'a', 'an', 'with', 'is', 'are', 'we', 'by', 'at', 'as', 'or', 'from', 'that', 'this', 'our']);

function tokens(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.%±+-]+/)
    .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ''))
    .filter((t) => t && !STOP.has(t) && (t.length >= 2 || /\d/.test(t)));
}

// Words and numbers that appear in the table's cells, from the TeX source of the float.
function cellTokens(flatLines, float) {
  let src = flatLines.slice(float.line - 1, float.endLine).join('\n');
  const tab = src.match(/\\begin\{(tabular\*?|tabularx|longtable|tabu)\}[\s\S]*\\end\{\1\}/);
  if (tab) src = tab[0];
  src = src
    .replace(/\\caption\s*(\[[^\]]*\])?\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, ' ')
    .replace(/\\(cite[a-zA-Z]*|label|ref|eqref|cref)\s*\{[^}]*\}/g, ' ')
    .replace(/\\(multicolumn|multirow)\s*\{[^}]*\}\s*\{[^}]*\}/g, ' ')
    .replace(/\\begin\{[^}]*\}(\{[^}]*\})*|\\end\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}$&\\^_~]/g, ' ');
  return new Set(tokens(src));
}

// Text items -> horizontal segments (pieces of a line separated by wide gaps), in viewport pixels.
function segments(items, viewport, scale) {
  const glyphs = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = Math.max(Math.hypot(it.transform[2], it.transform[3]), it.height || 0, 4) * scale;
      return { str: it.str, x0: x, x1: x + it.width * scale, base: y, h };
    })
    .sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const segs = [];
  for (const g of glyphs) {
    const seg = segs.find((s) => Math.abs(s.base - g.base) < 0.45 * Math.min(s.h, g.h) && g.x0 - s.x1 < 1.2 * g.h && g.x0 > s.x0 - g.h);
    if (seg) {
      seg.str += (g.x0 - seg.x1 > 0.15 * g.h ? ' ' : '') + g.str;
      seg.x1 = Math.max(seg.x1, g.x1);
      seg.h = Math.max(seg.h, g.h);
    } else segs.push({ ...g });
  }
  for (const s of segs) {
    s.top = s.base - 0.8 * s.h;
    s.bottom = s.base + 0.25 * s.h;
  }
  return segs.sort((a, b) => a.top - b.top || a.x0 - b.x0);
}

const overlapX = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;

function locate(segs, number, cells) {
  const capRe = new RegExp(`^\\s*(Table|TABLE|Tab\\.)\\s*${number.replace('.', '\\.')}\\s*[:.|]`);
  const caption = segs.find((s) => capRe.test(s.str));
  if (!caption) return null;
  const isCell = (s) => {
    const w = tokens(s.str);
    return w.length > 0 && w.filter((t) => cells.has(t)).length / w.length >= 0.6;
  };
  // Caption block: the caption line plus the lines that continue it directly below.
  const capBlock = [caption];
  for (;;) {
    const last = capBlock[capBlock.length - 1];
    // Continuation lines sit at normal line spacing and start at the caption's left edge; table rows are further away
    // and usually not left-aligned with it. Cell-likeness can't be used here: a caption may mention cell words ("of WSJ)").
    const next = segs.find((s) => !capBlock.includes(s) && s.top > last.top && s.top - last.bottom < 0.35 * last.h && Math.abs(s.x0 - caption.x0) < last.h);
    if (!next) break;
    capBlock.push(next);
  }
  const cap = { top: Math.min(...capBlock.map((s) => s.top)), bottom: Math.max(...capBlock.map((s) => s.bottom)), x0: Math.min(...capBlock.map((s) => s.x0)), x1: Math.max(...capBlock.map((s) => s.x1)) };
  const cellSegs = segs.filter((s) => !capBlock.includes(s) && isCell(s));
  const h = caption.h;
  const below = cellSegs.filter((s) => s.top >= cap.bottom - 1 && s.top - cap.bottom < 4 * h);
  const above = cellSegs.filter((s) => s.bottom <= cap.top + 1 && cap.top - s.bottom < 4 * h);
  const down = below.length >= above.length;
  if (!below.length && !above.length) return null;
  // Grow away from the caption while cell-like segments keep coming within a couple of line heights.
  const table = [...(down ? below : above)];
  let edge = down ? Math.max(...table.map((s) => s.bottom)) : Math.min(...table.map((s) => s.top));
  for (;;) {
    const more = cellSegs.filter((s) => !table.includes(s) && (down ? s.top >= edge - 1 && s.top - edge < 2.5 * h : s.bottom <= edge + 1 && edge - s.bottom < 2.5 * h));
    if (!more.length) break;
    table.push(...more);
    edge = down ? Math.max(edge, ...more.map((s) => s.bottom)) : Math.min(edge, ...more.map((s) => s.top));
  }
  const box = { top: Math.min(...table.map((s) => s.top)), bottom: Math.max(...table.map((s) => s.bottom)), x0: Math.min(...table.map((s) => s.x0)), x1: Math.max(...table.map((s) => s.x1)) };
  // Text outside the table that the pixel growth must not run into (caption, body text).
  const fences = segs.filter((s) => !table.includes(s) && overlapX(s, box) && (s.bottom <= box.top || s.top >= box.bottom) && !(s.top >= box.top && s.bottom <= box.bottom));
  return { caption: cap, box, fences, down, h };
}

function inkRow(data, width, y, x0, x1) {
  for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
    const i = (y * width + x) * 4;
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) return true;
  }
  return false;
}

function inkCol(data, width, x, y0, y1) {
  for (let y = y0; y < y1; y++) {
    const i = (y * width + x) * 4;
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) return true;
  }
  return false;
}

// Extends the text box over adjacent ink (rules, math that the text layer missed), stopping at blank gaps and fences.
function refine(found, img, scale, withCaption) {
  const { data, width, height } = img;
  const gap = Math.round(4 * scale);
  let { top, bottom, x0, x1 } = found.box;
  if (withCaption) {
    top = Math.min(top, found.caption.top);
    bottom = Math.max(bottom, found.caption.bottom);
    x0 = Math.min(x0, found.caption.x0);
    x1 = Math.max(x1, found.caption.x1);
  }
  top = Math.floor(top);
  bottom = Math.ceil(bottom);
  x0 = Math.floor(x0);
  x1 = Math.ceil(x1);
  const fenceAbove = Math.max(0, ...found.fences.filter((s) => s.bottom <= top).map((s) => Math.ceil(s.bottom) + 1), withCaption || !found.down ? 0 : Math.ceil(found.caption.bottom) + 1);
  const fenceBelow = Math.min(height - 1, ...found.fences.filter((s) => s.top >= bottom).map((s) => Math.floor(s.top) - 1), withCaption || found.down ? height - 1 : Math.floor(found.caption.top) - 1);
  const pad = Math.round(found.h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = top - 1, blank = 0; y > fenceAbove && blank <= gap; y--) {
      if (inkRow(data, width, y, x0 - pad, x1 + pad)) {
        top = y;
        blank = 0;
      } else blank++;
    }
    for (let y = bottom + 1, blank = 0; y < fenceBelow && blank <= gap; y++) {
      if (inkRow(data, width, y, x0 - pad, x1 + pad)) {
        bottom = y;
        blank = 0;
      } else blank++;
    }
    for (let x = x0 - 1, blank = 0; x > 0 && blank <= gap; x--) {
      if (inkCol(data, width, x, top, bottom)) {
        x0 = x;
        blank = 0;
      } else blank++;
    }
    for (let x = x1 + 1, blank = 0; x < width - 1 && blank <= gap; x++) {
      if (inkCol(data, width, x, top, bottom)) {
        x1 = x;
        blank = 0;
      } else blank++;
    }
  }
  const margin = Math.round(3 * scale);
  const y0 = Math.max(top - margin, fenceAbove, 0);
  const y1 = Math.min(bottom + margin, fenceBelow, height);
  const xa = Math.max(0, x0 - margin);
  return { x: xa, y: y0, w: Math.min(width, x1 + margin) - xa, h: y1 - y0 };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }
  const paperDir = path.resolve(args[0]);
  const scale = Number(argValue(args, '--scale', '3')) || 3;
  const withCaption = args.includes('--with-caption');
  const pdfPath = path.join(paperDir, 'paper.pdf');
  const outline = JSON.parse(fs.readFileSync(path.join(paperDir, 'work', 'outline.json'), 'utf8'));
  const flatLines = fs.readFileSync(path.join(paperDir, 'work', 'flat.tex'), 'utf8').split('\n');
  if (!fs.existsSync(pdfPath)) {
    console.error(`No ${pdfPath}; download the PDF with arxiv-download --pdf first.`);
    process.exit(2);
  }
  if (!fs.existsSync(PDFJS)) {
    console.error('pdfjs-dist is missing; run any arxiv-download figure conversion once to install it.');
    process.exit(2);
  }

  const pdfjs = await import(pathToFileURL(PDFJS).href);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
    standardFontDataUrl: path.join(ARXIV_MODULES, 'pdfjs-dist/standard_fonts/'),
    cMapUrl: path.join(ARXIV_MODULES, 'pdfjs-dist/cmaps/'),
    cMapPacked: true,
    isEvalSupported: false,
  }).promise;

  const pages = new Map();
  const loadPage = async (n) => {
    if (!pages.has(n)) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const text = await page.getTextContent();
      pages.set(n, { page, viewport, segs: segments(text.items, viewport, scale), img: null, canvas: null });
    }
    return pages.get(n);
  };
  const render = async (p) => {
    if (!p.img) {
      const { canvas, context } = doc.canvasFactory.create(Math.ceil(p.viewport.width), Math.ceil(p.viewport.height));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await p.page.render({ canvasContext: context, canvas, viewport: p.viewport }).promise;
      p.canvas = canvas;
      p.img = context.getImageData(0, 0, canvas.width, canvas.height);
    }
    return p;
  };

  const outDir = path.join(paperDir, 'tables');
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const float of outline.floats.filter((f) => f.type === 'table')) {
    const cells = cellTokens(flatLines, float);
    for (const item of float.items) {
      let hit = null;
      for (let n = 1; n <= doc.numPages && !hit; n++) {
        const p = await loadPage(n);
        const found = locate(p.segs, item.number, cells);
        if (found) hit = { n, p, found };
      }
      if (!hit) {
        results.push({ number: item.number, status: 'not found', path: null });
        console.log(`table ${item.number}: not found in PDF — convert it to a Markdown table instead`);
        continue;
      }
      const p = await render(hit.p);
      const r = refine(hit.found, p.img, scale, withCaption);
      const { canvas, context } = doc.canvasFactory.create(r.w, r.h);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, r.w, r.h);
      context.drawImage(p.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const file = path.join(outDir, `table-${item.number}.png`);
      fs.writeFileSync(file, canvas.toBuffer('image/png'));
      const rel = path.relative(paperDir, file).split(path.sep).join('/');
      results.push({ number: item.number, status: 'ok', path: rel, page: hit.n });
      console.log(`table ${item.number}: page ${hit.n} → ${rel} (${r.w}×${r.h})`);
    }
  }
  fs.writeFileSync(path.join(paperDir, 'work', 'tables.json'), `${JSON.stringify(results, null, 1)}\n`);
  await doc.destroy?.();
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
