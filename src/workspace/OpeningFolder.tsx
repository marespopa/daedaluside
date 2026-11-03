import type { ImportStatus } from '../state/workspaceAtoms'

const count = (n: number) => n.toLocaleString()

function detail({ done, total }: ImportStatus): string {
  if (total !== null) return `Copying ${count(done)} of ${count(total)} items`
  return done > 0 ? `Found ${count(done)} items so far` : 'Reading files'
}

/**
 * Stands in for the editor and its blank page while a folder or zip is imported.
 * Covers the editor pane until the imported folder's first file has opened.
 */
export default function OpeningFolder({ status }: { status: ImportStatus }) {
  const pct = status.total ? Math.min(100, (status.done / status.total) * 100) : null
  return (
    <section
      role="status"
      aria-label="Opening folder"
      className="absolute inset-0 flex items-center justify-center bg-canvas font-sans text-text"
    >
      <div className="w-full max-w-[420px] space-y-4 px-6">
        <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
          Opening
        </p>
        <h2 className="truncate text-xl font-normal tracking-tight">{status.name}</h2>
        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={status.total ?? undefined}
          aria-valuenow={status.total === null ? undefined : status.done}
          className="h-1 overflow-hidden rounded-full bg-line"
        >
          {pct === null ? (
            <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-pulse" />
          ) : (
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <p className="text-sm text-muted">{detail(status)}</p>
      </div>
    </section>
  )
}
