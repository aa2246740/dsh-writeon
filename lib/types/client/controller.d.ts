import { EditorView } from 'prosemirror-view';
import { type Entities } from '../domain/entities.js';
import { type DocStats } from '../domain/stats.js';
import { type LabGoal } from '../domain/prompts.js';
import * as cmd from '../editor/commands.js';
export interface ModelChoice {
    provider: string;
    model: string;
    label: string;
}
export interface UiState {
    phase: 'welcome' | 'loading' | 'ready' | 'error';
    projectId: string | null;
    projects: {
        id: string;
        title: string;
        updatedAt: number;
    }[];
    saved: 'clean' | 'dirty' | 'saving' | 'error';
    savedAt?: number;
    sidePanel: 'none' | 'alternatives' | 'overflow' | 'lab';
    focusGroupId?: string;
    activeRunId?: string;
    walkIndex?: number;
    models: ModelChoice[];
    modelSel?: ModelChoice;
    providerKind: 'http' | 'test' | 'none';
    aiBusy?: string;
    notice?: string;
    readOnly: boolean;
    conflictTab: boolean;
    hidden: boolean;
    stats: DocStats;
    confirmShare?: {
        kind: 'x';
        text: string;
    };
    sharePreview?: {
        text: string;
        stats: DocStats;
    };
    pendingExpand?: {
        scope: 'word' | 'sentence' | 'paragraph';
    };
    error?: string;
    language: 'zh' | 'en';
}
type Listener = () => void;
export declare class WriteOnController {
    private host;
    private view;
    private ui;
    private listeners;
    private saveTimer;
    private presence;
    private pending;
    private provider;
    private testProvider;
    private project;
    private disposeFns;
    private destroyed;
    private lastDecoSpecs;
    constructor(host: {
        selectPanel(id: string | null): void;
    });
    subscribe: (l: Listener) => (() => void);
    getSnapshot: () => UiState;
    private set;
    private notice;
    get editorView(): EditorView | null;
    get entities(): Entities;
    get contentVersion(): number;
    mount(el: HTMLElement): Promise<void>;
    private initEditor;
    private onTransaction;
    /** Runs whose base no longer matches the doc become stale on any edit. */
    private markStaleRuns;
    /** Dispatch an entity-only patch transaction. */
    private dispatchEntities;
    dispatch(cmdResult: cmd.CmdResult, undoTag?: string): boolean;
    private computeStats;
    /** Recompute overlay decorations: diagnostics + trim preview + focus dim. */
    rebuildDecorations(): void;
    private snapshot;
    private deriveTitle;
    private scheduleSave;
    saveNow(): Promise<void>;
    newDoc(): Promise<void>;
    openDoc(id: string): Promise<void>;
    private loadIntoView;
    removeDoc(id: string): Promise<void>;
    exportDoc(): Promise<void>;
    importDoc(file: File): Promise<void>;
    createVariantCmd(scope: 'word' | 'sentence' | 'paragraph'): void;
    /** Expand the selection to enclose the crossed variant groups and create it. */
    confirmExpand(): void;
    cancelExpand(): void;
    openAlternatives(): void;
    openOverflow(): void;
    openLab(): void;
    closePanel(): void;
    selectOption(gid: string, oid: string): void;
    cycleOption(gid: string, dir: 1 | -1): void;
    editOption(gid: string, oid: string, text: string): void;
    deleteOption(gid: string, oid: string): void;
    addManualOption(gid: string): void;
    ghostToggle(): void;
    reviveGhostAt(pos: number): void;
    stashSelection(): void;
    insertOverflow(itemId: string, at?: number): void;
    deleteOverflowItem(itemId: string): void;
    updateOverflowText(itemId: string, text: string): void;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    private refreshModels;
    setModel(sel: ModelChoice): void;
    switchProvider(kind: 'http' | 'test'): void;
    private activeProvider;
    private callModel;
    cancelAi(): void;
    /** AI alternatives for a group: validate then append options. */
    aiAlternatives(gid: string, count?: number): Promise<void>;
    /** Lab goal: diagnose (mark) or fix. */
    runLab(goal: LabGoal): Promise<void>;
    /** Persist a rejected AI response as a visible run row so the call leaves a durable record. */
    private rejectRun;
    /** Trim at a level; Original=restore baseline handled separately. */
    runTrim(level: number): Promise<void>;
    /** Review actions on proposals. */
    keepProposal(runId: string, proposalId: string): void;
    cutProposal(runId: string, proposalId: string): void;
    skipProposal(runId: string, proposalId: string): void;
    /** Fix-goal proposals apply one at a time at review. */
    acceptFix(runId: string, proposalId: string): void;
    /** Apply all pending/cut proposals of a trim run in one transaction. */
    makeTheCuts(runId: string): void;
    /** Done reviewing: exit review mode, clear preview decorations, keep results. */
    doneReview(runId: string): void;
    /** Original: restore the doc captured when the trim run started. */
    restoreOriginal(runId: string): void;
    /** Walkthrough: focus proposal i, offer Keep/Cut/Skip. */
    walkTo(runId: string, index: number): void;
    sharePreview(): void;
    confirmShareX(): void;
    closeOverlays(): void;
    doShareX(): void;
    setFocusGroup(gid: string | undefined): void;
    toggleHidden(): void;
    destroy(): void;
}
export {};
