let counter = 0

/**
 * New unique id with a kind prefix. Collision-free inside one client session;
 * project files are namespaced so cross-session collision risk is irrelevant.
 */
export function newId(prefix: string): string {
  counter = (counter + 1) % 0xffff
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

/** Request id for a pending AI call; also embedded in the provider prompt. */
export function newRequestId(): string {
  return newId('req')
}

/** Stable run id for a Lab/trim run, minted client-side. */
export function newRunId(): string {
  return newId('run')
}
