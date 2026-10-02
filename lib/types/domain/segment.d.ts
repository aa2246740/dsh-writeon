/**
 * Text segmentation helpers over Intl.Segmenter. All offsets are UTF-16 code
 * units — the same unit JavaScript strings and ProseMirror positions use.
 */
/** Count grapheme clusters (user-perceived characters, emoji-safe). */
export declare function graphemeLength(text: string): number;
/** UTF-16 offset of the next grapheme boundary at or after `index`. */
export declare function nextGraphemeBoundary(text: string, index: number): number;
/** true when `index` sits on a grapheme boundary of `text`. */
export declare function isGraphemeBoundary(text: string, index: number): boolean;
export interface Range {
    from: number;
    to: number;
}
/**
 * Word-like segments of `text`: word boundaries from Intl.Segmenter, with
 * runs of CJK characters emitted per character (ICU word segmentation does
 * not split unspaced CJK into useful units) and pure-whitespace dropped.
 */
export declare function wordRanges(text: string): Range[];
/**
 * Word units for caret-snapping and variants: ICU dictionary words, so a CJK
 * run stays whole ("写作" is one unit) instead of the per-character ranges
 * `wordRanges` emits for word-count purposes.
 */
export declare function wordUnitRanges(text: string): Range[];
/** Dominant writing language of the text: 'zh' when CJK chars outnumber latin. */
export declare function detectDocLanguage(text: string): 'zh' | 'en';
/** Sentence ranges of `text`, keeping offsets; pure-whitespace gaps dropped. */
export declare function sentenceRanges(text: string): Range[];
/**
 * Word-level counts: English/CJK-friendly count where each CJK character
 * counts as one word and each latin word counts as one.
 */
export declare function countWords(text: string): number;
