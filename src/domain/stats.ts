import { countWords, graphemeLength } from './segment.js'

/** Document statistics for the status bar and share preview. */
export interface DocStats {
  words: number
  chars: number
  /** Estimated reading minutes at 220 wpm EN / 300 cpm CJK blend — coarse. */
  minutes: number
  paragraphs: number
  sentences: number
}

export function computeStats(leaves: { text: string }[]): DocStats {
  let words = 0, chars = 0, sentences = 0
  for (const leaf of leaves) {
    words += countWords(leaf.text)
    chars += graphemeLength(leaf.text)
    sentences += countSentences(leaf.text)
  }
  const minutes = Math.max(1, Math.round(words / 220))
  return { words, chars, minutes, paragraphs: leaves.length, sentences }
}

function countSentences(text: string): number {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' })
  let n = 0
  for (const s of seg.segment(text)) if (!/^\s+$/.test(s.segment)) n += 1
  return n
}
