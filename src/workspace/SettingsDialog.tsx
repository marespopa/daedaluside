import { useAtom, useAtomValue, useStore } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { vimEnabledAtom } from '../state/editorAtoms'
import { settingsOpenAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import { Button } from '../ui'
import {
  formatBytes,
  getStorageInfo,
  requestPersistence,
  type StorageInfo,
} from './storage'
import { focusEditor } from './useWorkspace'

export default function SettingsDialog() {
  const [open, setOpen] = useAtom(settingsOpenAtom)
  return open ? <Dialog onClose={() => setOpen(false)} /> : null
}

function Dialog({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const status = useAtomValue(workspaceStatusAtom)
  const [vim, setVim] = useAtom(vimEnabledAtom)
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let live = true
    void getStorageInfo().then((i) => live && setInfo(i))
    closeBtn.current?.focus()
    return () => {
      live = false
      focusEditor(store)
    }
  }, [store])

  const persist = async () => {
    await requestPersistence()
    setInfo(await getStorageInfo())
  }

  const pct =
    info?.usage != null && info.quota
      ? Math.min(100, (info.usage / info.quota) * 100)
      : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/60 px-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="glass w-full max-w-md rounded-xl border border-line p-5 font-sans text-sm shadow-lg"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium">Settings</h2>
          <Button ref={closeBtn} variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <section aria-labelledby="storage-h" className="space-y-2">
          <h3 id="storage-h" className="text-xs tracking-wide text-muted uppercase">
            Storage
          </h3>
          <p>
            Files are stored on this device using{' '}
            {status.state === 'ready' ? 'IndexedDB' : '…'}
            .
          </p>
          {info?.usage != null && info.quota != null ? (
            <div>
              <div
                role="progressbar"
                aria-label="Storage used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct ?? 0)}
                className="h-1.5 overflow-hidden rounded-full bg-line"
              >
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.max(pct ?? 0, 0.5)}%` }}
                />
              </div>
              <p className="mt-1 text-muted">
                {formatBytes(info.usage)} used of {formatBytes(info.quota)}
              </p>
            </div>
          ) : (
            <p className="text-muted">Usage is not available in this browser.</p>
          )}
          <p>
            Persistent storage:{' '}
            <strong>
              {info?.persisted == null
                ? 'unknown'
                : info.persisted
                  ? 'granted'
                  : 'not granted'}
            </strong>
          </p>
          {info?.persisted === false && (
            <>
              <p className="text-muted">
                Without it, the browser may delete workspaces when disk space is low.
                Export a zip to keep a backup.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void persist()}>
                Request persistent storage
              </Button>
            </>
          )}
        </section>

        <section aria-labelledby="editing-h" className="mt-5 space-y-2">
          <h3 id="editing-h" className="text-xs tracking-wide text-muted uppercase">
            Editing
          </h3>
          <div className="flex items-center justify-between gap-3">
            <p>Vim mode</p>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Vim mode"
              aria-pressed={vim}
              onClick={() => setVim(!vim)}
            >
              {vim ? 'On' : 'Off'}
            </Button>
          </div>
          <p className="text-muted">
            Modal editing with motions, text objects and : commands. :Explore opens the
            file tree.
          </p>
        </section>
      </div>
    </div>
  )
}
