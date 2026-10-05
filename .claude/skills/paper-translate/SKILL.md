---
name: paper-translate
description: Translates an academic paper (arXiv ID/URL, or a paper already downloaded to papers/<id>/) into a complete Korean page for this Hugo (hugo-book) site — title, abstract, every section, figures, tables, equations and appendix in the original order, with the reference list kept in the original language at the very end — and publishes it to content/docs/<id>.md with figures in static/<id>/figures/. Use this whenever the user wants a paper translated into Korean or wants to read a paper in Korean — "논문 번역해줘", "이 arXiv 논문 한국어로", "2106.09685 번역", "부록까지 번역" — even if they don't mention Markdown or the site. Not for summaries or reviews of a paper.
---

# Paper Translate

Produce a complete Korean translation of the paper, in the original order, written so that an AI graduate student with basic-but-shaky LLM knowledge can follow it in one pass, and publish it as a page of this hugo-book site. That means free, explanatory translation rather than literal — but nothing in the paper may be dropped or distorted. A summary or a skipped detail defeats the purpose; so does an "easy" sentence that quietly changes what the authors claimed.

**Output order**: front matter (title) → authors → abstract → body sections → appendix → references. Everything is translated except the references, which stay in the original language. Even if the paper prints its references before the appendix, they go at the end, after the appendix.

The working directory is the project root (the folder with `hugo.yaml`). `<id>` is the arXiv ID, with `/` in old-style IDs replaced by `_`.

| what | where |
|---|---|
| working files (source, PDF, parts) | `papers/<id>/` — deleted when the translation is published |
| assembled translation while working | `papers/<id>/translation.ko.md` (generated; never edit it by hand) |
| figures and table images | `static/<id>/figures/<name>`, referenced as `/<id>/figures/<name>` |
| published page | `content/docs/<id>.md`, served at `/<id>/` |

hugo-book serves `static/` at the site root, so images are always referenced by that absolute path — a relative path like `source/figs/x.png` breaks once the page is published. You don't write these paths yourself: part files use plain Markdown and `assemble.mjs` copies the images and writes the Hugo syntax (step 5).

## Workflow

### 1. Get the source

If `papers/<id>/source/` doesn't exist, download it with the arxiv-download skill:

```bash
.claude/skills/arxiv-download/scripts/arxiv-download.sh <arxiv-id-or-url>
```

That also converts PDF figures in the source to PNG. If the user gives only a local PDF, skip to PDF mode (step 2).

### 2. Prepare the TeX

```bash
node .claude/skills/paper-translate/scripts/prepare.mjs <arxiv-id | papers/<id>>
```

This finds the main `.tex`, inlines every `\input`/`\include`, removes comments and dead `\iffalse` blocks, and writes to `papers/<id>/work/`:

| file | use |
|---|---|
| `outline.md` | **read this first, in full.** Sections with numbers and `flat.tex` line ranges, figures/tables with resolved image paths, appendix/bibliography position, warnings |
| `flat.tex` | the single source to translate from (read it by line ranges) |
| `labels.json` | `\label` → number, for rendering `\ref`, `\eqref`, `\cref` |
| `references.json` | citation key → number/label, for rendering `\cite` |
| `references.md` | finished reference list in the original language — becomes the last part as is |
| `macros.tex` | the paper's own macros, to expand inside math |
| `../tables/table-<N>.png` | each table cropped from `paper.pdf` exactly as TeX rendered it (needs `paper.pdf`) |

Exit code 2 means there's no LaTeX source: follow `references/pdf-fallback.md` instead and come back for steps 3–7. If outline.md lists other candidate main files and the chosen one looks wrong (e.g. it's a supplementary-only file), re-run with `--main <file>`.

### 3. Build the glossary

Skim the abstract, introduction and section titles, then write `work/glossary.md` (English | 번역 | 설명 | 비고) for the paper's key terms, following the rules in `references/style-guide.md`. The 설명 column is the one-clause gloss to give on first use for terms this reader may not know well (older models, training tricks, decoding methods); leave it empty for basics they already know. Below the terms, start a notation table (기호 | 뜻 | 쓰인 곳 | 역주) for the paper's symbols, one row per meaning, so a symbol that the paper reuses for different things — or a quantity that it names with two symbols — is visible before it confuses the reader. Settling terms up front is what keeps a 30-page translation consistent across parts and across sessions. Add terms and symbols as you meet them later.

### 4. Translate part by part, in order

Read `references/latex-to-markdown.md` and `references/style-guide.md` before the first part.

Write one file per part into `work/parts/`, named so that alphabetical order equals paper order:

```
work/parts/00-front.md          front matter, authors, abstract (+ teaser figure if the front matter has one)
work/parts/01-introduction.md   section 1
work/parts/02-…                 one file per top-level section (split a long one at subsections: 05a-, 05b-)
work/parts/A-…, B-…             appendix sections, in order
work/parts/ZZ-references.md     copy of work/references.md
```

`00-front.md` starts with the Hugo front matter instead of a `# Title` line — the body has no H1:

```markdown
---
title: "Attention Is All You Need"
linkTitle: "Transformer"
url: "/1706.03762/"
---

Ashish Vaswani (Google Brain), Noam Shazeer (Google Brain), …

## Abstract
```

- `title`: the original paper title, untranslated, cleaned of `\\` and `\thanks`.
- `linkTitle`: the short name shown in the sidebar — the method/model/system name the paper introduces, or a shortened title if there is none.
- `url`: the ID wrapped in slashes, `"/<id>/"`. Without the slashes Hugo reads `.03762` as a file extension, writes a file with that name, and it collides with the `static/<id>/figures/` folder so the page disappears from the build.
- Every value is double-quoted (titles often contain `:`); don't use `"` inside a value. No other keys.

For each part: read its line range of `flat.tex` (from outline.md), translate everything in that range in the order it appears — paragraphs, display math, figure and table environments, footnotes — and write the part file. Skip the bibliography row in the outline; the references come from `references.md`.

Translation rules that apply everywhere (details in the reference files):
- **Free translation for the reader.** Translate meaning, not sentence structure: split and reorder sentences, make implicit reasoning explicit, say formulas in words, unpack shorthand. Natural Korean academic register (`~한다/~이다`).
- **Nothing lost or changed.** Every claim, detail, number, setting and limitation of the original survives, with the same strength of claim (hedges stay hedges). Keep one translated paragraph per original paragraph, and re-read the original paragraph after translating it to catch omissions.
- **Additions are marked.** Short explanations go inline in parentheses on first use; anything longer goes in a `> **역주.** …` block right after the paragraph, caption or equation it explains — so the reader can always tell the authors' words from the translator's. Add only where this reader would stall; no opinions about the paper.
- **Glosses must not bury the sentence.** One short clause per gloss, at most two glossed terms per sentence and about three per paragraph. A term-dense paragraph (the abstract, the start of the introduction) keeps short glosses and moves the rest into one 역주 block after it, or defers them to the term's first use in the body.
- **Explain confusing notation and numbers.** When the paper reuses a symbol for something else, names one quantity with two symbols, or reports a number that seems to contradict another (50Hz vs. a 19.1Hz "effective rate"), add a 역주 where the reader would be misled. Keep the math as written and check the glossary's notation table before writing any 역주 about a symbol.
- **No word-for-word idioms.** Sentence adverbs and idioms like "Crucially" (결정적으로), "promise" (약속하다), "an order of magnitude" (한 자릿수) have natural Korean equivalents — see the 번역투 tables in the style guide.
- First use of a translated technical term gets the English (and the glossary gloss, if any) in parentheses; follow the glossary.
- Math, numbers, table data, code, model/dataset names, and author names stay as they are.
- Headings are not translated: section/subsection/`\paragraph` titles, Abstract, Acknowledgements and References keep the original text and numbering (`## 3 Model Architecture`). Prose, captions and in-text references (`3절`, `그림 2`) are translated as usual.
- Figures and tables go where their environment is in the source, as `![<what the image shows, in Korean>](<path from outline.md>)` next to a `**그림 N.**`/`**표 N.**` caption paragraph. Tables are the cropped PDF images plus a Korean caption; check each crop by looking at it, and fall back to a Markdown table only when the crop is missing or wrong.
- `\cite`, `\ref`, `\eqref` become rendered text (`[12]`, `(Vaswani et al., 2017)`, `그림 3`, `식 (2)`) — never leave raw LaTeX commands in prose.
- **Plain Markdown in part files.** Math is `$…$` / `$$…$$` with raw TeX inside (no Markdown escaping of `_` or `*`), a literal dollar sign is `\$`, and math in a table cell never uses `|` (use `\vert`, `\mid`, `\lVert`). Don't write `{{< katex >}}`, `{{< image >}}` or `<img>` yourself. Bold or italic next to particles (`**인코더(encoder)**를`, `*연산자 융합(operator fusion)*을`) and `~` ranges (`2~4배`) can be written naturally — assemble fixes how Goldmark renders them.

For long papers you may translate parts in parallel with subagents, once the glossary is done: give each one its line range, the paths of `glossary.md`, `labels.json`, `references.json`, `macros.tex`, and the two reference guides, and the part file to write. Do the front matter and introduction yourself first so the tone is set.

### 5. Assemble

```bash
node .claude/skills/paper-translate/scripts/assemble.mjs papers/<id>
```

Concatenates the parts in order into `papers/<id>/translation.ko.md` and renders it for hugo-book:

- every `![alt](path)` → the file is copied to `static/<id>/figures/` and becomes `{{< image src="/<id>/figures/<name>" alt="…" title="…" loading="lazy" >}}`, with `title` taken from the `**그림 N.**`/`**표 N.**` caption paragraph next to the image. Re-running is safe: files already there are reused, and images you stop using are removed at publish time;
- `$$…$$` → `{{< katex display=true >}}` block (not `displayMode`, which hugo-book renders inline), `$…$` → inline `{{< katex >}}…{{< /katex >}}`;
- `"\ "` after a closing `**` or `*` that follows punctuation (otherwise `**굵게(괄호)**입니다` doesn't render bold, nor `*기울임(괄호)*을` italic), and every `~` → `\~` (otherwise two `~` in one paragraph pair up into strikethrough). An intended strikethrough is `~~텍스트~~`.

Fix things in the part files and re-assemble; `translation.ko.md` is overwritten every time.

### 6. Check and fix

```bash
node .claude/skills/paper-translate/scripts/check.mjs papers/<id>
```

It verifies the content — every numbered section has a heading in the right order, every figure/table number has a caption, the references section comes last, no raw LaTeX is left in prose, no long paragraph is still in English, no section looks much shorter than the original — and the Hugo rendering: front matter (`title`, `linkTitle`, `url: "/<id>/"`), no H1 in the body, images as shortcodes whose files exist in `static/<id>/figures/`, no relative links, no leftover `$`, katex tags paired, no `|` inside math in a table row, bold/`~` fixes applied. Fix each ERROR in the relevant part file, re-assemble, and re-run until it prints `OK`. Look at WARN lines too — an unused image usually means a figure was skipped, and the readability warnings (gloss pile-ups, translationese) point at sentences to rewrite.

Then read `translation.ko.md` once from start to finish as the reader would — the check can't see the problems that only show up across sections:
- a symbol whose meaning changes, or two symbols for one quantity, with no 역주 where it happens (compare against the notation table);
- a 역주 that defines a symbol in a way a later section contradicts;
- numbers that look inconsistent across sections (rates, speedups, `%` vs. `%p`) with no 역주 reconciling them;
- the same sentence-initial connective repeated, or a paragraph whose glosses make it hard to find the subject.

Fix them in the part files and re-assemble.

### 7. Publish and clean up

Only once the check passes and you're done with the source (the check and any comparison with the original need `work/` and `source/`, which this deletes):

```bash
node .claude/skills/paper-translate/scripts/publish.mjs papers/<id> --dry-run   # check + build test, lists what would be deleted
node .claude/skills/paper-translate/scripts/publish.mjs papers/<id>
```

The script, in order:
1. runs `check.mjs` and stops if it fails;
2. places the page at `content/docs/<id>.md` and builds the site in memory with `hugo` — invalid TeX only shows up here, as a KaTeX parse error naming the line and formula. On failure it takes the page out again and changes nothing else: fix the formula in the part file, re-assemble, re-run. The build needs the theme and a recent enough Hugo, which `ensure-hugo.mjs` sets up on its own: it runs `git submodule update --init` when `themes/<theme>/` is empty, and uses `$HUGO_BIN` or `hugo` on PATH if it meets the theme's `min_version`, else a copy cached in `~/.cache/paper-translate/`, else downloads that version from the Hugo GitHub releases. If none of that works (no network, unsupported platform), the script stops before publishing or deleting anything. Report the error to the user; `--skip-build` publishes without the build test and is only for when the user accepts that KaTeX errors go unchecked;
3. deletes `papers/<id>/` entirely (`paper.pdf`, `source/`, `tables/`, `work/` with the parts and glossary);
4. deletes the files in `static/<id>/figures/` that the page doesn't reference.

If `content/docs/<id>.md` already exists, the script changes nothing — ask the user before replacing it rather than deleting it yourself.

Then tell the user the published path (`content/docs/<id>.md`), how many sections/figures/tables it covers, how many images are left in `static/<id>/figures/`, and anything that couldn't be carried over (e.g. TikZ figures replaced by a note, labels whose numbers had to be read from the PDF). To preview, they can run `hugo server` and open `/<id>/`.

## Resuming

The part files make the work restartable. If `work/parts/` already has files, read `work/glossary.md` and the last part, then continue from the next unit in outline.md instead of starting over. Once `publish.mjs` has run, the working files are gone; later fixes are made directly in `content/docs/<id>.md`, in the Hugo syntax described in step 5.
