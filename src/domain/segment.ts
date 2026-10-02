/**
 * Text segmentation helpers over Intl.Segmenter. All offsets are UTF-16 code
 * units — the same unit JavaScript strings and ProseMirror positions use.
 */

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

/** Count grapheme clusters (user-perceived characters, emoji-safe). */
export function graphemeLength(text: string): number {
  if (text === '') return 0
  let n = 0
  for (const _ of graphemeSegmenter.segment(text)) n += 1
  return n
}

/** UTF-16 offset of the next grapheme boundary at or after `index`. */
export function nextGraphemeBoundary(text: string, index: number): number {
  if (index >= text.length) return text.length
  for (const seg of graphemeSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length
    if (seg.index >= index) return seg.index
    if (end >= index) return end
  }
  return text.length
}

/** true when `index` sits on a grapheme boundary of `text`. */
export function isGraphemeBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index === index) return true
    if (seg.index > index) return false
  }
  return true
}

export interface Range { from: number; to: number }

/**
 * Word-like segments of `text`: word boundaries from Intl.Segmenter, with
 * runs of CJK characters emitted per character (ICU word segmentation does
 * not split unspaced CJK into useful units) and pure-whitespace dropped.
 */
export function wordRanges(text: string): Range[] {
  const out: Range[] = []
  for (const seg of wordSegmenter.segment(text)) {
    const { index, segment, isWordLike } = seg
    if (isWordLike === false && /^\s+$/.test(segment)) continue
    // Split CJK runs into per-character ranges so 中文 selection gets word-level units.
    let i = 0
    while (i < segment.length) {
      const ch = segment[i]
      const rest = segment.slice(i)
      const cjk = /^[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/.exec(rest)
      if (cjk !== null) {
        for (const c of cjk[0]) {
          out.push({ from: index + i, to: index + i + c.length })
          i += c.length
        }
        continue
      }
      const run = /^[\p{L}\p{N}\p{M}'’_-]+/u.exec(rest)
      if (run !== null) {
        out.push({ from: index + i, to: index + i + run[0].length })
        i += run[0].length
        continue
      }
      i += ch.length
    }
  }
  return out
}

/**
 * Word units for caret-snapping and variants: ICU dictionary words, so a CJK
 * run stays whole ("写作" is one unit) instead of the per-character ranges
 * `wordRanges` emits for word-count purposes.
 */
export function wordUnitRanges(text: string): Range[] {
  const out: Range[] = []
  for (const seg of wordSegmenter.segment(text)) {
    if (seg.isWordLike === true) out.push({ from: seg.index, to: seg.index + seg.segment.length })
  }
  return out
}

/** Dominant writing language of the text: 'zh' when CJK chars outnumber latin. */
export function detectDocLanguage(text: string): 'zh' | 'en' {
  let cjk = 0, latin = 0
  for (const ch of text) {
    if (/^[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]$/.test(ch)) cjk += 1
    else if (/^[a-zA-Z]$/.test(ch)) latin += 1
  }
  return cjk > latin ? 'zh' : 'en'
}

/** Sentence ranges of `text`, keeping offsets; pure-whitespace gaps dropped. */
export function sentenceRanges(text: string): Range[] {
  const out: Range[] = []
  for (const seg of sentenceSegmenter.segment(text)) {
    const { index, segment } = seg
    if (/^\s+$/.test(segment)) continue
    // Trim trailing whitespace out of the sentence range.
    const trimmed = segment.replace(/\s+$/, '')
    if (trimmed.length > 0) out.push({ from: index, to: index + trimmed.length })
  }
  return out
}

/**
 * Word-level counts: English/CJK-friendly count where each CJK character
 * counts as one word and each latin word counts as one.
 */
export function countWords(text: string): number {
  return wordRanges(text).length
}
