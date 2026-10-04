# LaTeX → Markdown conversion rules

The output is a page of a Hugo site with the hugo-book theme (Goldmark Markdown, KaTeX via shortcodes). Part files are written in plain Markdown — `$` math and `![alt](path)` images — and `assemble.mjs` turns them into hugo-book shortcodes, so the rules below are about what to write in the part files. When in doubt, choose the form that renders cleanly over a literal transcription of the source.

## Contents
- Headings and front matter
- Math
- Citations and cross-references
- Figures
- Tables
- Algorithms, code, lists, theorems, footnotes
- Things to drop

## Headings and front matter

Headings stay exactly as in the original — they are not translated. Keeping them in English lets the reader map every part back to the paper and lets `check.mjs` verify coverage (it reports any heading containing Hangul as an error).

| Source | Markdown |
|---|---|
| title | front matter `title: "Attention Is All You Need"` (original title, cleaned of `\\` and `\thanks`) — never a `# ` line; the body has no H1 (see SKILL.md step 4) |
| authors / affiliations | one plain line of names and affiliations in the original script; drop emails and `\thanks` markers unless they carry real content (then make them footnotes, translated) |
| abstract | `## Abstract` |
| `\section{X}` | `## <num> X` — e.g. `## 3 Model Architecture` |
| `\subsection{X}` | `### <num> X` |
| `\subsubsection{X}` | `#### <num> X` |
| `\paragraph{X}` | run-in bold at the start of the paragraph, original text: `**Residual Dropout.** 본문…` |
| starred / unnumbered section | same level, no number: `## Acknowledgements` |
| appendix sections | `## A X`, `### A.1 X` — numbers come from outline.md |
| bibliography | `## References` (already in `work/references.md`) |

Use the numbers from `work/outline.md` instead of re-counting. Inline math in a section title stays as `$…$`; the front matter title gets plain text instead (`$O(n)$` → `O(n)`).

## Math

`assemble.mjs` turns `$$…$$` into `{{< katex display=true >}}` and `$…$` into `{{< katex >}}…{{< /katex >}}`; Hugo renders them with KaTeX at build time, and a formula KaTeX can't parse fails the build (`publish.mjs` catches it).

- Inline: `$...$`, on one line. Display: `$$` on its own line, the formula, `$$` on its own line, with a blank line before and after — a display equation is its own paragraph, never in the middle of a sentence.
- Write raw TeX between the dollars. The shortcode body isn't Markdown, so don't escape `_`, `*` or `\\` for a Markdown viewer.
- A literal dollar sign in prose (prices, `$5`) is written `\$`; an unescaped `$` would be read as the start of math.
- Inside a Markdown table row, math never contains `|` — it splits the cell. Use `\vert`, `\mid`, `\lVert … \rVert` (not `\|`).
- `equation` with a number → put `\tag{n}` inside the display block: `$$ … \tag{3} $$`. Use the number from `labels.json` (or the outline count) so it matches the PDF.
- `align`/`eqnarray`/`gather` → one `$$` block wrapping `\begin{aligned} … \end{aligned}` (`gathered` for gather). `eqnarray`'s `&=&` becomes `&=`. Multiple numbered rows: put each row's `\tag{n}` at the end of the row before `\\`.
- Expand paper-specific macros using `work/macros.tex` (e.g. `\vx` → `\mathbf{x}`, `\R` → `\mathbb{R}`), because renderers don't know them. Standard LaTeX/AMS commands stay as they are.
- Replace commands KaTeX doesn't support: `\bm{x}`/`\boldsymbol` → `\boldsymbol{x}` (KaTeX supports it) but `\mathbbm` → `\mathbb`, `\nicefrac{a}{b}` → `a/b`, `\textsc{x}` → `\text{x}`. `\text{...}` content inside math stays in English unless it is a full natural-language phrase.
- Never translate variable names, operators, or subscripts like `_{\text{model}}`.

## Citations and cross-references

Citations follow the style printed by `prepare.mjs` (outline.md → bibliography line):

| style | `\cite{k}` / `\citep{k}` | `\citet{k}` |
|---|---|---|
| numeric | `[12]` (look up `n` for key `k` in `work/references.json`; multiple → `[3, 12]`) | `Vaswani et al. [12]` |
| author-year | `(Vaswani et al., 2017)` — `cite` field in references.json | `Vaswani et al. (2017)` |
| custom-label | `[VSP17]` | `Vaswani et al. [VSP17]` |

Keep author names in the original language. Korean particles attach after the citation: `Vaswani et al. (2017)은 …`, `[12]에서 …`.

Cross-references use `work/labels.json`:

| label type | Korean |
|---|---|
| section / subsection | `3절`, `3.2절` |
| appendix | `부록 A`, `부록 B.2` |
| figure | `그림 3`, subfigure `그림 3a` |
| table | `표 2` |
| equation | `식 (4)` (`\eqref` → `(4)`, the surrounding "Eq." becomes `식`) |
| algorithm | `알고리즘 1` |
| theorem-like | use its name: `정리 1`, `보조정리 2`, `정의 3`, `가정 1`, `명제 2`, `따름정리 1` |

`\cref`/`\autoref` already include the word ("Figure 3"), so render the Korean word plus number. If a label has `number: null` or is missing, check the PDF rather than guessing.

## Figures

Place a figure where its `figure` environment sits in the TeX source (this is the paper's reading order; LaTeX may float it elsewhere in the PDF, which is fine to ignore).

```markdown
![Transformer 인코더-디코더 구조도](source/Figures/ModalNet-21.png)

**그림 1.** Transformer 모델 구조.
```

- Image paths come from outline.md's float list (already relative to the paper folder, already PNG). Use them exactly; wrap paths containing spaces in `<…>`.
- Write plain `![alt](path)` in part files. `assemble.mjs` copies the file to `static/<id>/figures/` and converts the line to `{{< image src="/<id>/figures/<name>" alt="…" title="…" loading="lazy" >}}`. Never write the shortcode, an `<img>` tag or a `/<id>/figures/` path yourself.
- **alt** is for a reader who can't see the image: say in a few Korean words what it is — the kind of figure, its subject, its axes or parts (`모델 크기별 학습 손실 곡선, 세 패널`) — without interpretation and without repeating the caption. Avoid `"`; use `'` or 「」.
- The caption paragraph (`**그림 N.** …`) goes right after the image lines (for tables, right before); assemble uses it as the image's `title`, so keep it adjacent — at most a subfigure-caption paragraph in between.
- Several images in one figure (subfigures, side-by-side panels): one `![](…)` line per image with no blank line between them (they render side by side when they fit), then subfigure captions as `(a) …`, `(b) …`, then the main caption.
- One float with two `\caption`s (two figures side by side): emit two separate figure blocks, each with its own number.
- No usable image (`missing`, `unsupported .eps`, TikZ/pgfplots drawing, `\input{fig.tikz}`): keep the caption and add a one-line note in place of the image: `> *(그림 원본은 TikZ로 작성되어 이미지로 옮기지 않았습니다. 원문 PDF 3쪽 참조.)*`. Find the page by looking at the PDF if it's available.
- Translate captions fully, including the parts that describe panels ("Left: …" → "왼쪽: …").

## Tables

Tables are shown as images cropped from the compiled `paper.pdf`, so numbers, alignment, rules, bold highlighting and merged cells look exactly as TeX typeset them and nothing can be mistyped. `prepare.mjs` crops them into `tables/table-<N>.png` (listed in outline.md as "rendered table N"); the English caption is left out of the image so the Korean caption can sit next to it.

```markdown
**표 2.** 영어→독일어, 영어→프랑스어 newstest2014에서의 BLEU 점수와 학습 비용.

![모델별 BLEU 점수와 학습 FLOPs 표](tables/table-2.png)
```

- Caption above the image (most papers print table captions on top); translate it fully.
- The cell contents stay in English inside the image. That's intended: they are mostly names, metrics and numbers. If a header term matters for following the text, the body translation already explains it.
- Look at each cropped image once (Read the PNG). If a crop is wrong — cut-off rows, a stray caption line, two tables merged — or outline.md says `not found`, write that table as a Markdown table instead using the rules below.

### Markdown table fallback

- Numbers, units, ± values, and bold/underline highlighting (`**28.4**`) are copied exactly — this is data, not prose.
- Header cells: translate descriptive words, keep metric/dataset/model names (BLEU, F1, ImageNet, GPT-3).
- `\multicolumn`/`\multirow`: repeat the value or leave cells blank so the grid stays rectangular; put a group header into the column name (`EN-DE BLEU`). If the table cannot be represented without losing meaning (nested headers spanning several levels), write an HTML `<table>` with `colspan`/`rowspan` instead.
- `\midrule`/`\hline` separators have no Markdown equivalent; skip them.
- Math in cells stays `$…$`, without `|` inside (see Math). A literal `|` in cell text is escaped as `\|`.

## Algorithms, code, lists, theorems, footnotes

- `algorithm`/`algorithmic`: a caption line `**알고리즘 1.** …` followed by a fenced code block in pseudo-code, keeping the line structure and math; translate comments and natural-language steps (`\Require` → `입력:`, `\Ensure` → `출력:`, `\For` → `for`, keep keywords in English).
- `verbatim`/`lstlisting`/`minted`: fenced code block, contents unchanged.
- `itemize` → `-`, `enumerate` → `1.`, `description` → `- **용어**: 설명`.
- `theorem`/`lemma`/`definition`/`proof`: `**정리 1 (Theorem 1).** …`, proof as `*증명.* … ∎`. Name in parentheses (`\begin{theorem}[Universal approximation]`) → `**정리 1 (보편 근사).**`.
- `\footnote{…}` → `[^n]` at the point of use, and the footnote definition `[^n]: …` right after the paragraph that uses it (keeps the part files self-contained). `n` is the paper's own footnote number, so it stays unique across parts once they are concatenated.
- `\url{u}` → `<u>`, `\href{u}{t}` → `[t](u)`. Only absolute `http(s)` links; a relative link to a local file breaks on the site.
- Emphasis: `\emph`/`\textit` → `*…*`, `\textbf` → `**…**`, `\texttt` → `` `…` ``. Bold or italic followed directly by a Korean particle is fine to write as is; assemble inserts the escape Goldmark needs.

## Things to drop

Layout-only commands carry no content: `\vspace`, `\hspace`, `\centering`, `\small`, `\resizebox` (keep its contents), `\newpage`, `\clearpage`, `\maketitle`, `\label` (after you've used it), `\noindent`, `\bibliographystyle`. Conference boilerplate in the preamble is never translated. NeurIPS/ICML checklists that appear after the appendix are part of the paper — translate them in order like any other appendix content.
