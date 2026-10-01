import { type ProjectFile } from './entities.js';
/**
 * Project (de)serialization with schema migration and backup.
 * Unknown future versions are refused, never silently misparsed; each older
 * version gets a named migration step and the pre-migration JSON is returned
 * as a backup string for the caller to keep.
 */
export interface LoadResult {
    project: ProjectFile;
    /** Non-null when the file was migrated: the original file text. */
    backup?: string;
    migratedFrom?: number;
}
export interface LoadError {
    kind: 'not-json' | 'not-project' | 'newer-schema' | 'corrupt';
    detail: string;
}
export declare function serializeProject(project: ProjectFile): string;
/** Minimal structural check — enough to reject non-project JSON. */
export declare function looksLikeProject(v: unknown): v is ProjectFile;
export declare function deserializeProject(text: string, fallbackId: string): LoadResult | {
    error: LoadError;
};
/** Fresh empty project shell; the caller fills `doc` from the schema. */
export declare function newProject(id: string, doc: unknown): ProjectFile;
