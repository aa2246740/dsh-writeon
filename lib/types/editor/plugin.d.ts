import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import type { Step } from 'prosemirror-transform';
import type { Entities, VariantGroup } from '../domain/entities.js';
/** Entity patch entry: a record value replaces the entity, null deletes it. */
export interface EntityPatch {
    __replace?: Entities;
    groups?: Record<string, VariantGroup | null>;
    ghosts?: Record<string, {
        id: string;
        createdAt: number;
    } | null>;
    overflow?: Entities['overflow'] extends Record<string, infer T> ? Record<string, T | null> : never;
    runs?: Entities['runs'] extends Record<string, infer T> ? Record<string, T | null> : never;
}
export interface EntitiesState {
    entities: Entities;
    /** Monotonic counter of document-changing transactions — the revision anchors reference. */
    contentVersion: number;
}
export declare const entitiesKey: PluginKey<EntitiesState>;
export declare function entitiesPlugin(): Plugin<EntitiesState>;
export declare function getEntities(state: EditorState): EntitiesState;
export interface DecoSpec {
    kind: 'trim' | 'diag' | 'focusdim' | 'hint';
    from: number;
    to: number;
    /** extra css class suffix, e.g. goal name for diag */
    cls?: string;
}
export declare const decoKey: PluginKey<DecorationSet>;
export declare function decoPlugin(): Plugin<DecorationSet>;
export declare function setDecorations(state: EditorState, specs: DecoSpec[]): Transaction;
interface UndoEntry {
    /** Forward steps of the recorded transaction (for redo). */
    steps: Step[];
    /** Inverted steps against the pre-transaction doc (for undo). */
    inverted: Step[];
    entitiesBefore: Entities;
    entitiesAfter: Entities;
    selBefore: {
        from: number;
        to: number;
    };
    selAfter: {
        from: number;
        to: number;
    };
    time: number;
    tag: string;
}
interface UndoState {
    undo: UndoEntry[];
    redo: UndoEntry[];
}
export declare const undoKey: PluginKey<UndoState>;
export declare function undoPlugin(): Plugin<UndoState>;
export declare function canUndo(state: EditorState): boolean;
export declare function canRedo(state: EditorState): boolean;
/** Undo the most recent recorded transaction: restores doc, entities, and selection atomically. */
export declare function undoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean;
/** Redo replays the recorded forward steps plus the entity snapshot — one entry, one transaction. */
export declare function redoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean;
export {};
