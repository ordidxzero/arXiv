---
name: arxiv-download
description: Downloads PDF and TeX source archives from arXiv using an arXiv ID or arXiv URL. Use when you need a paper's PDF, source bundle, or both.
---

# arXiv Download

## What it does

Download arXiv PDFs and source archives into `./papers/<arxiv-id>/` by default.
Each paper is saved in its own folder with fixed filenames: `paper.pdf` and `source.tar.gz`, and the source archive is extracted into `source/`.

## Usage

```bash
.claude/skills/arxiv-download/scripts/arxiv-download.sh <arxiv-id-or-url> [--pdf|--source|--both] [--out DIR]
node .claude/skills/arxiv-download/scripts/figure-pdf-to-png.mjs <pdf-file> [--out FILE] [--scale N]
node .claude/skills/arxiv-download/scripts/source-pdfs-to-png.mjs <source-dir> [--scale N]
```

Examples:

```bash
.claude/skills/arxiv-download/scripts/arxiv-download.sh 2401.01234
.claude/skills/arxiv-download/scripts/arxiv-download.sh https://arxiv.org/abs/2401.01234 --pdf
.claude/skills/arxiv-download/scripts/arxiv-download.sh hep-th/9901001 --source --out downloads
node .claude/skills/arxiv-download/scripts/source-pdfs-to-png.mjs ./papers/2506.15745/source
```

## Notes

- Supports `abs`, `pdf`, `arxiv:`-prefixed, and plain arXiv IDs.
- Old-style IDs with slashes are saved with `_` in folder names.
- `--out` sets the base directory; paper folders are created under it.
- Source downloads try `e-print` first, then `src` as a fallback, and are extracted into `source/`.
- Figure PDFs are auto-converted to PNG after source extraction when PDFs exist in `source/`.
- `scripts/figure-pdf-to-png.mjs` renders with `pdf-to-img` and `@napi-rs/canvas`. These npm packages are not committed (`node_modules/` is gitignored); their versions are pinned by `package.json` + `package-lock.json` in `.claude/skills/arxiv-download/`, and `scripts/pdf-deps.mjs` installs them with `npm ci` the first time they fail to load (the paper-translate scripts use the same install). Default scale is 4.
- Use `scripts/source-pdfs-to-png.mjs` to scan a source tree, and `scripts/figure-pdf-to-png.mjs` to convert one PDF.
