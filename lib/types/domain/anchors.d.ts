/**
 * Anchors: stable references into the flattened document a model saw.
 * A leaf = one text block's plain text in doc order (variants contribute only
 * the active branch; ghost text is normal text to the model).
 * Positions are UTF-16 offsets inside that leaf's text.
 */
export interface FlatLeaf {
    /** Stable leaf id — the PM block's bid. */
    leafId: string;
    /** PM position where the leaf's text starts, for mapping anchors back. */
    textStart: number;
    text: string;
}
export interface Anchor {
    leafId: string;
    /** [from, to) UTF-16 offsets inside leaf text; to===from allowed (caret). */
    from: number;
    to: number;
    quote: string;
}
/** djb2-style hex hash of a string — enough to fingerprint the base the model saw. */
export declare function textHash(text: string): string;
/** Hash over the flattened leaves — what goes into AI requests as baseHash. */
export declare function docHash(leaves: FlatLeaf[]): string;
export interface AnchorError {
    kind: 'unknown-leaf' | 'range-out-of-bounds' | 'quote-mismatch' | 'grapheme-boundary' | 'empty-range';
    detail: string;
}
/** Validate one anchor against the current flatten. Returns the leaf on success. */
export declare function validateAnchor(leaves: FlatLeaf[], anchor: Anchor): {
    leaf: FlatLeaf;
} | {
    error: AnchorError;
};
/**
 * Strict validation first; on a quote-mismatch alone, fall back to
 * repairAnchor — the strict error otherwise stands.
 */
export declare function resolveAnchor(leaves: FlatLeaf[], anchor: Anchor): {
    leaf: FlatLeaf;
    anchor: Anchor;
} | {
    error: AnchorError;
};
/**
 * Repair an anchor whose offsets do not land on its quote. Models often get
 * the quote text right but compute offsets wrong — when the quote occurs
 * exactly once in the leaf, the anchor is repaired to that occurrence.
 * Returns the repaired anchor, or null when the quote is absent/ambiguous
 * (the strict validation error then stands).
 */
export declare function repairAnchor(leaf: FlatLeaf, anchor: Anchor): Anchor | null;
/**
 * Check that a proposed cut/deletion set is acceptable: every anchor valid,
 * non-overlapping, and sorted-by-position-able. Returns validated proposals or
 * the first error.
 */
export declare function validateCuts(leaves: FlatLeaf[], cuts: {
    anchor: Anchor;
}[]): {
    ok: true;
} | {
    ok: false;
    error: AnchorError;
    index: number;
};
