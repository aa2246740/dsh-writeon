import type { IncomingMessage, ServerResponse } from 'node:http';
/** Trusted-request guard: the socket must be loopback and the Origin (when
 * present) must match the request's own host — same policy other host plugins use. */
export declare function trustedRequest(req: IncomingMessage): boolean;
export declare function json(res: ServerResponse, status: number, body: unknown): void;
export declare function readJson(req: IncomingMessage, limit?: number): Promise<unknown>;
