export interface StorageInfo {
  usage: number | null
  quota: number | null
  /** null when the browser can't tell. */
  persisted: boolean | null
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const s = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!s) return { usage: null, quota: null, persisted: null }
  const [est, persisted] = await Promise.all([
    s.estimate?.().catch(() => undefined),
    s.persisted?.().catch(() => null),
  ])
  return {
    usage: est?.usage ?? null,
    quota: est?.quota ?? null,
    persisted: persisted ?? null,
  }
}

/** Asks the browser not to evict our data. Returns whether it is now persistent. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}
