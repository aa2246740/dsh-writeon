import type { ProjectFile } from '../domain/entities.js'

/**
 * IndexedDB persistence — plugin-namespaced database `dsh-writeon` holding
 * complete project files plus a small kv store for workspace state.
 * Local-first: no document content ever leaves the browser except the text
 * sent to the AI proxy at the user's explicit request.
 */

const DB_NAME = 'dsh-writeon'
const DB_VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('idb open failed'))
  })
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode)
      const req = run(t.objectStore(store))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('idb request failed'))
      t.onerror = () => reject(t.error ?? new Error('idb transaction failed'))
    })
  } finally {
    db.close()
  }
}

export async function saveProject(project: ProjectFile): Promise<void> {
  await tx('projects', 'readwrite', s => s.put(project))
}

export async function loadProject(id: string): Promise<ProjectFile | undefined> {
  return tx('projects', 'readonly', s => s.get(id) as IDBRequest<ProjectFile | undefined>)
}

export async function deleteProject(id: string): Promise<void> {
  await tx('projects', 'readwrite', s => s.delete(id))
}

export interface ProjectSummary { id: string; title: string; updatedAt: number; words: number }

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx('projects', 'readonly', s => s.getAll() as IDBRequest<ProjectFile[]>)
  return all
    .map(p => ({
      id: p.id,
      title: (p.meta.title || '') as string,
      updatedAt: p.meta.updatedAt,
      words: 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return tx('kv', 'readonly', s => s.get(key) as IDBRequest<T | undefined>)
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await tx('kv', 'readwrite', s => s.put(value, key))
}

/**
 * Cross-window presence: a BroadcastChannel announces which project each tab
 * has open; a second writer for the same project is read-only.
 */
export class Presence {
  private channel: BroadcastChannel | null = null
  private tabId = Math.random().toString(36).slice(2)
  private others = new Set<string>()

  start(projectId: string, onConflict: () => void): void {
    if (typeof BroadcastChannel === 'undefined') return
    this.channel = new BroadcastChannel('dsh-writeon')
    this.channel.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string; tabId: string; projectId: string }
      if (m.tabId === this.tabId) return
      if (m.type === 'open' && m.projectId === projectId) {
        this.others.add(m.tabId)
        onConflict()
        this.channel?.postMessage({ type: 'open', tabId: this.tabId, projectId })
      }
      if (m.type === 'close' && m.projectId === projectId) this.others.delete(m.tabId)
      if (m.type === 'query' && m.projectId === projectId) {
        this.channel?.postMessage({ type: 'open', tabId: this.tabId, projectId })
      }
    }
    this.channel.postMessage({ type: 'query', tabId: this.tabId, projectId })
    this.channel.postMessage({ type: 'open', tabId: this.tabId, projectId })
  }

  stop(projectId: string): void {
    this.channel?.postMessage({ type: 'close', tabId: this.tabId, projectId })
    this.channel?.close()
    this.channel = null
    this.others.clear()
  }
}
