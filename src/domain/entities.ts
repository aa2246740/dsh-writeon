/**
 * Write On entity model — the serializable half of a project.
 * Positions never live here; ranges are always re-derived from the document
 * (boundary markers for variants, marks for ghosts) so entities stay valid
 * across edits. Fragments are ProseMirror node JSON in the Write On schema.
 */

export type Scope = 'word' | 'sentence' | 'paragraph'
export type OptionOrigin = 'author' | 'ai'

/** One immutable branch of a variant group. `fragment` is the last known content of that branch. */
export interface VariantOption {
  id: string
  origin: OptionOrigin
  /** Set when a human typed inside an AI-authored branch. */
  editedBy?: 'user' | 'ai'
  /** Schema node JSON array: inline nodes for word/sentence scope, block nodes for paragraph. */
  fragment: unknown[]
  createdAt: number
}

/** A variant group: original snapshot plus alternatives around one bounded range. */
export interface VariantGroup {
  id: string
  scope: Scope
  /** true when the group became only a wrapper (empty) or its markers were deleted; kept for undo. */
  deleted?: boolean
  originalOptionId: string
  currentOptionId: string
  options: Record<string, VariantOption>
  createdAt: number
}

/** A manual Ghost span. Ranges live as `ghost` marks carrying this id. */
export interface GhostSpan {
  id: string
  createdAt: number
}

/** An Overflow item: stashed content kept with the entities it references. */
export interface OverflowItem {
  id: string
  /** Block-node JSON array as stashed (may contain variant markers and ghost marks). */
  fragment: unknown[]
  /** Entity records needed to interpret `fragment`, deep-copied at stash time. */
  entities: {
    groups: Record<string, VariantGroup>
    ghostIds: string[]
  }
  createdAt: number
}

export type ProposalStatus = 'pending' | 'keep' | 'cut' | 'skip' | 'conflict'
export type RunStatus = 'pending' | 'applied' | 'conflict' | 'stale' | 'cancelled' | 'done' | 'rejected'

/** One validated AI proposal against a text anchor. */
export interface Proposal {
  id: string
  /** Anchor into the flattened leaf the model saw (leafId from flatten()). */
  anchor: { leafId: string; from: number; to: number; quote: string }
  category: string
  reason?: string
  before?: string
  after?: string
  status: ProposalStatus
}

export type RunMode =
  | 'alternatives'
  | 'lab-mark'
  | 'lab-fix'
  | 'trim'

/** A Lab diagnostic or trim run, kept so review state survives save/reload. */
export interface LabRun {
  id: string
  mode: RunMode
  /** Lab mark/fix goal key, or trim level (10|20|30|50). */
  goal?: string
  level?: number
  /** Document contentVersion the model analyzed; edits bump this and stale the run. */
  baseRevision: number
  baseHash: string
  /** For trim: snapshot of the doc the cuts were computed against (Original baseline). */
  baselineDoc?: unknown
  baselineStats?: { words: number }
  proposals: Proposal[]
  status: RunStatus
  createdAt: number
  /** Which scope this alternatives run belongs to. */
  groupId?: string
  scope?: Scope
}

/** Serializable entity table — the whole non-document half of a project. */
export interface Entities {
  groups: Record<string, VariantGroup>
  ghosts: Record<string, GhostSpan>
  overflow: Record<string, OverflowItem>
  runs: Record<string, LabRun>
}

export function emptyEntities(): Entities {
  return { groups: {}, ghosts: {}, overflow: {}, runs: {} }
}

/** Structural (non-doc) project metadata persisted beside doc+entities. */
export interface ProjectMeta {
  title: string
  createdAt: number
  updatedAt: number
  /** Preferred target length setting, 0 = unset. */
  targetLength: number
}

export const SCHEMA_VERSION = 1

/** The on-disk project document: schema-versioned, doc + entities + meta. */
export interface ProjectFile {
  schemaVersion: number
  id: string
  /** ProseMirror doc JSON in the Write On schema. */
  doc: unknown
  entities: Entities
  meta: ProjectMeta
  /** Monotonic save counter; used for cross-tab conflict detection. */
  revision: number
}
