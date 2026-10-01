import type { AiProxyRequest, AiProxyResponse } from '../domain/contract.js';
/**
 * Model access: two independent providers behind one tiny interface.
 * - `http`   — the DSH host proxy at /api/writeon/* (real configured providers)
 * - `test`   — a deterministic local provider for tests and offline runs
 * The verification harness exercises them as separate layers; a green test
 * provider never substitutes for real model integration.
 */
export interface AiProvider {
    kind: 'http' | 'test';
    complete(req: AiProxyRequest, signal: AbortSignal): Promise<AiProxyResponse>;
    listModels(): Promise<{
        provider: string;
        model: string;
        label: string;
    }[]>;
}
export declare class HttpProvider implements AiProvider {
    kind: "http";
    complete(req: AiProxyRequest, signal: AbortSignal): Promise<AiProxyResponse>;
    listModels(): Promise<{
        provider: string;
        model: string;
        label: string;
    }[]>;
}
/**
 * Deterministic local provider used by automated tests and offline runs.
 * Returns structured JSON honoring the contract: echoes request fields and
 * derives alternatives/diagnoses/cuts from the prompt's TEXT section only.
 */
export declare class TestProvider implements AiProvider {
    kind: "test";
    complete(req: AiProxyRequest, signal: AbortSignal): Promise<AiProxyResponse>;
    private respond;
    listModels(): Promise<{
        provider: string;
        model: string;
        label: string;
    }[]>;
}
