import type { ProjectFile } from '../domain/entities.js';
export declare function saveProject(project: ProjectFile): Promise<void>;
export declare function loadProject(id: string): Promise<ProjectFile | undefined>;
export declare function deleteProject(id: string): Promise<void>;
export interface ProjectSummary {
    id: string;
    title: string;
    updatedAt: number;
    words: number;
}
export declare function listProjects(): Promise<ProjectSummary[]>;
export declare function kvGet<T>(key: string): Promise<T | undefined>;
export declare function kvSet(key: string, value: unknown): Promise<void>;
/**
 * Cross-window presence: a BroadcastChannel announces which project each tab
 * has open; a second writer for the same project is read-only.
 */
export declare class Presence {
    private channel;
    private tabId;
    private others;
    start(projectId: string, onConflict: () => void): void;
    stop(projectId: string): void;
}
