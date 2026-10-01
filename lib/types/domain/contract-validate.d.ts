import { type FlatLeaf } from './anchors.js';
import type { AiStructuredResponse, AlternativesResponse, DiagnoseResponse, TrimResponse } from './contract.js';
/**
 * Strict validation of model responses per the spec's contract rules:
 * echo of requestId/baseRevision/baseHash must match the pending run, and
 * every anchor must land exactly on the document the model saw.
 */
export type RejectReason = 'not-json' | 'wrong-kind' | 'request-id-mismatch' | 'base-mismatch' | 'bad-payload' | 'bad-anchor' | 'empty';
export interface Rejected {
    ok: false;
    reason: RejectReason;
    detail: string;
}
export interface Accepted<T extends AiStructuredResponse> {
    ok: true;
    response: T;
}
export declare function validateAlternatives(v: unknown, expected: {
    requestId: string;
    baseRevision: number;
    baseHash: string;
}): Accepted<AlternativesResponse> | Rejected;
export declare function validateDiagnose(v: unknown, expected: {
    requestId: string;
    baseRevision: number;
    baseHash: string;
}, leaves: FlatLeaf[], mode: 'diagnose' | 'fix'): Accepted<DiagnoseResponse> | Rejected;
export declare function validateTrim(v: unknown, expected: {
    requestId: string;
    baseRevision: number;
    baseHash: string;
    level: number;
}, leaves: FlatLeaf[]): Accepted<TrimResponse> | Rejected;
