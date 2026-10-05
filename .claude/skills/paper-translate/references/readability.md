# Readability review

The style guide says *what* the translation must keep; this file says *how a sentence should read*. A translation can be complete and accurate and still be hard: the translator holds the English in mind and reads their own Korean through it, so a tangled sentence looks clear to them. That is why step 6 has a separate reader — the `translation-reader` agent — who sees only the Korean.

## What makes a Korean sentence hard

Each rule has a bad/good pair taken from real translations. The fix is always a rewrite of the sentence, never a deletion of content.

### 1. Modifiers stacked in front of a noun

English puts modifiers after the noun ("a system that is training-free, modality-aware and bounded"); copying that into Korean puts all of them before it, and the reader has to hold every clause until the noun arrives.

- Bad: `목표는 추가 학습이 필요 없고(training-free) 모달리티를 인식하는, 이력 길이가 제한된(bounded-history) 시스템을 만드는 것이다.`
- Good: `목표는 이력 길이를 일정하게 제한하는(bounded-history) 시스템을 만드는 것이다. 이 시스템은 추가 학습이 필요 없고(training-free), 모달리티의 차이를 고려한다.`

Rule: at most one modifying clause before a noun. If there are more, name the thing first and describe it in the next sentence.

### 2. Nouns where a verb would do

Chains of nominalized terms (`보존 인식·타일 정렬 페이징`, `보존 상태별 배치`, `선택적 물리 KV 통합`) make the reader rebuild the action themselves.

- Bad: `OmniPage는 KV 배치를 안내하는 보존 인식·타일 정렬 페이징(6.1절)과 … 선택적 KV 이주(6.2절)를 결합한다.`
- Good: `OmniPage는 두 가지 방법을 쓴다. 첫째, 어떤 토큰이 오래 남을지에 따라 KV를 나눠 담고, 페이지 크기를 어텐션 타일에 맞춘다(retention-aware, tile-aligned paging, 6.1절). 둘째, 흩어진 항목 중 일부만 골라 옮긴다(selective KV migration, 6.2절).`

The English name of a technique stays in parentheses so the reader can still match it with the paper; the sentence itself says what it does.

### 3. Subject far from its verb

When the subject sits at the start and the verb at the end of a 100-character sentence, the reader forgets who does what.

- Bad: `트랜스포머 백본은 프리필과 디코딩 동안 지속되는 KV 읽기-갱신 루프로 이 유닛들을 처리하며, 누적 이력이 … 넘으면 OmniPick이 …`
- Good: split at each new actor. One actor, one action per sentence where possible.

### 4. Sentence length

Aim for 40–70 Hangul characters per sentence; `check.mjs` warns above 90 (parenthesized glosses excluded). A long sentence is fine only if it is a plain list.

### 5. Heavy translated terms

Pick the plainest Korean that is still correct, and use it consistently (record it in the glossary):

| heavy | plain |
|---|---|
| 축출 (eviction) | 제거, 캐시에서 내보내기 |
| 압축 정렬 (compaction) | 빈칸 없이 앞으로 모으기 → term: 압축(compaction) |
| 물리 범위 (physical span) | 첫 슬롯부터 마지막 사용 슬롯까지의 범위 → term: 물리 범위 |
| 보존 상태별로 묶는다 | 남을 가능성이 비슷한 것끼리 모은다 |
| 결정론적으로 | 점수 계산 없이 정해진 규칙대로 |

The first occurrence gives the English and, if needed, a one-clause gloss; after that the plain term alone.

### 6. "의" chains

Three or more `의` in one sentence (`보존된 항목의 논리적 위치의 갱신의 …`) — turn one of them into a clause (`항목이 원래 있던 논리적 위치를 갱신한다`). `check.mjs` warns about these.

### 7. Hidden logic

A sentence that only makes sense if you know the English connective (`while`, `thus`, `rather than`) — say the relation in Korean: `반면`, `그래서`, `~하는 대신`.

## What the rewrite must not do

Everything in the style guide's "What must not change" still holds: every claim, number, hedge and citation survives, paragraph correspondence stays, headings stay in English. Splitting one sentence into three is fine; dropping a clause because it made the sentence long is not. Every rewrite is checked against the original (`work/flat.tex`) before it is accepted.
