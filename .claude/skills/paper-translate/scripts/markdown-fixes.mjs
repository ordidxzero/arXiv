// Goldmark quirks in Korean prose, fixed mechanically (shared by assemble.mjs and check.mjs).
//   1. Bold next to punctuation: "**굵게(괄호)**입니다" does not render, because a closing ** preceded by
//      punctuation must be followed by whitespace or punctuation (CommonMark flanking rules). Insert "\ "
//      (an escaped space, which hugo.yaml's cjk.escapedSpace renders as nothing): "**굵게(괄호)**\ 입니다".
//      The mirror case, "앞글자**(괄호)…**", gets "앞글자\ **(괄호)…**".
//   2. Italic next to punctuation: the same rule applies to a single "*", so "*연산자 융합(operator fusion)*을"
//      becomes "*연산자 융합(operator fusion)*\ 을" (and "앞글자*(…)…*" gets "앞글자\ *(…)…*").
//   3. Tildes: any two "~" in one paragraph pair up into strikethrough ("20.4~38.2%, 2~4배"), even across
//      sentences, and escaping only every other one still lets the remaining ones pair. So every "~" becomes
//      "\~"; an intended strikethrough is written "~~텍스트~~" and is left alone.
// Front matter, code, shortcodes (math, images), HTML tags, link destinations and bare URLs are not touched.

const PUNCT = /[\p{P}\p{S}]/u;
const WORDISH = /[^\s\p{P}\p{S}]/u; // neither whitespace nor punctuation (placeholders count as text)
const OPEN = '';
const CLOSE = '';

// Replaces protected spans with private-use placeholders so the fixes cannot see or change them.
function protect(text) {
  const saved = [];
  const hold = (s) => `${OPEN}${saved.push(s) - 1}${CLOSE}`;
  const out = text
    .replace(/^---\n[\s\S]*?\n---\n/, hold)
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, hold)
    .replace(/\{\{<\s*katex\b[^>]*>\}\}[\s\S]*?\{\{<\s*\/katex\s*>\}\}/g, hold)
    .replace(/\{\{[<%][\s\S]*?[>%]\}\}/g, hold)
    // Keep the backticks and brackets: they are punctuation that matters for the bold rule.
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, ticks, body) => `${ticks}${hold(body)}${ticks}`)
    .replace(/\]\(([^)\s]+)\)/g, (m, url) => `](${hold(url)})`)
    .replace(/<\/?[A-Za-z][^>\n]*>/g, hold)
    .replace(/https?:\/\/[^\s)<>\]]+/g, hold)
    .replace(/~~(?=\S)[^~\n]*?\S~~/g, hold);
  const placeholder = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');
  return { out, restore: (s) => s.replace(placeholder, (m, i) => saved[i]) };
}

function fixBold(paragraph) {
  // Pair ** runs in order: odd ones open, even ones close. Already-fixed "\ " is punctuation, so this is idempotent.
  let n = 0;
  return paragraph.replace(/(?<![*\\])\*\*(?!\*)/g, (m, offset, s) => {
    const before = s[offset - 1] ?? '';
    const after = s[offset + 2] ?? '';
    n += 1;
    if (n % 2 === 0) return PUNCT.test(before) && WORDISH.test(after) ? '**\\ ' : m;
    return WORDISH.test(before) && PUNCT.test(after) ? '\\ **' : m;
  });
}

function fixItalic(paragraph) {
  // Single "*" only (runs of ** or *** are left to fixBold). A "*" with whitespace on both sides, or a list
  // bullet ("* " at the start of a line), can't delimit emphasis and is skipped so the pairing stays in step.
  let n = 0;
  return paragraph.replace(/(?<![*\\])\*(?!\*)/g, (m, offset, s) => {
    const before = s[offset - 1] ?? '';
    const after = s[offset + 1] ?? '';
    const lineStart = !before || before === '\n';
    if ((!before.trim() || lineStart) && !after.trim()) return m;
    n += 1;
    if (n % 2 === 0) return PUNCT.test(before) && WORDISH.test(after) ? '*\\ ' : m;
    return WORDISH.test(before) && PUNCT.test(after) ? '\\ *' : m;
  });
}

const fixTildes = (paragraph) => paragraph.replace(/(?<!\\)~/g, '\\~');

// Returns the fixed text and the 1-based line numbers that changed. Fixes never add or remove newlines.
export function fixMarkdown(text) {
  const { out, restore } = protect(text);
  const fixed = restore(out.split(/(\n[ \t]*\n)/).map((part, i) => (i % 2 ? part : fixTildes(fixItalic(fixBold(part))))).join(''));
  const a = text.split('\n');
  const b = fixed.split('\n');
  const changed = a.flatMap((line, i) => (line !== b[i] ? [{ line: i + 1, before: line, after: b[i] }] : []));
  return { text: fixed, changed };
}
