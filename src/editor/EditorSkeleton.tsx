import { Skeleton } from '../ui'

// Line lengths as a share of the column; 0 is a blank line. Mirrors the rhythm of
// real prose or code, so the text appears in the same place once it loads.
const LINES = [58, 82, 40, 0, 70, 91, 55, 76, 33, 0, 64, 85, 47]

/** Placeholder for the editor while the last file is being restored. */
export default function EditorSkeleton() {
  return (
    <div
      data-testid="editor-skeleton"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-canvas"
    >
      <div className="mx-auto max-w-[72ch] px-8 py-12">
        {LINES.map((width, i) => (
          // 14 px font at leading 1.65, the same row height as the editor.
          <div key={i} className="flex h-[23px] items-center">
            {width > 0 && <Skeleton className="h-2.5" style={{ width: `${width}%` }} />}
          </div>
        ))}
      </div>
    </div>
  )
}
