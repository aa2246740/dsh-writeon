/**
 * Prompt builders. The model contract is embedded in every prompt: echo the
 * requestId/baseRevision/baseHash verbatim and answer with one ```json block.
 */
export interface LeafPayload {
    leafId: string;
    text: string;
}
export declare function alternativesPrompt(args: {
    requestId: string;
    baseRevision: number;
    baseHash: string;
    scope: 'word' | 'sentence' | 'paragraph';
    target: string;
    context: string;
    count: number;
}): string;
export type LabGoal = 'fix-punctuation' | 'weakest-sentences' | 'long-sentences' | 'convoluted-sentences' | 'tone-misfit' | 'hedges-filler';
export declare function labPrompt(args: {
    requestId: string;
    baseRevision: number;
    baseHash: string;
    goal: LabGoal;
    fix: boolean;
    leaves: LeafPayload[];
    language: string;
}): string;
export declare function trimPrompt(args: {
    requestId: string;
    baseRevision: number;
    baseHash: string;
    level: number;
    targetWords: number;
    currentWords: number;
    leaves: LeafPayload[];
    language: string;
}): string;
