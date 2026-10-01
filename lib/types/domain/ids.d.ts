/**
 * New unique id with a kind prefix. Collision-free inside one client session;
 * project files are namespaced so cross-session collision risk is irrelevant.
 */
export declare function newId(prefix: string): string;
/** Request id for a pending AI call; also embedded in the provider prompt. */
export declare function newRequestId(): string;
/** Stable run id for a Lab/trim run, minted client-side. */
export declare function newRunId(): string;
