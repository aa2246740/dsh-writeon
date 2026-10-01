import type { Node as PMNode } from 'prosemirror-model';
import type { FlatLeaf } from '../domain/anchors.js';
import type { Scope } from '../domain/entities.js';
/**
 * Document queries — everything here derives positions from the doc itself,
 * never from stored coordinates. A group range lives between its marker
 * nodes; a ghost range is a contiguous run of `ghost` marks.
 */
export interface GroupRange {
    /** Positions covering the markers themselves: [from, to). */
    from: number;
    to: number;
    /** Positions covering the active content inside the markers. */
    innerFrom: number;
    innerTo: number;
    /** PM node for paragraph scope (the vblock). */
    node?: PMNode;
}
/** Locate a variant group's live range by gid. Null when any marker is missing. */
export declare function groupRange(doc: PMNode, gid: string, scope: Scope): GroupRange | null;
/** All live group ids present in the doc (with scope). */
export declare function liveGroupIds(doc: PMNode): Map<string, Scope>;
/** The content inside a range as node JSON — a fragment suitable for an option. */
export declare function fragmentJSON(doc: PMNode, from: number, to: number): unknown[];
/** Flattened leaves for AI calls: every textblock in doc order. */
export declare function flatten(doc: PMNode): FlatLeaf[];
/** Map an anchor inside a leaf to a PM position. */
export declare function anchorPos(leaf: FlatLeaf, offset: number): number;
export interface GhostRange {
    sid: string;
    from: number;
    to: number;
}
/** Contiguous ranges per ghost id — marks split per text node but merge when adjacent. */
export declare function ghostRanges(doc: PMNode): GhostRange[];
/**
 * Groups whose marker ranges the [from,to) span crosses partially (intersects
 * a group range without fully covering it or being fully inside it).
 * Fully-contained groups are legal nesting and do not conflict.
 */
export declare function partialCross(doc: PMNode, from: number, to: number, gidScopes: Map<string, Scope>): string[];
/** Expand [from,to) just enough to fully cover every group it partially crosses. */
export declare function expandToWholeGroups(doc: PMNode, from: number, to: number, gidScopes: Map<string, Scope>): {
    from: number;
    to: number;
};
/**
 * Expand [from,to) until it fully COVERS every group it touches — Stash's rule.
 * Unlike expandToWholeGroups, a selection strictly inside a group still expands
 * outward to the group's boundaries so markers never get orphaned mid-cut.
 */
export declare function expandToEnclose(doc: PMNode, from: number, to: number, gidScopes: Map<string, Scope>): {
    from: number;
    to: number;
};
/** Whether [from,to) lies inside a single textblock (word/sentence scope legality). */
export declare function singleTextblock(doc: PMNode, from: number, to: number): {
    parent: PMNode;
    pos: number;
} | null;
/**
 * Whether any step of `tr` touched content inside [from,to) in NEW positions.
 * Steps whose map output only covers the boundary markers do not count.
 */
export declare function stepsTouchRange(steps: readonly {
    getMap(): {
        forEach(cb: (oS: number, oE: number, nS: number, nE: number) => void): void;
    };
}[], from: number, to: number): boolean;
/** The latin word immediately before `pos` inside its textblock — for a/an linking.
 * Trailing marker atoms (\0) and whitespace are skipped so `a |cat|` finds `a`. */
export declare function wordBefore(doc: PMNode, pos: number): {
    word: string;
    from: number;
    to: number;
} | null;
/** First latin word of a replacement text — the word that follows the article. */
export declare function firstWord(text: string): string;
