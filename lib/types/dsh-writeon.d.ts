import type { Context } from '@deepseek-ai/cordis';
/**
 * dsh-writeon — Write On host plugin.
 * Registers two same-origin routes under the DSH web server:
 *   GET  /api/writeon/models  → the deployment's live model catalog
 *   POST /api/writeon/ai      → a one-shot llm.stream call (text in, text out)
 * No session state is touched: every call is identity-free and the request
 * body carries everything the model sees (contract: ../domain/contract.ts).
 */
export declare const name = "dsh-writeon";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
