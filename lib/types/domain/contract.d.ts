/**
 * AI wire contract — the JSON shapes the model must return, plus the
 * client→host proxy envelope. Validation lives in contract-validate.ts.
 * The contract never assumes structured output: models answer with a JSON
 * code block; the program parses and validates strictly.
 */
/** Client → host proxy request. `provider`/`model` are DSH catalog ids. */
export interface AiProxyRequest {
    requestId: string;
    provider: string;
    model: string;
    system?: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
}
/** Host → client proxy response. `text` is the assembled completion. */
export interface AiProxyResponse {
    ok: boolean;
    requestId: string;
    text?: string;
    reason?: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
}
export type AiResponseKind = 'alternatives' | 'diagnose' | 'fix' | 'trim';
interface BaseFields {
    kind: AiResponseKind;
    requestId: string;
    baseRevision: number;
    baseHash: string;
}
export interface AlternativesResponse extends BaseFields {
    kind: 'alternatives';
    items: {
        text: string;
        reason?: string;
    }[];
}
export interface DiagnoseResponse extends BaseFields {
    kind: 'diagnose' | 'fix';
    proposals: {
        leafId: string;
        from: number;
        to: number;
        quote: string;
        category: string;
        reason?: string;
        /** fix mode only: replacement text for the anchored range. */
        after?: string;
    }[];
}
export interface TrimResponse extends BaseFields {
    kind: 'trim';
    level: number;
    cuts: {
        leafId: string;
        from: number;
        to: number;
        quote: string;
        reason?: string;
    }[];
}
export type AiStructuredResponse = AlternativesResponse | DiagnoseResponse | TrimResponse;
/**
 * Extract the JSON payload from raw model text: prefer the last ```json code
 * block, else the largest balanced {...} span. Returns the parsed object.
 */
export declare function extractJson(raw: string): unknown | undefined;
export {};
