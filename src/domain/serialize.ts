import { emptyEntities, SCHEMA_VERSION, type Entities, type ProjectFile, type ProjectMeta } from './entities.js'

/**
 * Project (de)serialization with schema migration and backup.
 * Unknown future versions are refused, never silently misparsed; each older
 * version gets a named migration step and the pre-migration JSON is returned
 * as a backup string for the caller to keep.
 */

export interface LoadResult {
  project: ProjectFile
  /** Non-null when the file was migrated: the original file text. */
  backup?: string
  migratedFrom?: number
}

export interface LoadError {
  kind: 'not-json' | 'not-project' | 'newer-schema' | 'corrupt'
  detail: string
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Minimal structural check — enough to reject non-project JSON. */
export function looksLikeProject(v: unknown): v is ProjectFile {
  if (!isObject(v)) return false
  if (typeof v.schemaVersion !== 'number' || typeof v.id !== 'string') return false
  if (!isObject(v.doc) || !isObject(v.entities) || !isObject(v.meta)) return false
  const e = v.entities
  if (!isObject(e.groups) || !isObject(e.ghosts) || !isObject(e.overflow) || !isObject(e.runs)) return false
  return true
}

function migrate(from: number, project: ProjectFile): ProjectFile {
  // v1 is the current schema; future migrations chain from here.
  if (from === SCHEMA_VERSION) return project
  return project
}

export function deserializeProject(text: string, fallbackId: string): LoadResult | { error: LoadError } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: { kind: 'not-json', detail: 'file is not valid JSON' } }
  }
  if (!looksLikeProject(raw)) {
    return { error: { kind: 'not-project', detail: 'file is not a Write On project' } }
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return { error: { kind: 'newer-schema', detail: `schema v${raw.schemaVersion} newer than supported v${SCHEMA_VERSION}` } }
  }
  const migratedFrom = raw.schemaVersion < SCHEMA_VERSION ? raw.schemaVersion : undefined
  const project = migrate(raw.schemaVersion, raw)
  return { project, backup: migratedFrom !== undefined ? text : undefined, migratedFrom }
}

/** Fresh empty project shell; the caller fills `doc` from the schema. */
export function newProject(id: string, doc: unknown): ProjectFile {
  const now = Date.now()
  const meta: ProjectMeta = { title: '', createdAt: now, updatedAt: now, targetLength: 0 }
  return { schemaVersion: SCHEMA_VERSION, id, doc, entities: emptyEntities(), meta, revision: 0 }
}
