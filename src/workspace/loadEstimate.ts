import { useEffect, useState } from 'react'

export interface LoadProgress {
  done: number
  total: number | null
  /** `Date.now()` when the read began. */
  startedAt?: number
}

const KEY = (wsId: string) => `daedalus.treeCount.${wsId}`

/** The entry count of this workspace's last full read, or null when unknown. */
export function loadKnownCount(wsId: string): number | null {
  try {
    const n = Number(localStorage.getItem(KEY(wsId)))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function saveKnownCount(wsId: string, count: number) {
  try {
    localStorage.setItem(KEY(wsId), String(count))
  } catch {
    // storage may be unavailable; the estimate just starts blank next time
  }
}

/** Milliseconds left at the average rate so far; null while the guess would be noise. */
export function remainingMs(
  done: number,
  total: number | null,
  elapsedMs: number,
): number | null {
  if (!total || done <= 0 || elapsedMs < 1000 || done >= total) return null
  return ((total - done) / done) * elapsedMs
}

export function formatEta(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 5) return 'a few seconds left'
  if (s < 60) return `about ${Math.round(s / 5) * 5}s left`
  const m = Math.floor(s / 60)
  const rest = Math.round((s % 60) / 10) * 10
  return rest === 60
    ? `about ${m + 1}m left`
    : `about ${m}m${rest ? ` ${rest}s` : ''} left`
}

/** Elapsed seconds and an ETA string for a running read; both null when idle or too early. */
export function useLoadEta(progress: LoadProgress | null): {
  eta: string | null
  elapsed: string | null
} {
  const [now, setNow] = useState(0)
  const running = progress !== null
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [running])
  if (!progress?.startedAt || now === 0) return { eta: null, elapsed: null }
  const elapsedMs = Math.max(0, now - progress.startedAt)
  const left = remainingMs(progress.done, progress.total, elapsedMs)
  return {
    eta: left === null ? null : formatEta(left),
    elapsed: elapsedMs >= 2000 ? `${Math.round(elapsedMs / 1000)}s` : null,
  }
}
