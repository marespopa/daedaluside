import { EditorSelection, EditorState, StateEffect, type Text } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import type { createStore } from 'jotai'
import type { EditorHandle } from '../editor/createEditor'
import {
  activeBufferAtom,
  editorHandleAtom,
  initialBuffer,
  paletteOpenAtom,
} from '../state/editorAtoms'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  deletingPathsAtom,
  linkedFolderAtom,
  reconnectPromptAtom,
  noticeAtom,
  openBuffersAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
  treeAtom,
  workspaceStatusAtom,
  workspacesAtom,
} from '../state/workspaceAtoms'
import {
  moveTab,
  nextTab,
  openTab,
  othersToClose,
  partitionPinned,
  removeTabs,
  reorderTabs,
  rightToClose,
  togglePin,
  unpinnedPaths,
  type TabRef,
  type TabState,
} from '../state/tabOps'
import { downloadBytes, exportZip, walkTree } from './archive'
import { openDB } from './db'
import { startSnapshotSync } from './snapshot'
import { FolderFS } from './folderFs'
import { sourceKey, WorkspaceManager, type RemoteChange } from './manager'
import { isWithin, joinPath, normalizePath } from './path'
import { requestPersistence } from './storage'
import type { LinkedFolder, WorkspaceFS } from './types'

type Store = ReturnType<typeof createStore>

/**
 * True while the user types in a field outside the editor (a new name, the finder). A file
 * that finishes loading then must not take focus, or the field would blur and cancel.
 */
function typingElsewhere(): boolean {
  const a = document.activeElement
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement
}

export const AUTOSAVE_MS = 800
const SESSION_SAVE_MS = 500
const MAX_OPEN_BYTES = 5 * 1024 * 1024

interface Buffer {
  state: EditorState
  /** Document as last written to disk; dirty means the live doc differs. */
  saved: Text
  dirty: boolean
  saveError: boolean
  languageSet: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  /** Saves run one at a time per buffer. */
  chain: Promise<void>
}

/**
 * Owns open buffers and the current workspace. Document text and editor states
 * live here; Jotai only gets metadata (ARCHITECTURE.md §5.2).
 *
 * Every workspace is backed directly by a folder the user picked through the File
 * System Access API. There is no app-side mirror: reads and writes go straight to
 * the linked folder.
 */
export class WorkspaceController {
  private readonly store: Store
  private handle: EditorHandle | null = null
  private manager: WorkspaceManager | null = null
  private fs: WorkspaceFS | null = null
  private wsId: string | null = null
  private buffers = new Map<string, Buffer>()
  /** Tab strip order. Pinned tabs form a prefix. Every path here has a buffer. */
  private tabs: TabRef[] = []
  private active: string | null = null
  private initP: Promise<void> | null = null
  private sessionTimer: ReturnType<typeof setTimeout> | undefined
  /** Bumped on every workspace switch so stale async work can bail out. */
  private epoch = 0
  /** The folder handle of the current workspace, if it has one. */
  private linkHandle: LinkedFolder | null = null
  /** The browser does not grant readwrite access to `linkHandle` right now. */
  private linkPaused = false
  private unsubscribeRemote: (() => void) | null = null

  constructor(store: Store) {
    this.store = store
  }

  // ---- lifecycle -------------------------------------------------------

  init(): Promise<void> {
    return (this.initP ??= this.doInit().catch((e: unknown) => {
      this.store.set(workspaceStatusAtom, {
        state: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }))
  }

  private async doInit() {
    const db = await openDB()
    const manager = (this.manager = new WorkspaceManager(db))
    this.unsubscribeRemote?.()
    this.unsubscribeRemote = manager.onRemoteChange((c) => this.onRemoteChange(c))
    const list = await manager.list()
    this.store.set(workspacesAtom, list)
    if (list.length > 0) {
      // First workspace: ask the browser not to evict our metadata.
      void requestPersistence()
      const last = await manager.getLastId()
      const first = list.find((w) => w.id === last) ?? list[0]!
      await this.switchTo(first.id)
    } else {
      this.store.set(currentWorkspaceIdAtom, null)
    }
    this.store.set(workspaceStatusAtom, { state: 'ready' })
  }

  attach(handle: EditorHandle) {
    this.handle = handle
    this.store.set(editorHandleAtom, handle)
    this.showActive()
  }

  detach() {
    this.stash()
    this.handle = null
    this.store.set(editorHandleAtom, null)
  }

  private stash() {
    const b = this.active ? this.buffers.get(this.active) : undefined
    if (b && this.handle) b.state = this.handle.view.state
  }

  // ---- helpers ---------------------------------------------------------

  private notify(kind: 'info' | 'error', text: string) {
    this.store.set(noticeAtom, { kind, text })
  }

  private fail(e: unknown) {
    this.notify('error', e instanceof Error ? e.message : String(e))
  }

  private requireFS(): WorkspaceFS {
    if (!this.fs) throw new Error('No workspace is open')
    return this.fs
  }

  private requireManager(): WorkspaceManager {
    if (!this.manager) throw new Error('Workspaces are not ready yet')
    return this.manager
  }

  private liveDoc(b: Buffer, path: string): Text {
    return path === this.active && this.handle ? this.handle.view.state.doc : b.state.doc
  }

  private publishBuffers() {
    this.store.set(
      openBuffersAtom,
      this.tabs.map(({ path, pinned }) => {
        const b = this.buffers.get(path)!
        return { path, pinned, dirty: b.dirty, saveError: b.saveError }
      }),
    )
    this.store.set(activePathAtom, this.active)
    this.store.set(activeBufferAtom, (m) => ({
      ...m,
      id: this.active ?? '',
      name: this.active ?? '',
      dirty: this.active ? (this.buffers.get(this.active)?.dirty ?? false) : false,
    }))
  }

  /** Rebuilds the tree from the linked folder. */
  async refreshTree() {
    if (!this.fs) {
      this.store.set(treeAtom, [])
      return
    }
    this.store.set(treeAtom, await walkTree(this.fs))
  }

  /** Refreshes the tree on demand (Ctrl-R), reporting storage failures as a notice. */
  async refreshWorkspace() {
    try {
      await this.refreshTree()
    } catch (e) {
      this.fail(e)
    }
  }

  private async refreshWorkspaces() {
    if (this.manager) this.store.set(workspacesAtom, await this.manager.list())
  }

  // ---- other tabs -----------------------------------------------------

  /**
   * Another tab changed the workspace list. The list is cheap to reload; if the current
   * workspace was deleted, this tab drops its buffers and switches to another one.
   */
  private onRemoteChange(change: RemoteChange) {
    if (change.ws === null) {
      void this.refreshWorkspaces().then(() => this.leaveIfDeleted())
    }
  }

  /**
   * Another tab deleted the workspace open here. Its tabs are dropped without saving (a save
   * would fail anyway), and another workspace opens if any remain.
   */
  private async leaveIfDeleted() {
    const manager = this.manager
    const id = this.wsId
    if (!manager || !id || (await manager.get(id))) return
    this.discardCurrent()
    this.wsId = null
    this.fs = null
    this.linkHandle = null
    this.notify('info', 'This workspace was deleted in another tab.')
    const list = await manager.list()
    this.store.set(workspacesAtom, list)
    if (list.length > 0) {
      await this.switchTo(list[0]!.id)
    } else {
      this.store.set(currentWorkspaceIdAtom, null)
      this.store.set(treeAtom, [])
    }
  }

  // ---- showing buffers in the editor ----------------------------------

  private showActive() {
    const h = this.handle
    if (!h) return
    const b = this.active ? this.buffers.get(this.active) : undefined
    if (!b) {
      const empty = h.createState('')
      h.setState(
        empty.update({
          effects: StateEffect.appendConfig.of([
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
          ]),
        }).state,
      )
      this.store.set(activeBufferAtom, { ...initialBuffer })
      return
    }
    h.setState(b.state)
    if (!b.languageSet && this.active) {
      b.languageSet = true
      const path = this.active
      void h.setLanguage(path).then((language) => {
        if (this.active === path)
          this.store.set(activeBufferAtom, (m) => ({ ...m, language }))
      })
    }
    const head = b.state.selection.main.head
    const line = b.state.doc.lineAt(head)
    this.store.set(activeBufferAtom, {
      id: this.active ?? '',
      name: this.active ?? '',
      language: null,
      dirty: b.dirty,
      line: line.number,
      column: head - line.from + 1,
      length: b.state.doc.length,
    })
    // Loads finish asynchronously. Taking focus while the palette or settings is open
    // would send the user's typing into the document.
    if (!this.overlayOpen() && !typingElsewhere()) h.view.focus()
  }

  private overlayOpen(): boolean {
    return this.store.get(paletteOpenAtom) || this.store.get(settingsOpenAtom)
  }

  /** Called by the Editor component for every CodeMirror update. */
  onEditorUpdate(u: ViewUpdate) {
    if (!u.docChanged && !u.selectionSet) return
    const head = u.state.selection.main.head
    const line = u.state.doc.lineAt(head)
    this.store.set(activeBufferAtom, (m) => ({
      ...m,
      line: line.number,
      column: head - line.from + 1,
      length: u.state.doc.length,
    }))
    const path = this.active
    const b = path ? this.buffers.get(path) : undefined
    if (!path || !b || !u.docChanged) return
    const dirty = !u.state.doc.eq(b.saved)
    if (dirty !== b.dirty) {
      b.dirty = dirty
      this.publishBuffers()
    }
    clearTimeout(b.timer)
    b.timer = dirty ? setTimeout(() => void this.save(path), AUTOSAVE_MS) : undefined
  }

  // ---- buffers ---------------------------------------------------------

  /** Reads a file into a buffer without showing it. Returns false if the workspace changed meanwhile. */
  private async load(rawPath: string): Promise<string | null> {
    const path = normalizePath(rawPath)
    if (this.buffers.has(path)) return path
    const fs = this.requireFS()
    const epoch = this.epoch
    const st = await fs.stat(path)
    if (!st || st.kind !== 'file') throw new Error(`Not a file: ${path}`)
    if ((st.size ?? 0) > MAX_OPEN_BYTES) throw new Error(`${path} is too large to edit`)
    const bytes = await fs.readBytes(path)
    if (bytes.subarray(0, 8192).includes(0)) throw new Error(`${path} is a binary file`)
    if (epoch !== this.epoch) return null
    if (!this.buffers.has(path)) {
      const text = new TextDecoder().decode(bytes)
      const state = this.handle
        ? this.handle.createState(text)
        : EditorState.create({ doc: text })
      this.buffers.set(path, {
        state,
        saved: state.doc,
        dirty: false,
        saveError: false,
        languageSet: false,
        timer: undefined,
        chain: Promise.resolve(),
      })
      this.tabs.push({ path, pinned: false })
    }
    return path
  }

  /** Opens a file. */
  async openFile(path: string) {
    try {
      const p = await this.load(path)
      if (p) this.activate(p)
    } catch (e) {
      this.fail(e)
    }
  }

  /** Focuses a tab, even if it is already active (clicking a tab returns focus to the editor). */
  private activate(path: string) {
    this.commit(openTab(this.tabState(), path), { force: true })
  }

  private tabState(): TabState {
    return { tabs: this.tabs, active: this.active }
  }

  /**
   * The one place tab state changes. Stashes the live editor state, drops removed
   * buffers, then shows the new active buffer when it changed (or when forced).
   */
  private commit(
    next: TabState,
    opts: { removed?: readonly string[]; force?: boolean } = {},
  ) {
    const prev = this.active
    this.stash()
    for (const p of opts.removed ?? []) {
      const b = this.buffers.get(p)
      if (b) clearTimeout(b.timer)
      this.buffers.delete(p)
    }
    this.tabs = next.tabs
    this.active = next.active
    if (opts.force || prev !== next.active) this.showActive()
    this.publishBuffers()
    this.scheduleSession()
  }

  /**
   * Closes tabs, saving dirty ones first. A tab whose save fails stays open with its edits.
   * With `discard`, unsaved edits are dropped and nothing is written.
   */
  async closeTabs(
    paths: readonly string[],
    prefer?: string,
    opts: { discard?: boolean } = {},
  ) {
    const epoch = this.epoch
    const ready: string[] = []
    for (const p of paths) {
      const b = this.buffers.get(p)
      if (!b) continue
      if (opts.discard) {
        ready.push(p)
        continue
      }
      if (b.dirty) await this.save(p) // autosave semantics: closing never discards edits
      if (epoch !== this.epoch) return // the workspace changed while saving
      if (this.buffers.get(p)?.saveError) continue
      ready.push(p)
    }
    if (ready.length === 0) return
    this.commit(removeTabs(this.tabState(), ready, prefer), { removed: ready })
  }

  closeBuffer(path: string) {
    return this.closeTabs([path])
  }

  /** Closes a tab without saving its unsaved edits. The file keeps its last saved text. */
  discardBuffer(path: string) {
    return this.closeTabs([path], undefined, { discard: true })
  }

  cycleTab(delta: 1 | -1) {
    const next = nextTab(this.tabState(), delta)
    if (next !== null && next !== this.active) this.activate(next)
  }

  closeOthers(path: string) {
    return this.closeTabs(othersToClose(this.tabs, path), path)
  }

  closeToRight(path: string) {
    return this.closeTabs(rightToClose(this.tabs, path), path)
  }

  closeAll() {
    return this.closeTabs(unpinnedPaths(this.tabs))
  }

  /** Drag-and-drop reorder. Indices are the item's position before and after the move. */
  reorderTab(from: number, to: number) {
    this.commit({ tabs: reorderTabs(this.tabs, from, to), active: this.active })
  }

  moveTab(path: string, delta: number) {
    this.commit({ tabs: moveTab(this.tabs, path, delta), active: this.active })
  }

  togglePin(path: string) {
    this.commit({ tabs: togglePin(this.tabs, path), active: this.active })
  }

  async copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path)
      this.notify('info', `Copied ${path}`)
    } catch {
      this.notify('error', 'Could not copy to the clipboard')
    }
  }

  /** Browser workspaces expose no OS path, so the absolute form is workspace-rooted. */
  async copyAbsolutePath(path: string) {
    try {
      const absolute = `/${path}`
      await navigator.clipboard.writeText(absolute)
      this.notify('info', `Copied ${absolute}`)
    } catch {
      this.notify('error', 'Could not copy to the clipboard')
    }
  }

  // ---- saving ----------------------------------------------------------

  save(path: string): Promise<void> {
    const b = this.buffers.get(path)
    if (!b || !this.fs) return Promise.resolve()
    clearTimeout(b.timer)
    b.timer = undefined
    const fs = this.fs
    const run = async () => {
      if (this.buffers.get(path) !== b) return // closed or deleted meanwhile
      const snapshot = this.liveDoc(b, path)
      if (snapshot.eq(b.saved) && !b.saveError) return
      const text = snapshot.toString()
      try {
        await fs.write(path, text)
        b.saved = snapshot
        b.saveError = false
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          this.setLinkPaused(true)
        }
        b.saveError = true
        this.fail(e)
      }
      if (this.buffers.get(path) !== b) return
      b.dirty = !this.liveDoc(b, path).eq(b.saved)
      this.publishBuffers()
      // Edits made while writing need another pass.
      if (b.dirty && !b.saveError)
        b.timer = setTimeout(() => void this.save(path), AUTOSAVE_MS)
    }
    b.chain = b.chain.then(run, run)
    return b.chain
  }

  saveActive(): Promise<void> {
    return this.active ? this.save(this.active) : Promise.resolve()
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.buffers.keys()].map((p) => this.save(p)))
  }

  /** Keys typed on the blank page while an untitled file is being created. */
  private untitledTyping: { text: string } | null = null

  /**
   * Creates Untitled-N.md and opens it. Keys typed while it opens are kept and inserted
   * once it is shown, so typing on the blank page loses nothing.
   */
  async startUntitled(initial = ''): Promise<void> {
    if (this.untitledTyping) {
      this.untitledTyping.text += initial
      return
    }
    const typing = { text: initial }
    this.untitledTyping = typing
    try {
      const fs = this.requireFS()
      const path = await this.nextUntitledPath(fs)
      await fs.write(path, '')
      await this.refreshTree()
      await this.openFile(path)
      // openFile has focused the editor, so later keys go there directly.
      this.untitledTyping = null
      if (typing.text) this.appendToBuffer(path, typing.text)
    } catch (e) {
      this.fail(e)
    } finally {
      this.untitledTyping = null
    }
  }

  private async nextUntitledPath(fs: WorkspaceFS): Promise<string> {
    for (let n = 1; ; n++) {
      const path = `Untitled-${n}.md`
      if (!(await fs.stat(path))) return path
    }
  }

  /** Adds text at the end of an open buffer, as typing would. Autosave picks it up. */
  private appendToBuffer(path: string, text: string) {
    const b = this.buffers.get(path)
    if (!b) return
    if (this.handle && this.active === path) {
      const at = this.handle.view.state.doc.length
      // The editor's update listener marks the buffer dirty and schedules the save.
      this.handle.view.dispatch({
        changes: { from: at, insert: text },
        selection: EditorSelection.cursor(at + text.length),
      })
      return
    }
    const at = b.state.doc.length
    b.state = b.state.update({
      changes: { from: at, insert: text },
      selection: EditorSelection.cursor(at + text.length),
    }).state
    b.dirty = !b.state.doc.eq(b.saved)
    clearTimeout(b.timer)
    b.timer = b.dirty ? setTimeout(() => void this.save(path), AUTOSAVE_MS) : undefined
    this.publishBuffers()
  }

  /**
   * Shows the blank page (the opener) without closing any tab. The open tabs stay in the
   * strip; clicking one brings its file back.
   */
  showHome() {
    if (this.active === null) return
    this.commit({ tabs: this.tabs, active: null })
  }

  // ---- files and folders ----------------------------------------------

  async createFile(rawPath: string) {
    try {
      const path = normalizePath(rawPath)
      if (path === '') throw new Error('Name cannot be empty')
      const fs = this.requireFS()
      if (await fs.stat(path)) throw new Error(`Already exists: ${path}`)
      await fs.write(path, '')
      await this.refreshTree()
      await this.openFile(path)
    } catch (e) {
      this.fail(e)
    }
  }

  async createFolder(rawPath: string) {
    try {
      const path = normalizePath(rawPath)
      if (path === '') throw new Error('Name cannot be empty')
      const fs = this.requireFS()
      if (await fs.stat(path)) throw new Error(`Already exists: ${path}`)
      await fs.mkdir(path)
      await this.refreshTree()
    } catch (e) {
      this.fail(e)
    }
  }

  async renamePath(fromRaw: string, toRaw: string) {
    try {
      const from = normalizePath(fromRaw)
      const to = normalizePath(toRaw)
      const fs = this.requireFS()
      await Promise.all(
        [...this.buffers.keys()]
          .filter((p) => isWithin(p, from))
          .map((p) => this.save(p)),
      )
      await fs.rename(from, to)
      this.stash() // the live state must move with the buffer
      const mv = (p: string) => (isWithin(p, from) ? to + p.slice(from.length) : p)
      const next = new Map<string, Buffer>()
      for (const [p, b] of this.buffers) {
        const np = mv(p)
        if (np !== p) b.languageSet = false
        next.set(np, b)
      }
      this.buffers = next
      this.tabs = this.tabs.map((t) => ({ ...t, path: mv(t.path) }))
      if (this.active) {
        const was = this.active
        this.active = mv(was)
        if (this.active !== was) this.showActive()
      }
      this.publishBuffers()
      this.scheduleSession()
      await this.refreshTree()
    } catch (e) {
      this.fail(e)
    }
  }

  async deletePath(rawPath: string) {
    let deletingPath: string | null = null
    let fs: WorkspaceFS | null = null
    let epoch = this.epoch
    let before: Awaited<ReturnType<typeof walkTree>> = []
    let started = false
    try {
      const path = normalizePath(rawPath)
      deletingPath = path
      fs = this.requireFS()
      epoch = this.epoch
      if (this.store.get(deletingPathsAtom).size > 0) return
      before = this.store.get(treeAtom)
      this.store.set(deletingPathsAtom, (current) => new Set(current).add(path))
      started = true
      this.store.set(treeAtom, (entries) =>
        entries.filter((entry) => !isWithin(entry.path, path)),
      )

      await fs.remove(path)
      if (this.fs !== fs || this.epoch !== epoch) return

      const gone = [...this.buffers.keys()].filter((p) => isWithin(p, path))
      this.commit(removeTabs(this.tabState(), gone), { removed: gone })
      await this.refreshTree()
      this.notify('info', `Deleted "${path}".`)
    } catch (e) {
      if (fs && this.fs === fs && this.epoch === epoch) {
        try {
          await this.refreshTree()
        } catch {
          // Keep the pre-delete tree visible if the filesystem cannot be listed either.
          this.store.set(treeAtom, before)
        }
      }
      this.fail(e)
    } finally {
      if (started && deletingPath !== null) {
        const path = deletingPath
        this.store.set(deletingPathsAtom, (current) => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      }
    }
  }

  // ---- workspaces ------------------------------------------------------

  /** Forgets the open tabs and their timers, without saving. The caller has decided to drop them. */
  private discardCurrent() {
    for (const b of this.buffers.values()) clearTimeout(b.timer)
    this.linkHandle = null
    this.buffers = new Map()
    this.tabs = []
    this.active = null
  }

  /** Opens a folder picker and creates or switches to the workspace for that folder. */
  async newWorkspace() {
    const handle = await this.pickFolder()
    if (!handle) return
    await this.openFolderHandle(handle)
  }

  async switchTo(id: string) {
    const manager = this.requireManager()
    if (this.wsId) {
      await this.flushAll()
      await this.saveSessionNow()
    }
    const epoch = ++this.epoch
    for (const b of this.buffers.values()) clearTimeout(b.timer)
    this.buffers = new Map()
    this.tabs = []
    this.active = null
    this.wsId = id
    this.fs = null
    this.linkHandle = null
    this.store.set(currentWorkspaceIdAtom, id)
    await manager.setLastId(id)

    const handle = await manager.getLink(id)
    if (handle) {
      this.linkHandle = handle
      if (await this.queryPermission(handle)) {
        this.fs = new FolderFS(handle)
        this.linkPaused = false
      } else {
        this.linkPaused = true
      }
    }
    this.publishLink()
    await this.refreshTree()
    const meta = await manager.get(id)
    const wanted = meta?.openFiles ?? []
    for (const p of wanted) {
      if (epoch !== this.epoch) return
      try {
        await this.load(p)
      } catch {
        /* file removed or unreadable since last session */
      }
    }
    if (epoch !== this.epoch) return
    const pinned = new Set(meta?.pinnedFiles ?? [])
    const tabs = partitionPinned(
      this.tabs.map((t) => ({ ...t, pinned: pinned.has(t.path) })),
    )
    const act = meta?.activeFile
    const active =
      act && this.buffers.has(act) ? act : (this.active ?? tabs[0]?.path ?? null)
    this.commit({ tabs, active }, { force: true })
  }

  async renameWorkspace(id: string, name: string) {
    try {
      await this.requireManager().rename(id, name)
      await this.refreshWorkspaces()
    } catch (e) {
      this.fail(e)
    }
  }

  async deleteWorkspace(id: string) {
    try {
      const manager = this.requireManager()
      if (id === this.wsId) this.discardCurrent() // the workspace is going away: nothing to save
      await manager.remove(id)
      const list = await manager.list()
      this.store.set(workspacesAtom, list)
      if (id === this.wsId) {
        this.wsId = null // skip saving the session of a deleted workspace
        if (list.length > 0) {
          await this.switchTo(list[0]!.id)
        } else {
          this.store.set(currentWorkspaceIdAtom, null)
          this.store.set(treeAtom, [])
        }
      }
    } catch (e) {
      this.fail(e)
    }
  }

  // ---- import / export -------------------------------------------------

  /** A picked folder becomes the workspace itself; changes read and write directly to it. */
  async importFolderHandle(handle: LinkedFolder) {
    await this.openFolderHandle(handle)
  }

  async exportCurrentZip() {
    try {
      await this.flushAll()
      const fs = this.requireFS()
      const meta = this.store.get(workspacesAtom).find((w) => w.id === this.wsId)
      downloadBytes(await exportZip(fs), `${meta?.name ?? 'workspace'}.zip`)
    } catch (e) {
      this.fail(e)
    }
  }

  private async pickFolder(): Promise<LinkedFolder | null> {
    type PickerWindow = Window & {
      showDirectoryPicker?: (options: {
        mode: 'readwrite'
      }) => Promise<FileSystemDirectoryHandle>
    }
    const w = window as PickerWindow
    if (typeof window === 'undefined' || !w.showDirectoryPicker) {
      throw new Error('Your browser does not support opening folders')
    }
    const folder = await w.showDirectoryPicker({ mode: 'readwrite' })
    return folder as LinkedFolder
  }

  private async openFolderHandle(handle: LinkedFolder) {
    const manager = this.requireManager()
    const name = handle.name
    // The source key identifies the folder by name so the same folder opened again
    // reuses its workspace even after its contents have changed.
    const source = await sourceKey(name, [])
    const existing = await manager.findBySource(source)
    if (existing) {
      await manager.setLink(existing.id, handle)
      await this.refreshWorkspaces()
      await this.switchTo(existing.id)
      this.notify(
        'info',
        `"${existing.name}" is already open, so it was switched to. Delete it under Recent workspaces to open this folder again.`,
      )
      return
    }
    const meta = await manager.create(name, source)
    await manager.setLink(meta.id, handle)
    await this.refreshWorkspaces()
    await this.switchTo(meta.id)
    this.store.set(sidebarOpenAtom, true)
    const firstFile = await this.firstFilePath(handle)
    if (firstFile) await this.openFile(firstFile)
    this.notify('info', `Opened "${meta.name}".`)
  }

  private async firstFilePath(
    handle: FileSystemDirectoryHandle,
  ): Promise<string | undefined> {
    const paths: string[] = []
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, h] of dir.entries()) {
        const path = joinPath(prefix, name)
        if (h.kind === 'file') {
          paths.push(path)
        } else {
          await walk(h as FileSystemDirectoryHandle, path)
        }
      }
    }
    await walk(handle, '')
    return paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0]
  }

  // ---- linked folder ---------------------------------------------------

  private publishLink() {
    const handle = this.linkHandle
    this.store.set(
      linkedFolderAtom,
      handle ? { name: handle.name, paused: this.linkPaused } : null,
    )
    // Ask on open and after a failed write. A dismissed prompt stays dismissed until then.
    this.store.set(reconnectPromptAtom, this.linkPaused)
  }

  private async queryPermission(handle: LinkedFolder): Promise<boolean> {
    try {
      return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
    } catch {
      return false
    }
  }

  private setLinkPaused(paused: boolean) {
    this.linkPaused = paused
    this.publishLink()
  }

  /**
   * Asks the browser for readwrite access again. Call it from a click: the permission
   * prompt needs one. On success the workspace is readable and writable again.
   */
  async reconnectFolder() {
    const handle = this.linkHandle
    if (!handle) return
    try {
      // First call in this function, so the click that started it still counts.
      const state = await handle.requestPermission({ mode: 'readwrite' })
      if (this.linkHandle !== handle) return
      if (state !== 'granted') {
        this.notify(
          'error',
          `Write access to "${handle.name}" was not granted. Changes cannot be saved to this folder.`,
        )
        return
      }
      this.setLinkPaused(false)
      this.fs = new FolderFS(handle)
      await this.refreshTree()
      this.notify('info', `Connected "${handle.name}".`)
    } catch (e) {
      this.fail(e)
    }
  }

  // ---- session ---------------------------------------------------------

  private scheduleSession() {
    clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => void this.saveSessionNow(), SESSION_SAVE_MS)
  }

  private async saveSessionNow() {
    clearTimeout(this.sessionTimer)
    if (!this.manager || !this.wsId) return
    try {
      await this.manager.saveSession(
        this.wsId,
        this.tabs.map((t) => t.path),
        this.active,
        this.tabs.filter((t) => t.pinned).map((t) => t.path),
      )
    } catch {
      /* workspace deleted meanwhile */
    }
  }

  /** Best effort on tab hide/close; async work may be cut off by the browser. */
  flushOnHide() {
    void this.flushAll()
    void this.saveSessionNow()
  }
}

const controllers = new WeakMap<Store, WorkspaceController>()

export function getController(store: Store): WorkspaceController {
  let c = controllers.get(store)
  if (!c) {
    controllers.set(store, (c = new WorkspaceController(store)))
    startSnapshotSync(store)
  }
  return c
}
