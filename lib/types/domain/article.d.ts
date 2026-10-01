/**
 * a/an article linking. Spec rule: when the next word after an article is
 * replaced, adjust a↔an in the same transaction — but only when pronunciation
 * is predictable. Unknown words keep the article untouched (conservative), so
 * we never guess from a bare vowel letter.
 */
export declare function isArticle(text: string): boolean;
/**
 * Decide the article for `nextWord`, or null when pronunciation is unknown —
 * callers must then leave the existing article unchanged.
 */
export declare function articleFor(nextWord: string): 'a' | 'an' | null;
/** Re-apply the case style of `prev` ("A"/"An" capitalized) onto `next`. */
export declare function matchCase(prev: string, next: 'a' | 'an'): string;
