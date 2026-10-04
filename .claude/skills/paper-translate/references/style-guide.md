# Korean translation style guide

## Contents
- Reader
- Free translation: what's allowed
- Additions: inline glosses and 역주 blocks
- Notation and numbers that can mislead
- What must not change
- Register and natural Korean
- Terminology and the glossary
- What stays untouched

## Reader

The reader is an AI graduate student. They know the basics of deep learning and LLMs — neural networks, backpropagation, tokens, embeddings, the rough idea of attention and Transformers, pre-training vs. fine-tuning — but that knowledge isn't solid yet. They can lose the thread when a paper:

- packs several steps into one sentence, or states a result without saying why it follows,
- names an older technique or model in passing (ByteNet, label smoothing, beam search, BPE) as if everyone knew it,
- writes a formula and moves on without saying in words what it computes,
- relies on field shorthand ("SOTA", "ablation", "the usual setup").

Write the translation so this reader can follow the paper in one pass, without stopping to look things up. Don't explain what they already know well (what a neural network or gradient descent is); that only slows them down.

## Free translation: what's allowed

Translate the meaning, not the sentence structure. Ask "how would a Korean researcher explain this paragraph to a junior labmate, without leaving anything out?"

- **Restructure freely.** Split long sentences, reorder clauses into natural Korean order, turn passive into active, merge a dangling fragment into its sentence.
- **Make implicit logic explicit.** If the paper jumps from A to C, add the connecting B in a few words when it's directly implied by the paper (`즉`, `따라서`, `이렇게 하는 이유는 ~ 때문이다`).
- **Say formulas in words.** Right before or after a display equation, a short sentence on what it computes or why its shape matters is welcome (`즉, 각 쿼리가 모든 키와 얼마나 비슷한지를 계산해 그 비율대로 값을 섞는다.`).
- **Unpack shorthand.** "SOTA" → `당시 최고 성능`, "ablation" → `구성 요소를 하나씩 빼거나 바꿔 보는 실험(ablation)`.
- **Choose clarity over literal word choice.** "Dispensing with recurrence entirely" → `순환 구조를 아예 쓰지 않는다`, not `순환을 완전히 처분한다`.

Keep paragraph correspondence with the original: one original paragraph → one translated paragraph (plus an optional 역주 block after it). This lets the reader put the translation next to the PDF and find their place.

## Additions: inline glosses and 역주 blocks

Explanations that go beyond the paper's own words must be recognizable as the translator's, so the reader never mistakes them for the authors' claims. Use exactly two forms:

1. **Inline gloss** — short (about one clause), in parentheses, for a term or reference the reader may not know, on its first occurrence:
   `레이블 스무딩(label smoothing, 정답 레이블에 약간의 확률을 다른 클래스로 나눠 주어 모델이 지나치게 확신하지 않게 하는 기법) [36]을 적용했다.`
2. **역주 block** — when the reader needs more than a clause: background the paper assumes, the intuition behind a derivation, why a design choice matters, or how a number should be read. Place it right after the paragraph (or caption, or equation) it explains:

   ```markdown
   > **역주.** $\sqrt{d_k}$로 나누는 이유: 각 성분의 분산이 1이면 $d_k$개를 곱해 더한 내적의 분산은 $d_k$가 된다. 값이 이렇게 커지면 소프트맥스 출력이 한 원소에 거의 몰려(원-핫에 가까워져) 기울기가 0에 가까워지므로, 표준편차 $\sqrt{d_k}$로 나눠 분산을 1로 되돌린다.
   ```

Guidelines for additions:
- Add only where this reader would plausibly stall. A rough budget: inline glosses are cheap; 역주 blocks at most about one per two or three paragraphs, a few sentences each. The translation should still read as the paper, not as a textbook.
- Base explanations on the paper itself and on standard textbook knowledge. Facts from after the paper's publication (e.g. "이 구조는 이후 GPT와 BERT의 기반이 되었다") are allowed only inside a 역주 block, phrased as later context.
- Footnotes from the original stay footnotes (`[^n]`); don't turn 역주 into footnotes, and don't put 역주 inside captions — put the block after the caption.
- A 역주 block that sits between an image and its `**그림 N.**` caption would push the caption away from the image; put it after the caption.

### Gloss density: don't bury the sentence

An inline gloss is only cheap while the sentence around it stays readable. Several long glosses in one sentence — especially inside the subject — make the reader lose the subject and the verb:

- Bad: `플로 매칭(flow matching, 노이즈를 목표 분포로 옮기는 속도장을 학습해 … 생성 기법) 기반의 비전-언어-행동(Vision-Language-Action, VLA, 이미지와 언어 지시를 받아 … 모델) 모델은 정밀한 연속 제어를 …`
- Good: `플로 매칭(flow matching) 기반의 비전-언어-행동(Vision-Language-Action, VLA) 모델은 정밀한 연속 제어를 …` followed by one `> **역주.**` block that explains flow matching and VLA in two or three sentences.

Limits:
- A gloss is one short clause — about 30 Hangul characters of explanation at most. Anything longer is a 역주 block.
- At most two glossed terms per sentence and about three per paragraph. Never put a long gloss inside the subject noun phrase.
- When a paragraph introduces more new terms than that — typical of the abstract and the first paragraph of the introduction — keep only the glosses the sentence can't be read without, and move the rest into one 역주 block after the paragraph, or defer them to the term's first occurrence in the body. The term then still counts as "not yet explained" for the first-occurrence rule, so the body gives the gloss.
- `check.mjs` warns about paragraphs with four or more glosses (parentheses holding 10+ Hangul characters) and about any single gloss over 35 Hangul characters. Treat the warning as a request to restructure, not to shorten the glosses until they say nothing.

## Notation and numbers that can mislead

Papers often reuse a symbol for different things, or name one quantity with different symbols, without saying so. The original reader can sort it out from context; this reader usually can't. Keep the math exactly as written (see "What must not change") and explain instead.

- **Track every symbol.** The glossary has a notation table (see "Terminology and the glossary") listing each symbol, what it means, and the sections where it has that meaning. Fill it as you translate.
- **Explain a change of meaning where it happens.** When a symbol takes a new meaning (`t` as the flow-matching timestep in §2 but as the observation time in §3, with the denoising step now `k`), or two symbols name the same quantity (window size `N` in §3, `K` in §4), or one symbol names two things (`K` as the window size and as the overlap count in an algorithm), add a short 역주 at the first place the reader would be misled: `> **역주.** 여기서 $K$는 알고리즘 1의 겹침 개수가 아니라 3.1절의 윈도 크기 $N$과 같은 값이다.`
- **Keep your own 역주 consistent with the paper's later notation.** A 역주 that defines a symbol should say for which section the definition holds, so a later section that reuses the symbol differently doesn't contradict it. Check the notation table before writing a 역주 about a symbol.
- **Reconcile numbers that look contradictory.** When a number seems to conflict with a headline claim or an earlier number — "50Hz control" vs. "19.1Hz effective control rate", a speedup that differs between sections, `%` vs. `%p` — add a 역주 saying how the two numbers differ (what each one measures, under which setting), based on the paper's own definitions. If the paper doesn't explain the relation, say so neutrally (`본문은 두 값의 관계를 따로 설명하지 않는다.`). That is a reading note, not an opinion about the paper.

## What must not change

Freedom in phrasing never extends to content. Every one of these must survive:

- **Every statement.** Each claim, method detail, setting, number, comparison, and limitation in the original appears in the translation. Re-read each original paragraph after translating it and check nothing was dropped — free translation makes omissions easy to miss.
- **Strength of claims.** Hedging stays hedging (`~일 수 있다`, `~로 보인다`, `~라고 추측한다`); "slightly better" doesn't become "much better"; "we suspect" doesn't become "it is because".
- **Attribution.** What the authors did vs. what prior work did stays clear (`본 논문에서는` vs. `[18]에서는`).
- **Numbers, units, equations, equation numbers, citations, cross-references** — exactly as in the original.
- **No opinions.** The translator doesn't praise, criticize, or evaluate the paper, in the text or in 역주 blocks.

If a sentence is ambiguous, translate the most plausible reading; if the ambiguity matters for understanding, say so in a 역주 block rather than silently picking one.

## Register and natural Korean

- Academic declarative register: `~한다`, `~이다`, `~했다`. Not `~합니다`.
- "We" → usually drop the subject or use `본 논문에서는`/`저자들은` sparingly. "We propose X" → `X를 제안한다`.
- Avoid translationese:

| 번역투 | 자연스러운 표현 |
|---|---|
| ~에 있어서 | ~에서 |
| ~되어진다 | ~된다 |
| ~하는 것이 가능하다 | ~할 수 있다 |
| ~를 가지고 있다 (has) | ~가 있다 / 문맥에 맞는 동사 |
| ~에 의해 수행된다 | 능동형으로 |
| 그것은, 그들은 (it, they) | 가리키는 명사를 다시 쓰거나 생략 |
| ~함에 따라서 | ~하면서 / ~할수록 |
| ~하는 데 있어 | ~할 때 |

English sentence adverbs and idioms translated word for word are the other common source of translationese. Often the best Korean is no connective at all.

| English | 번역투 | 자연스러운 표현 |
|---|---|---|
| Crucially, / Critically, | 결정적으로, | 특히, / 무엇보다, / 핵심은 ~이다 / 생략 |
| Importantly, | 중요하게도, | 중요한 점은 / 생략 |
| Interestingly, | 흥미롭게도, | 눈여겨볼 점은 / 생략 |
| X promises Y | X는 Y를 약속한다 | X로 Y를 기대할 수 있다 / X는 Y의 가능성을 보여 준다 |
| an order of magnitude | 한 자릿수 | 약 10배 / 열 배 가까이 |
| orders of magnitude | 몇 자릿수 | 수십~수백 배 (원문 맥락에 맞게) |

Don't reuse the same sentence-initial connective (`특히`, `결정적으로`, `또한`) more than a couple of times in one section; vary it or drop it. `check.mjs` warns about the expressions in the 번역투 column.

## Terminology and the glossary

Build `work/glossary.md` before translating and follow it everywhere. The 설명 column holds the inline gloss to use on first occurrence (leave it empty for terms the reader already knows):

```markdown
| English | 번역 | 설명 (첫 등장 시 풀이) | 비고 |
|---|---|---|---|
| attention | 어텐션 | | 독자가 앎 |
| label smoothing | 레이블 스무딩 | 정답 확률 일부를 다른 클래스에 나눠 과신을 막는 기법 | |
| beam search | 빔 서치 | 매 단계 확률이 높은 후보 몇 개만 유지하며 문장을 생성하는 탐색법 | |
| ByteNet | ByteNet | 합성곱 기반 번역 모델 | 고유명사 |
```

Below the term table, keep a notation table for the paper's symbols (see "Notation and numbers that can mislead"). One row per meaning, so a reused symbol gets several rows:

```markdown
| 기호 | 뜻 | 쓰인 곳 | 역주 |
|---|---|---|---|
| $t$ | 플로 매칭 타임스텝 (노이즈→행동) | 2.1, 2.2, 3.2 | |
| $t$ | 관측 시간 | 3.1, 부록 A | 3.1절 첫 등장에 역주 |
| $k$ | 디노이징 단계 | 3.1, 부록 A | |
| $N$, $K$ | 관측 윈도 크기 (같은 값) | $N$: 3.1 / $K$: 4.2, 4.6 | 4.2절에 역주 |
| $K$ | 미리 시작하는 행동 개수 | 알고리즘 1 | |
```

Decision rules:
1. **Proper nouns stay in English**: model, method, dataset, benchmark, library, metric names (Transformer, BERT, LoRA, ImageNet, GLUE, BLEU). Gloss obscure ones once.
2. **Established Korean terms**: 학습, 추론, 손실 함수, 가중치, 행렬, 차원, 정확도, 과적합, 일반화, 데이터셋, 파라미터.
3. **Common transliterations in Korean ML writing**: 어텐션, 임베딩, 토큰, 레이어, 배치, 드롭아웃, 파인튜닝, 프롬프트, 인코더, 디코더.
4. **First occurrence** of a translated term gets the English in parentheses: `잔차 연결(residual connection)`; add the gloss from the 설명 column in the same parentheses if it has one. Afterwards use only the Korean.
5. Abbreviations: first `대규모 언어 모델(large language model, LLM)`, then `LLM`.

## What stays untouched

Math, variable names, numbers and units, code, URLs, citation labels, author names, model/dataset names, headings (see latex-to-markdown.md), and quoted example sentences that are the subject of study (keep them; add a Korean gloss in parentheses if needed to follow the argument).
