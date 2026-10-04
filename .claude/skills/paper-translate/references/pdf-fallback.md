# PDF mode (no LaTeX source)

Use this when `prepare.mjs` exits with code 2 (no `\documentclass` file in `source/`), when the user hands over only a PDF, or when the source is unusable (e.g. a Word-generated submission).

## Reading the PDF

- Read `paper.pdf` with the Read tool in page ranges (`pages: "1-5"`, at most 20 pages per call). Reading the pages visually keeps two-column order, equations, and table structure intact far better than plain text extraction.
- Reading order on a two-column page: left column top to bottom, then right column. Figures/tables spanning both columns go where they appear vertically relative to the text you're reading; a float at the top of a page goes before that page's text.
- Rebuild an outline yourself first and write it to `work/outline.md`: section numbers and titles with page numbers, figure/table numbers with pages, where the references start, where the appendix starts. This replaces the TeX outline and keeps the later parts consistent.

## Differences from TeX mode

- **Equations**: transcribe into LaTeX from the rendered page. Keep the printed equation numbers as `\tag{n}`.
- **Figures**: there are no image files. Render pages that contain figures to PNG and link the page image, or, if rendering isn't possible, leave a note in place of the image:
  ```bash
  node .claude/skills/paper-translate/scripts/pdf-pages-to-png.mjs papers/<id>/paper.pdf --pages 3,5 --out papers/<id>/work/pages
  ```
  then `![원문 3쪽 전체 이미지, 그림 2 포함](work/pages/page-3.png)` followed by the translated caption. `assemble.mjs` copies the page image to `static/<id>/figures/` like any other figure. Fallback note: `> *(그림 2: 원문 PDF 3쪽 참조)*`.
- **References**: there is no `work/references.md`. Transcribe the reference list from the PDF into `work/parts/ZZ-references.md` under `## References`, one entry per line, in the original language and order. Don't translate entries.
- **Check**: `check.mjs` still works; without `outline.json` it only runs the generic checks (front matter, images, math, leftover LaTeX, untranslated paragraphs). Verify section coverage yourself against the outline you wrote. `publish.mjs` works the same way.
