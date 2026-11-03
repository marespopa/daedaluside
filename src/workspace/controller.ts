import { EditorState, StateEffect, type Text } from '@codemirror/state'
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
import {
  downloadBytes,
  entriesFromDirectoryHandle,
  entriesFromFileList,
  exportZip,
  importEntries,
  readZip,
  walkTree,
  type ImportEntry,
} from './archive'
import { openDB } from './db'
import { createBackend } from './fs'
import { sourceKey, WorkspaceManager } from './manager'
import { startSnapshotSync } from './snapshot'
import { isWithin, normalizePath } from './path'
import { requestPersistence } from './storage'
import type { WorkspaceFS } from './types'

type Store = ReturnType<typeof createStore>

export const AUTOSAVE_MS = 800
const SESSION_SAVE_MS = 500
const MAX_OPEN_BYTES = 5 * 1024 * 1024
const DEFAULT_WORKSPACE = 'Workspace'

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
    const backend = await createBackend(db)
    const manager = (this.manager = new WorkspaceManager(db, backend))
    let list = await manager.list()
    if (list.length === 0) {
      await this.createDefault(manager)
      list = await manager.list()
      // First workspace: ask the browser not to evict our data.
      void requestPersistence()
    }
    this.store.set(workspacesAtom, list)
    const last = await manager.getLastId()
    const first = list.find((w) => w.id === last) ?? list[0]!
    await this.switchTo(first.id)
    this.store.set(workspaceStatusAtom, { state: 'ready', backend: backend.kind })
  }

  /** A fresh workspace with an empty scratch file, so there is always something to type in. */
  private async createDefault(manager: WorkspaceManager) {
    const meta = await manager.create(DEFAULT_WORKSPACE)
    await manager.fs(meta.id).write('scratch.ts', '')
    await manager.saveSession(meta.id, ['scratch.ts'], 'scratch.ts')
  }

  get backendKind() {
    return this.manager?.backend.kind ?? null
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

  async refreshTree() {
    if (!this.fs) return
    this.store.set(treeAtom, await walkTree(this.fs))
  }

  private async refreshWorkspaces() {
    if (this.manager) this.store.set(workspacesAtom, await this.manager.list())
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
    if (!this.overlayOpen()) h.view.focus()
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

  /** Closes tabs, saving dirty ones first. A tab whose save fails stays open with its edits. */
  async closeTabs(paths: readonly string[], prefer?: string) {
    const epoch = this.epoch
    const ready: string[] = []
    for (const p of paths) {
      const b = this.buffers.get(p)
      if (!b) continue
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
      try {
        await fs.write(path, snapshot.toString())
        b.saved = snapshot
        b.saveError = false
      } catch (e) {
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
    try {
      const path = normalizePath(rawPath)
      const fs = this.requireFS()
      await fs.remove(path)
      const gone = [...this.buffers.keys()].filter((p) => isWithin(p, path))
      this.commit(removeTabs(this.tabState(), gone), { removed: gone })
      await this.refreshTree()
    } catch (e) {
      this.fail(e)
    }
  }

  // ---- workspaces ------------------------------------------------------

  private requireManager(): WorkspaceManager {
    if (!this.manager) throw new Error('Workspaces are not ready yet')
    return this.manager
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
    this.fs = manager.fs(id)
    this.store.set(currentWorkspaceIdAtom, id)
    await manager.setLastId(id)
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

  async createWorkspace(name: string) {
    try {
      const manager = this.requireManager()
      const meta = await manager.create(name)
      await this.refreshWorkspaces()
      await this.switchTo(meta.id)
      await this.createFile('scratch.ts')
    } catch (e) {
      this.fail(e)
    }
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
      if (id === this.wsId) {
        for (const b of this.buffers.values()) clearTimeout(b.timer)
        this.buffers = new Map() // nothing to save: the workspace is going away
        this.tabs = []
        this.active = null
      }
      await manager.remove(id)
      let list = await manager.list()
      if (list.length === 0) {
        await this.createDefault(manager)
        list = await manager.list()
      }
      this.store.set(workspacesAtom, list)
      if (id === this.wsId) {
        this.wsId = null // skip saving the session of a deleted workspace
        await this.switchTo(list[0]!.id)
      }
    } catch (e) {
      this.fail(e)
    }
  }

  // ---- import / export -------------------------------------------------

  private async importInto(name: string, entries: ImportEntry[]) {
    const manager = this.requireManager()
    const label = name || 'Imported'
    const source = await sourceKey(
      label,
      entries.filter((e) => e.kind === 'file').map((e) => e.path),
    )
    // The same folder again: reuse its workspace instead of adding a duplicate entry.
    const existing = await manager.findBySource(source)
    if (existing) {
      await this.refreshWorkspaces()
      await this.switchTo(existing.id)
      this.notify(
        'info',
        `"${existing.name}" is already open, so it was switched to. Delete it under Recent workspaces to import this folder again.`,
      )
      return
    }
    const meta = await manager.create(label, source)
    try {
      const { files, dirs } = await importEntries(manager.fs(meta.id), entries)
      await this.refreshWorkspaces()
      await this.switchTo(meta.id)
      const firstFile = entries
        .filter(
          (entry): entry is Extract<ImportEntry, { kind: 'file' }> =>
            entry.kind === 'file',
        )
        .map((entry) => entry.path)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0]
      if (firstFile) await this.openFile(firstFile)
      this.store.set(sidebarOpenAtom, true)
      this.notify('info', `Opened "${meta.name}" (${files} files, ${dirs} folders)`)
    } catch (e) {
      await manager.remove(meta.id) // don't leave a half-imported workspace
      await this.refreshWorkspaces()
      throw e
    }
  }

  async importZipFile(file: File) {
    try {
      const entries = readZip(new Uint8Array(await file.arrayBuffer()))
      await this.importInto(file.name.replace(/\.zip$/i, ''), entries)
    } catch (e) {
      this.fail(e)
    }
  }

  async importFolderFiles(files: File[]) {
    try {
      const { name, entries } = entriesFromFileList(files)
      await this.importInto(name, entries)
    } catch (e) {
      this.fail(e)
    }
  }

  async importFolderHandle(handle: FileSystemDirectoryHandle) {
    try {
      await this.importInto(handle.name, await entriesFromDirectoryHandle(handle))
    } catch (e) {
      this.fail(e)
    }
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
