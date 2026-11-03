import { useStore } from 'jotai'
import { useEffect, useMemo } from 'react'
import { editorHandleAtom } from '../state/editorAtoms'
import {
  activePathAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
} from '../state/workspaceAtoms'
import { getController } from './controller'

export function useController() {
  const store = useStore()
  return useMemo(() => getController(store), [store])
}

/**
 * Starts the workspace and installs Mod-B / Mod-S / Mod-, / Mod-Alt-W plus flush-on-hide.
 * Mod-W is reserved by browsers, so closing a tab uses Mod-Alt-W.
 */
export function useWorkspaceLifecycle() {
  const store = useStore()
  const controller = useController()

  useEffect(() => {
    void controller.init()
    const onKey = (e: KeyboardEvent) => {
      // Match the physical key: with Alt held, e.key can be a symbol (Option+W on macOS).
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyW') {
        e.preventDefault()
        const active = store.get(activePathAtom)
        if (active) void controller.closeBuffer(active)
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'b') {
        e.preventDefault()
        store.set(sidebarOpenAtom, (o) => !o)
      } else if (key === 's') {
        e.preventDefault() // never open the browser's "save page" dialog
        void controller.saveActive()
      } else if (key === ',') {
        e.preventDefault()
        store.set(settingsOpenAtom, true)
      }
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') controller.flushOnHide()
    }
    const onPageHide = () => controller.flushOnHide()
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [controller, store])
}

export function focusEditor(store: ReturnType<typeof useStore>) {
  store.get(editorHandleAtom)?.view.focus()
}
