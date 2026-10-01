import { type Node as PMNode } from 'prosemirror-model';
import { type EditorState, type Transaction } from 'prosemirror-state';
import type { Entities, LabRun, Proposal, Scope, VariantGroup } from '../domain/entities.js';
/**
 * Domain commands: every mutation is ONE PM transaction carrying doc steps
 * plus an entity patch, so undo/redo restores both atomically. Commands are
 * pure transforms — they never dispatch; the controller does.
 */
export type CmdResult = {
    ok: true;
    tr: Transaction;
} | {
    ok: false;
    error: string;
    conflicts?: string[];
};
/** Create a variant group over the current selection. */
export declare function createVariant(state: EditorState, entities: Entities, scope: Scope): CmdResult;
/** Expand a would-be variant range to fully cover every partially crossed group. */
export declare function expandVariantRange(state: EditorState, entities: Entities): {
    from: number;
    to: number;
};
/** Replace a group's live range with another option — the atomic variant switch. */
export declare function selectOption(state: EditorState, entities: Entities, gid: string, optionId: string): CmdResult;
/** Cycle to the next/previous option (order: original first, then by createdAt). */
export declare function cycleOption(state: EditorState, entities: Entities, gid: string, dir: 1 | -1): CmdResult;
/** Append AI (or manual) options to a group without switching. */
export declare function addOptions(state: EditorState, entities: Entities, gid: string, texts: string[], origin: 'author' | 'ai', scope: Scope): CmdResult;
/** Update an option's text from the panel; live range replaced when it is active. */
export declare function editOptionText(state: EditorState, entities: Entities, gid: string, optionId: string, text: string): CmdResult;
/** Remove an option (original can never be removed; removing the active one reverts to original). */
export declare function deleteOption(state: EditorState, entities: Entities, gid: string, optionId: string): CmdResult;
/** Ghost the current selection: one ghost span per contiguous covered run. */
export declare function ghostSelection(state: EditorState): CmdResult;
/** Revive: remove the ghost mark over the span under `pos` (or over `sid`). */
export declare function reviveGhost(state: EditorState, at: {
    pos?: number;
    sid?: string;
}): CmdResult;
/**
 * Stash the selection into Overflow: auto-expands to whole variant boundaries,
 * cuts the range, and records the cut content plus the ids of the entities it
 * carries. Entity records stay in the table as tombstones — the item can
 * always be pasted back (copies get fresh ids).
 */
export declare function stashSelection(state: EditorState, entities: Entities): CmdResult;
/**
 * Paste an Overflow item back: always a copy with fresh entity ids (the panel
 * item stays). `at` defaults to the end of the document as new blocks.
 */
export declare function insertOverflowCopy(state: EditorState, entities: Entities, itemId: string, at?: number): CmdResult;
/** Edit an overflow item's stored fragment from the panel (plain-text rewrite). */
export declare function updateOverflowText(state: EditorState, entities: Entities, itemId: string, text: string): CmdResult;
export declare function deleteOverflowItem(state: EditorState, itemId: string): CmdResult;
export declare function putRun(state: EditorState, run: LabRun): CmdResult;
export declare function updateRun(state: EditorState, entities: Entities, runId: string, mutate: (run: LabRun) => LabRun): CmdResult;
export declare function setProposalStatus(state: EditorState, entities: Entities, runId: string, proposalId: string, status: Proposal['status']): CmdResult;
/**
 * Commit a trim run: validates every still-pending/cut proposal against the
 * CURRENT document, then deletes them all in one transaction. Any invalid or
 * boundary-crossing cut marks the run conflict and nothing is applied —
 * Make-the-cuts is all-or-nothing.
 */
export declare function applyTrimCuts(state: EditorState, entities: Entities, runId: string, leafs: {
    leafId: string;
    textStart: number;
}[]): CmdResult;
/** Restore a trim run's baseline document (the "Original" action after cuts). */
export declare function restoreBaseline(state: EditorState, entities: Entities, runId: string): CmdResult;
/** Move selection into a group's active range (used by panel focus + cycle keys). */
export declare function selectGroupRange(state: EditorState, entities: Entities, gid: string): CmdResult;
/** Group under a document position (smallest containing live range). */
export declare function groupAt(doc: PMNode, entities: Entities, pos: number): VariantGroup | undefined;
