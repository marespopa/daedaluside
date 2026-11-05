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
      <div
        className="mx-auto py-12"
        style={{
          maxWidth: 'var(--editor-max-width)',
          paddingInline: 'var(--editor-gutter)',
          boxSizing: 'border-box',
        }}
      >
        {LINES.map((width, i) => (
          // Same row height as the editor: font size times line height.
          <div
            key={i}
            className="flex items-center"
            style={{
              height:
                'calc(var(--editor-font-size, 14px) * var(--editor-line-height, 1.5))',
            }}
          >
            {width > 0 && <Skeleton className="h-2.5" style={{ width: `${width}%` }} />}
          </div>
        ))}
      </div>
    </div>
  )
}
