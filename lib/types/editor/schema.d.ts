import { Schema } from 'prosemirror-model';
/**
 * Write On schema.
 *
 * Variant boundaries live IN the document as inline marker nodes (`vstart` /
 * `vend`) for word/sentence scope and as a block container (`vblock`) for
 * paragraph scope, so every boundary moves with normal edits — no
 * position-tracking entity can drift. Ghost is a mark carrying the ghost id.
 */
export declare const schema: Schema<"text" | "paragraph" | "doc" | "heading" | "vblock" | "vstart" | "vend", "link" | "ghost">;
export declare const vstart: import("prosemirror-model").NodeType, vend: import("prosemirror-model").NodeType, vblock: import("prosemirror-model").NodeType, paragraph: import("prosemirror-model").NodeType, heading: import("prosemirror-model").NodeType, text: import("prosemirror-model").NodeType;
export declare const ghost: import("prosemirror-model").MarkType, link: import("prosemirror-model").MarkType;
export declare function emptyDoc(): import("prosemirror-model").Node;
