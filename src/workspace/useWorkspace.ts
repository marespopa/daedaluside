import { useStore } from 'jotai'
import { useEffect, useMemo } from 'react'
import { bindVimHost } from '../editor/vimMode'
import { matchFiles } from '../editor/paletteSearch'
import { getReviewPane } from '../review/reviewPane'
import { branchReviewAtom, branchTabActiveAtom } from '../state/branchReviewAtoms'
import { gitHeadAtom, reviewLayoutAtom, reviewOpenAtom } from '../state/gitAtoms'
import {
  editorHandleAtom,
  grepOpenAtom,
  grepQueryAtom,
  vimStatusAtom,
} from '../state/editorAtoms'
import {
  activePathAtom,
  fileTreeFocusAtom,
  noticeAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
  treeAtom,
} from '../state/workspaceAtoms'
import { getController } from './controller'

export function useController() {
  const store = useStore()
  return useMemo(() => getController(store), [store])
}

/**
 * Starts the workspace, binds the Vim host, and installs Mod-B / Mod-S / Mod-, /
 * Mod-Alt-W / Ctrl-W W plus flush-on-hide.
 * Mod-W is reserved by browsers, so closing a tab uses Mod-Alt-W.
 */
export function useWorkspaceLifecycle() {
  const store = useStore()
  const controller = useController()

  useEffect(() => {
    const notify = (text: string) => store.set(noticeAtom, { kind: 'error', text })
    const closeActive = (discard: boolean) => {
      const active = store.get(activePathAtom)
      if (!active) return
      void (discard ? controller.discardBuffer(active) : controller.closeBuffer(active))
    }
    bindVimHost({
      save: () => void controller.saveActive(),
      close: () => closeActive(false),
      discard: () => closeActive(true),
      open: (name) => {
        if (name === '') return notify('Name a file to open, for example :e notes.md')
        // Matching needs every file name: read the whole tree first.
        void controller.ensureFullTree().then(() => {
          const files = store.get(treeAtom).filter((e) => e.kind === 'file')
          const exact = files.find((f) => f.path === name)
          const found = exact ? [exact] : matchFiles(files, name)
          if (found.length === 1) return void controller.openFile(found[0]!.path)
          if (found.length === 0) return notify(`No file matches ${name}`)
          notify(
            `${found.length} files match ${name}: ${found.map((f) => f.path).join(', ')}`,
          )
        })
      },
      cycle: (delta) => controller.cycleTab(delta),
      explore: () => focusFileTree(store),
      grep: (q) => {
        if (q !== '') store.set(grepQueryAtom, q)
        store.set(grepOpenAtom, true)
      },
      diffOpen: (layout) => openReview(store, layout),
      diffClose: () => closeReview(store),
      branchOpen: (base) => void controller.openBranchReview(base),
      branchStep: (delta) => {
        if (!store.get(branchReviewAtom)) return notify('No branch review is open')
        controller.branchStep(delta, delta > 0)
      },
      branchMark: () => controller.markBranchReviewed(),
      branchReset: () => controller.resetBranchReviewed(),
      diffFile: (delta) => {
        if (store.get(branchReviewAtom) && store.get(branchTabActiveAtom))
          return controller.branchStep(delta, delta > 0)
        const paths = reviewFiles(store)
        if (paths.length === 0) return notify('No modified files')
        const at = paths.indexOf(store.get(activePathAtom) ?? '')
        const next = at === -1 ? (delta > 0 ? 0 : paths.length - 1) : at + delta
        void controller.openFile(
          paths[((next % paths.length) + paths.length) % paths.length]!,
        )
      },
      notify,
      status: (next) => store.set(vimStatusAtom, next),
    })
    void controller.init()
    let windowPrefixAt = 0
    const onWindowPrefix = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'w') {
        // Stop the browser closing the tab before the second half of Ctrl-W W arrives.
        e.preventDefault()
        windowPrefixAt = Date.now()
        return
      }
      const secondW = key === 'w' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      if (secondW && Date.now() - windowPrefixAt < 1000) {
        e.preventDefault()
        e.stopPropagation()
        const br = store.get(branchTabActiveAtom) ? store.get(branchReviewAtom) : null
        if (br) controller.setBranchFocus(br.focus === 'index' ? 'canvas' : 'index')
        else toggleFileTreeFocus(store)
      }
      windowPrefixAt = 0
    }
    const onKey = (e: KeyboardEvent) => {
      // Match the physical key: with Alt held, e.key can be a symbol (Option+W on macOS).
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyW') {
        e.preventDefault()
        const active = store.get(activePathAtom)
        if (active) void controller.closeBuffer(active)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyB') {
        e.preventDefault() // Chrome binds Ctrl-Shift-B to the bookmarks bar
        void controller.openBranchReview()
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'b') {
        e.preventDefault()
        toggleFileTree(store)
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
    const onFocus = () => void controller.revalidateOnFocus()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void controller.revalidateOnFocus()
    }
    window.addEventListener('keydown', onWindowPrefix, true)
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    // The File System Access API has no change events; the controller re-checks the
    // link's permission and the folder contents whenever the tab is seen again.
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      bindVimHost(null)
      window.removeEventListener('keydown', onWindowPrefix, true)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [controller, store])
}

/** Focuses the review pane while it is open, otherwise the editor. */
export function focusEditor(store: ReturnType<typeof useStore>) {
  if (store.get(branchReviewAtom) && store.get(branchTabActiveAtom))
    return void getReviewPane()?.view.focus()
  const view = store.get(reviewOpenAtom)
    ? getReviewPane()?.view
    : store.get(editorHandleAtom)?.view
  view?.focus()
}

export function openReview(
  store: ReturnType<typeof useStore>,
  layout: 'unified' | 'split',
) {
  store.set(reviewLayoutAtom, layout)
  store.set(reviewOpenAtom, true)
}

export function closeReview(store: ReturnType<typeof useStore>) {
  if (!store.get(reviewOpenAtom)) return
  store.set(reviewOpenAtom, false)
  store.get(editorHandleAtom)?.view.focus()
}

/** Paths git reports as changed and still on disk, in path order: the files ]f and [f step through. */
export function reviewFiles(store: ReturnType<typeof useStore>): string[] {
  return [...store.get(gitHeadAtom).status]
    .filter(([, s]) => s !== 'deleted')
    .map(([p]) => p)
    .sort()
}

function fileTreeHasFocus() {
  const active = document.activeElement
  return active instanceof Element && active.closest('[aria-label="File tree"]') !== null
}

export function focusFileTree(store: ReturnType<typeof useStore>) {
  store.set(sidebarOpenAtom, true)
  store.set(fileTreeFocusAtom, (n) => n + 1)
}

export function toggleFileTree(store: ReturnType<typeof useStore>) {
  if (store.get(sidebarOpenAtom)) {
    store.set(sidebarOpenAtom, false)
    if (fileTreeHasFocus()) focusEditor(store)
  } else focusFileTree(store)
}

/** Ctrl-W W: change focus without closing the drawer. */
export function toggleFileTreeFocus(store: ReturnType<typeof useStore>) {
  if (fileTreeHasFocus()) focusEditor(store)
  else focusFileTree(store)
}
