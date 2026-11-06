import { EditorSelection, EditorState, StateEffect, type Text } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import type { createStore } from 'jotai'
import { setHunks } from '../editor/diffGutter'
import type { EditorHandle } from '../editor/createEditor'
import type { BranchMode } from '../state/branchReviewAtoms'
import {
  activeBufferAtom,
  activeImageAtom,
  editorHandleAtom,
  grepOpenAtom,
  grepStatusAtom,
  initialBuffer,
  paletteOpenAtom,
} from '../state/editorAtoms'
import { computeHunks, diffTexts, type Hunk } from '../review/diff'
import {
  isReviewed,
  loadMarks,
  markFile,
  marksKey,
  pruneMarks,
  saveMarks,
  type Marks,
} from '../review/branch/marks'
import {
  branchApprovedAtom,
  branchConfirmAtom,
  branchMarksAtom,
  branchReviewAtom,
  branchStatsAtom,
  branchTabActiveAtom,
  type BranchFocus,
  type BranchReviewState,
} from '../state/branchReviewAtoms'
import type { ReviewAction } from '../review/reviewPane'
import {
  minimalChange,
  revertHunkText,
  sameHunk,
  stageHunkText,
  unstageHunkText,
} from '../review/stage'
import { DiffService } from '../review/diffService'
import {
  fileDiffEnabledAtom,
  fileDiffMapAtom,
  gitBranchAtom,
  gitHeadAtom,
  reviewOpenAtom,
} from '../state/gitAtoms'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  deletingPathsAtom,
  linkedFolderAtom,
  reconnectPromptAtom,
  noticeAtom,
  openBuffersAtom,
  openingPathAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
  treeAtom,
  treeCompleteAtom,
  loadedDirsAtom,
  treeProgressAtom,
  treeStatusAtom,
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
import { imageKind, imageMime, sniffImage } from './image'
import { downloadBytes, exportZip, IGNORED, walkTree } from './archive'
import { openDB } from './db'
import { startSnapshotSync } from './snapshot'
import { FolderFS } from './folderFs'
import { loadKnownCount, saveKnownCount } from './loadEstimate'
import type { BranchPrefetch, BranchRequest } from './branchPrefetch'
import { BranchPrefetchService } from './branchPrefetchService'
import { GitService, mapLimit, type BranchFile } from './gitService'
import { GrepService } from './grepService'
import type { GrepHit } from './grep'
import { pathCandidates } from '../editor/pathLinks'
import { SingleFileFS } from './singleFileFs'
import { refRegex } from '../editor/symbols'
import { sourceKey, WorkspaceManager, type RemoteChange } from './manager'
import {
  addEntry,
  depthFirst,
  setChildren,
  basename,
  isWithin,
  joinPath,
  normalizePath,
  renameEntries,
} from './path'
import { requestPersistence } from './storage'
import type {
  Entry,
  LinkedFile,
  LinkedFolder,
  PermissionedHandle,
  WorkspaceFS,
} from './types'

type Store = ReturnType<typeof createStore>

/** True when a picker was dismissed: the API rejects with an AbortError DOMException. */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

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
const isPermissionDomError = (e: unknown) =>
  e instanceof DOMException &&
  (e.name === 'NotAllowedError' || e.name === 'SecurityError')

interface Buffer {
  state: EditorState
  /** Document as last written to disk; dirty means the live doc differs. */
  saved: Text
  dirty: boolean
  saveError: boolean
  languageSet: boolean
  /** Set for images: shown read-only by ImageViewer; `state` stays an empty document. */
  image?: { path: string; bytes: Uint8Array; mime: string }
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
  /** Entry count of each workspace's last full read, the total shown while it is re-read. */
  private knownCounts = new Map<string, number>()
  private buffers = new Map<string, Buffer>()
  /** Tab strip order. Pinned tabs form a prefix. Every path here has a buffer. */
  private tabs: TabRef[] = []
  private active: string | null = null
  private initP: Promise<void> | null = null
  private sessionTimer: ReturnType<typeof setTimeout> | undefined
  /** Bumped on every workspace switch so stale async work can bail out. */
  private epoch = 0
  /** The folder or file handle of the current workspace, if it has one. */
  private linkHandle: LinkedFolder | LinkedFile | null = null
  /** The linked directory handle, for workers that read files themselves; null for files or none. */
  private folderRoot(): FileSystemDirectoryHandle | undefined {
    const h = this.linkHandle
    return h && h.kind !== 'file' ? (h as FileSystemDirectoryHandle) : undefined
  }
  /** The browser does not grant readwrite access to `linkHandle` right now. */
  private linkPaused = false
  /** Last observed permission for `linkHandle`; null until first checked. */
  private linkGranted: boolean | null = null
  /** One focus revalidation at a time: a focus storm must not stack refreshes. */
  private revalidating = false
  private unsubscribeRemote: (() => void) | null = null
  /** Text index for live grep; one per file system, rebuilt when the workspace changes. */
  private grepSvc: GrepService | null = null
  /** Git reader for the linked folder; null for single files and unlinked workspaces. */
  private gitSvc: GitService | null = null
  /** The file system `gitSvc` was built for, to notice a workspace switch or reconnect. */
  private gitFor: WorkspaceFS | null = null
  private diffSvc: DiffService | null = null
  private prefetchSvc: BranchPrefetchService | null = null
  /** The worker computing the open branch review, if any. */
  private reviewWorker: BranchPrefetchService | null = null
  private gitTimer: ReturnType<typeof setTimeout> | undefined
  /** Orders diff requests: only the newest may touch the editor. */
  private diffSeq = 0

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
    // Folder-only: records without a linked folder (from the old OPFS model) are
    // pruned before one of them can be picked as the workspace to open.
    const list = await manager.pruneUnlinked()
    this.store.set(workspacesAtom, list)
    if (list.length > 0) {
      // First workspace: ask the browser not to evict our metadata.
      void requestPersistence()
      const last = await manager.getLastId()
      const first = list.find((w) => w.id === last) ?? list[0]!
      await this.switchTo(first.id)
    } else {
      this.noWorkspaceLeft()
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

  /**
   * Rebuilds the tree from the linked folder: `loading` while it is listed, then
   * `ready`. A failed listing clears the tree: a permission failure becomes the
   * `permission` state (reading may still be re-granted from a click), anything
   * else the `error` state, so no caller is left with an unhandled promise.
   */
  private lastTreeRefresh = 0
  /** Identifies the newest tree walk; an older one that finishes late must not publish. */
  private treeGen = 0
  /** Counts local tree edits, so a walk can tell it may have missed one. */
  private treeMutations = 0

  /** Whether every folder has been read (mirrors `treeCompleteAtom`). */
  private complete = false
  /** Folders whose children are in the tree (mirrors `loadedDirsAtom`). */
  private loaded = new Set<string>()
  private dirLoads = new Map<string, Promise<void>>()
  private fullWalk: Promise<void> | null = null

  private setLoaded(dirs: Set<string>) {
    this.loaded = dirs
    this.store.set(loadedDirsAtom, dirs)
  }

  private setComplete(v: boolean) {
    this.complete = v
    this.store.set(treeCompleteAtom, v)
  }

  /** Drops loaded markers of folders a rename or delete removed from the tree. */
  private pruneLoaded() {
    if (this.loaded.size <= 1) return
    const dirs = new Set(
      this.store
        .get(treeAtom)
        .filter((e) => e.kind === 'dir')
        .map((e) => e.path),
    )
    const next = new Set([...this.loaded].filter((d) => d === '' || dirs.has(d)))
    if (next.size !== this.loaded.size) this.setLoaded(next)
  }

  /** Forgets what was read of the previous folder. */
  private resetTreeState() {
    this.fullWalk = null
    this.dirLoads.clear()
    this.setLoaded(new Set())
    this.setComplete(false)
  }

  /**
   * Re-reads the tree. A folder opens with only its root listed (one cheap directory read,
   * no per-file stats); folders read since then are listed again, so what is on screen
   * stays current. Once the whole tree has been read (see `ensureFullTree`) a refresh
   * walks it all again. `silent` skips the loading state, for a tree that is already
   * shown (a focus revalidation must not look like a reload).
   */
  async refreshTree(opts: { silent?: boolean } = {}) {
    this.lastTreeRefresh = Date.now()
    const gen = ++this.treeGen
    const mutated = this.treeMutations
    const silent =
      opts.silent === true && this.store.get(treeStatusAtom).state === 'ready'
    const fs = this.fs
    if (!fs) {
      this.resetTreeState()
      this.store.set(treeAtom, [])
      this.syncGrep([])
      this.syncGit()
      return
    }
    if (!silent) this.store.set(treeStatusAtom, { state: 'loading' })
    // Git does not need the tree: scan status while the tree is being read.
    this.gitSvc?.invalidateStatus()
    this.syncGit()
    const current = () => this.fs === fs && this.treeGen === gen
    const wasComplete = this.complete
    try {
      let entries: Entry[]
      let loaded: Set<string>
      if (wasComplete) {
        entries = await walkTree(fs)
        loaded = new Set([
          '',
          ...entries.filter((e) => e.kind === 'dir').map((e) => e.path),
        ])
      } else {
        const dirs = ['', ...this.loaded].filter((d, i, all) => all.indexOf(d) === i)
        const listed = await Promise.all(
          dirs.map(async (d) => {
            try {
              return [d, await fs.list(d, { sizes: false })] as const
            } catch (e) {
              // A folder that vanished or cannot be read is dropped; the root still fails.
              if (d === '' || isPermissionDomError(e)) throw e
              return null
            }
          }),
        )
        const found = listed.filter((x): x is readonly [string, Entry[]] => x !== null)
        loaded = new Set(found.map(([d]) => d))
        entries = depthFirst(found.flatMap(([, es]) => es))
      }
      // Another workspace, a reconnect, a newer read, or a whole-tree read took over.
      if (!current()) return
      if (this.complete !== wasComplete) {
        // A whole-tree read landed first and is fresher; only the status is left to settle.
        this.store.set(treeProgressAtom, null)
        this.store.set(treeStatusAtom, { state: 'ready' })
        return
      }
      // An edit made while reading wins; the reconcile below picks up the rest.
      const edited = this.treeMutations !== mutated
      if (!edited) {
        this.store.set(treeAtom, entries)
        this.setLoaded(loaded)
        if (this.complete) this.syncGrep(entries)
      }
      this.store.set(treeProgressAtom, null)
      this.store.set(treeStatusAtom, { state: 'ready' })
      if (!this.gitSvc) this.syncGit()
      if (edited) void this.refreshTree({ silent: true })
    } catch (e) {
      if (!current()) return
      this.failTree(e)
    }
  }

  private failTree(e: unknown) {
    this.treeGen++ // a read still in flight must not publish over this state
    this.store.set(treeProgressAtom, null)
    this.store.set(treeAtom, [])
    this.fullWalk = null
    this.dirLoads.clear()
    // Only when something changes: a new set re-runs the tree's folder-loading effect.
    if (this.loaded.size > 0) this.setLoaded(new Set())
    if (this.complete) this.setComplete(false)
    this.syncGrep([])
    this.syncGit()
    if (isPermissionDomError(e)) {
      // The folder itself may be fine; reading just needs a click to re-grant.
      this.linkPaused = true
      this.publishLink()
      this.store.set(treeStatusAtom, { state: 'permission' })
    } else {
      this.store.set(treeStatusAtom, {
        state: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  /** Reads the children of a folder the first time it is shown. */
  loadDir(dir: string): Promise<void> {
    const fs = this.fs
    // Nothing to read once the whole tree is known, or while access is lost.
    if (!fs || this.complete || this.loaded.has(dir)) return Promise.resolve()
    if (this.linkPaused || this.store.get(treeStatusAtom).state !== 'ready')
      return Promise.resolve()
    const pending = this.dirLoads.get(dir)
    if (pending) return pending
    const gen = this.treeGen
    const mutated = this.treeMutations
    const self: { p?: Promise<void> } = {}
    self.p = (async () => {
      try {
        const children = await fs.list(dir, { sizes: false })
        // A refresh or another folder in between makes this listing stale.
        if (this.fs !== fs || this.treeGen !== gen || this.complete) return
        // The folder itself may not be shown yet (a deeper folder was asked for first):
        // leave it unloaded; it is read again once its parent is there.
        const known =
          dir === '' ||
          this.store.get(treeAtom).some((e) => e.kind === 'dir' && e.path === dir)
        if (!known) return
        // A create, rename or delete since the read began may not be in it: read again.
        if (this.treeMutations !== mutated) {
          this.dirLoads.delete(dir)
          void this.loadDir(dir)
          return
        }
        this.store.set(treeAtom, (entries) => setChildren(entries, dir, children))
        this.setLoaded(new Set(this.loaded).add(dir))
      } catch (e) {
        if (this.fs === fs && isPermissionDomError(e)) this.failTree(e)
        else if (
          this.fs === fs &&
          this.treeGen === gen &&
          (dir === '' ||
            this.store.get(treeAtom).some((e) => e.kind === 'dir' && e.path === dir))
        ) {
          // The folder was removed or cannot be listed: settle it as empty rather than
          // leave a spinner; the next refresh drops it from the tree.
          this.setLoaded(new Set(this.loaded).add(dir))
        }
      } finally {
        if (this.dirLoads.get(dir) === self.p) this.dirLoads.delete(dir)
      }
    })()
    this.dirLoads.set(dir, self.p)
    return self.p
  }

  /**
   * Reads every folder, in a worker. The palette, the file filter, text search and `:e`
   * need the whole file list; a plain open does not, so this runs the first time one of
   * them is used. Resolves once `treeAtom` holds the whole workspace.
   */
  ensureFullTree(): Promise<void> {
    const fs = this.fs
    if (!fs || this.complete) return Promise.resolve()
    if (this.fullWalk) return this.fullWalk
    const self: { p?: Promise<void> } = {}
    self.p = (async () => {
      const total = this.wsId
        ? (this.knownCounts.get(this.wsId) ?? loadKnownCount(this.wsId))
        : null
      try {
        let entries: Entry[]
        // An edit during the read could be missing from it: read again (a few times at most).
        for (let tries = 0; ; tries++) {
          const seen = this.treeMutations
          entries = await walkTree(fs, (done) => {
            if (this.fs === fs) this.store.set(treeProgressAtom, { done, total })
          })
          if (seen === this.treeMutations || tries >= 2) break
        }
        if (this.fs !== fs) return
        if (this.wsId) {
          this.knownCounts.set(this.wsId, entries.length)
          saveKnownCount(this.wsId, entries.length)
        }
        this.store.set(treeProgressAtom, null)
        this.store.set(treeAtom, entries)
        this.setLoaded(
          new Set(['', ...entries.filter((e) => e.kind === 'dir').map((e) => e.path)]),
        )
        this.setComplete(true)
        if (this.store.get(treeStatusAtom).state === 'loading') {
          this.store.set(treeStatusAtom, { state: 'ready' })
        }
        this.syncGrep(entries)
      } catch (e) {
        if (this.fs === fs) this.failTree(e)
      } finally {
        if (this.fullWalk === self.p) this.fullWalk = null
      }
    })()
    this.fullWalk = self.p
    return self.p
  }

  /** Refreshes the tree on demand (Ctrl-R and the tree's Retry). */
  async refreshWorkspace() {
    await this.refreshTree()
  }

  /**
   * Applies a local tree patch instead of a full walk. Mutations know exactly which
   * entry changed, so only the patch is wrong way to scan the whole folder per keypress.
   * A patch that cannot be applied locally falls back to a full refresh.
   */
  private async patchTree(patch: (entries: readonly Entry[]) => Entry[] | null) {
    this.treeMutations++
    const next = patch(this.store.get(treeAtom))
    if (next) {
      this.store.set(treeAtom, next)
      this.pruneLoaded()
      if (this.complete) this.syncGrep(next)
    } else await this.refreshTree()
  }

  // ---- git -------------------------------------------------------------

  /** Builds (or drops) the git reader to match the current file system, then reads status. */
  private syncGit() {
    const fs = this.fs
    const handle = this.linkHandle
    if (this.gitFor !== fs) {
      this.gitSvc = null
      this.gitFor = null
      this.diffSvc?.dispose()
      this.diffSvc = null
      this.prefetchSvc?.dispose()
      this.prefetchSvc = null
      this.prefetchRun = null
      this.reviewWorker?.dispose()
      this.reviewWorker = null
      clearTimeout(this.gitTimer)
      this.gitPaths.clear()
      this.gitFull = false
      this.diffSeq++
      this.store.set(gitHeadAtom, (g) => ({ version: g.version + 1, status: new Map() }))
      this.store.set(fileDiffMapAtom, new Map())
      this.store.set(gitBranchAtom, null)
    }
    if (!fs || !handle || handle.kind === 'file') return
    if (!this.gitSvc) {
      this.gitSvc = new GitService(handle as FileSystemDirectoryHandle)
      this.gitFor = fs
      this.diffSvc = new DiffService()
      this.startBranchPrefetch(handle as FileSystemDirectoryHandle)
    }
    void this.refreshGitStatus()
  }

  /** Re-reads HEAD and the changed-file list, then re-diffs the open file against it. */
  private async refreshGitStatus(savedPaths?: string[]) {
    const svc = this.gitSvc
    if (!svc) return
    try {
      if (savedPaths) await svc.patchChanged(savedPaths)
      const status = await svc.listChanged()
      if (this.gitSvc !== svc) return
      this.store.set(gitHeadAtom, (g) => ({ version: g.version + 1, status }))
      const branch = await svc.currentBranch()
      if (this.gitSvc === svc) this.store.set(gitBranchAtom, branch)
    } catch {
      return // a failed read just leaves the previous marks
    }
    if (this.active) this.pushDiff(this.active, true)
    // An open branch review follows the working tree: revalidate it in place.
    const rev = this.store.get(branchReviewAtom)
    if (rev && rev.status === 'ready' && this.store.get(branchTabActiveAtom)) {
      void this.openBranchReview(
        rev.mode === 'base' ? rev.base : undefined,
        rev.mode,
        true,
        // A save only touched known files: reuse this thread's cached scan instead of
        // starting a worker that scans the whole tree again.
        savedPaths !== undefined,
      )
    }
  }

  /** Status changes after a save or a commit; coalesce bursts of saves. */
  private scheduleGitRefresh(path?: string) {
    if (!this.gitSvc) return
    // A save names its file: re-check just that one. Anything else needs a full scan.
    if (path === undefined) {
      this.gitSvc.invalidateStatus()
      this.gitFull = true
    } else {
      this.gitPaths.add(path)
    }
    clearTimeout(this.gitTimer)
    this.gitTimer = setTimeout(() => {
      const paths = this.gitFull ? undefined : [...this.gitPaths]
      this.gitPaths.clear()
      this.gitFull = false
      void this.refreshGitStatus(paths)
    }, 500)
  }

  /** Files saved since the last refresh, and whether something else needs a full scan. */
  private readonly gitPaths = new Set<string>()
  private gitFull = false

  /** Turns per-file diffs (gutter marks and stats) on or off; they are computed only on demand. */
  setFileDiff(on: boolean) {
    this.store.set(fileDiffEnabledAtom, on)
    if (on) {
      if (this.active) this.pushDiff(this.active, true)
      return
    }
    this.diffSeq++
    this.store.set(fileDiffMapAtom, new Map())
    this.handle?.view.dispatch({ effects: setHunks.of([]) })
  }

  /** Diffs a buffer's live text against HEAD and shows the hunks. */
  private pushDiff(path: string, immediate = false) {
    const svc = this.gitSvc
    const diffs = this.diffSvc
    const b = this.buffers.get(path)
    if (!this.store.get(fileDiffEnabledAtom)) return
    if (!svc || !diffs || !b || b.image) return
    const seq = ++this.diffSeq
    const text = this.liveDoc(b, path).toString()
    void svc.getHeadBlob(path).then((base) => {
      if (seq !== this.diffSeq || this.diffSvc !== diffs) return
      if (base === null) {
        // Untracked or new files show as all added; anything else HEAD cannot read gets no marks.
        const s = this.store.get(gitHeadAtom).status.get(path)
        if (s !== 'untracked' && s !== 'added') return this.applyDiff(path, [])
      }
      diffs.schedule(base ?? '', text, (r) => this.applyDiff(path, r.hunks), immediate)
    })
  }

  /**
   * Both sides of a file's diff for the review pane: HEAD's text (empty for a new file)
   * and the live text. Null when there is no repository, or HEAD has no text for it.
   */
  async reviewSnapshot(path: string): Promise<{ base: string; current: string } | null> {
    const svc = this.gitSvc
    const b = this.buffers.get(path)
    if (!svc || !b || b.image) return null
    const base = await svc.getHeadBlob(path)
    if (base === null) {
      const s = this.store.get(gitHeadAtom).status.get(path)
      if (s !== 'untracked' && s !== 'added') return null
    }
    return { base: base ?? '', current: this.liveDoc(b, path).toString() }
  }

  /**
   * Git action on a hunk of the active file's diff against HEAD (null: the whole file).
   * Staging writes to `.git` and needs write access; reverting is an ordinary edit of
   * the open buffer, so the editor's undo brings the hunk back.
   */
  async reviewAction(path: string, action: ReviewAction, hunk: Hunk | null) {
    const svc = this.gitSvc
    const b = this.buffers.get(path)
    if (!svc || !b || b.image)
      return this.notify('error', 'This file is not in a git repository.')
    try {
      const head = await svc.getHeadBlob(path)
      const live = this.liveDoc(b, path).toString()
      if (hunk && !computeHunks(head ?? '', live).some((h) => sameHunk(h, hunk))) {
        void this.refreshGitStatus()
        return this.notify('info', 'The diff changed; try again.')
      }
      if (action === 'obtain' || action === 'revert') {
        if (!hunk)
          return this.notify('info', 'Move the cursor onto a changed hunk first.')
        return await this.revertHunk(path, head ?? '', live, hunk)
      }
      if (!(await this.ensureGitWritable())) return
      await this.stageChange(svc, path, action, head, live, hunk)
      await this.refreshGitStatus()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        this.requestGitWrite()
      } else this.fail(e)
    }
  }

  private async revertHunk(path: string, head: string, live: string, hunk: Hunk) {
    const view = this.handle?.view
    if (!view || this.active !== path) return
    view.dispatch({ changes: minimalChange(live, revertHunkText(head, live, hunk)) })
    this.notify('info', 'Reverted the hunk to HEAD. Undo with Ctrl-Z in the editor.')
    await this.refreshGitStatus()
  }

  // ---- branch review (merge-base(base, HEAD)..HEAD) ----------------------

  private branchSignal: { cancelled: boolean } | null = null

  private branchPatch(patch: Partial<BranchReviewState>) {
    this.store.set(branchReviewAtom, (s) => (s ? { ...s, ...patch } : s))
  }

  private branchMarksKey(): string | null {
    const s = this.store.get(branchReviewAtom)
    return this.wsId && s ? marksKey(this.wsId, s.base, s.branch) : null
  }

  private setBranchMarks(marks: Marks) {
    this.store.set(branchMarksAtom, marks)
    const key = this.branchMarksKey()
    if (key) saveMarks(key, marks)
  }

  notifyInfo(text: string) {
    this.notify('info', text)
  }

  private lastBranchBase: string | undefined

  /** Line totals by `mbOid|headOid`: the oids name the content, so an entry never goes stale. */
  private statsCache = new Map<string, { add: number; del: number }>()

  private statKey(f: BranchFile) {
    return `${f.mbOid}|${f.headOid}`
  }

  /** Known totals for these files, from earlier reviews (also after a commit or a revert). */
  private knownStats(files: readonly BranchFile[]) {
    const out: Record<string, { add: number; del: number }> = {}
    for (const f of files) {
      const st = this.statsCache.get(this.statKey(f))
      if (st) out[f.path] = st
    }
    return out
  }

  private rememberStats(
    files: readonly BranchFile[],
    stats: Readonly<Record<string, { add: number; del: number }>>,
  ) {
    for (const f of files) {
      const st = stats[f.path]
      if (st) this.statsCache.set(this.statKey(f), st)
    }
    // Bounded: drop the oldest entries first.
    for (const k of this.statsCache.keys()) {
      if (this.statsCache.size <= 20000) break
      this.statsCache.delete(k)
    }
  }

  /** The default-base prefetch in flight, and the review (if any) waiting on its result. */
  private prefetchRun: {
    pending: boolean
    join: {
      signal: { cancelled: boolean }
      svc: GitService
      cacheKey: string
      fail: (message: string) => void
      finished: boolean
      resolve: (finished: boolean) => void
    } | null
  } | null = null

  /** Flips between "diff with main" and "working tree vs HEAD". */
  toggleBranchMode() {
    const s = this.store.get(branchReviewAtom)
    if (!s) return
    if (s.mode === 'base') {
      this.lastBranchBase = s.base
      void this.openBranchReview(undefined, 'working')
    } else void this.openBranchReview(this.lastBranchBase, 'base')
  }

  /** Last finished review per workspace/mode/base: shown at once, then revalidated. */
  private branchCache = new Map<
    string,
    Pick<BranchReviewState, 'base' | 'branch' | 'mergeBase' | 'head' | 'files'> & {
      stats: Readonly<Record<string, { add: number; del: number }>>
      statsDone: boolean
    }
  >()

  private setStats(
    stats: Readonly<Record<string, { add: number; del: number }>>,
    done: boolean,
  ) {
    if (this.store.get(branchReviewAtom)) this.store.set(branchStatsAtom, { stats, done })
  }

  /** Reads the default-base review in a worker so opening it finds the result waiting. */
  private startBranchPrefetch(handle: FileSystemDirectoryHandle) {
    const svc = (this.prefetchSvc ??= new BranchPrefetchService())
    const run: NonNullable<typeof this.prefetchRun> = { pending: true, join: null }
    this.prefetchRun = run
    const ws = this.wsId
    const key = `${ws ?? ''}|base|`
    svc.start(
      handle,
      (r, done) => {
        if (this.prefetchSvc !== svc || this.wsId !== ws) return
        const entry = {
          base: r.base,
          branch: r.branch,
          mergeBase: r.mergeBase,
          head: r.head,
          files: r.files,
          stats: r.stats,
          statsDone: done,
        }
        this.rememberStats(r.files, r.stats)
        // Never replace a result the review itself has produced since.
        if (!this.branchCache.get(key)?.statsDone) this.branchCache.set(key, entry)
        if (r.blobs) this.gitSvc?.primeBlobs(r.blobs)
        // A review opened while this worker runs joins it instead of starting a second one.
        const j = run.join
        if (j && !j.signal.cancelled && this.gitSvc === j.svc) {
          if (this.applyWorkerResult(r, done, j.signal, j.cacheKey) && done)
            j.finished = true
          return
        }
        // The review was opened while the worker was still reading: fill it in now.
        const cur = this.store.get(branchReviewAtom)
        if (
          cur &&
          cur.status === 'loading' &&
          cur.mode === 'base' &&
          cur.base === '…' &&
          cur.files.length === 0
        ) {
          const { stats, statsDone, ...shown } = entry
          this.setStats({ ...this.knownStats(r.files), ...stats }, statsDone)
          this.branchPatch({ ...shown, status: 'ready' })
        }
      },
      () => {
        run.pending = false
        run.join?.resolve(run.join.finished)
      },
      undefined,
      () => {
        run.pending = false
        const j = run.join
        if (!j) return
        if (!j.signal.cancelled && this.gitSvc !== j.svc)
          j.fail('Workspace changed while reading the branch.')
        j.resolve(true)
      },
    )
  }

  async openBranchReview(
    baseArg?: string,
    mode: BranchMode = 'base',
    quiet = false,
    inThread = false,
  ) {
    const cacheKey = `${this.wsId ?? ''}|${mode}|${baseArg?.trim() ?? ''}`
    const hit = this.branchCache.get(cacheKey)
    // A result for another HEAD (a commit since) would show the wrong diff until revalidated.
    const knownHead = this.gitSvc?.knownHead()
    const cached =
      hit && knownHead && hit.head && hit.head !== knownHead ? undefined : hit
    if (hit && !cached) this.branchCache.delete(cacheKey)
    if (this.branchSignal) this.branchSignal.cancelled = true
    const signal = { cancelled: false }
    this.branchSignal = signal
    if (!quiet) {
      // Open at once in a loading state; the workspace may still be reading its tree.
      this.store.set(reviewOpenAtom, false)
      this.store.set(branchTabActiveAtom, true)
      this.store.set(branchConfirmAtom, null)
      this.store.set(branchApprovedAtom, new Set())
      this.store.set(branchMarksAtom, {})
      this.store.set(branchReviewAtom, {
        mode,
        base: mode === 'working' ? 'HEAD' : baseArg?.trim() || '…',
        branch: '…',
        status: 'loading',
        message: null,
        mergeBase: null,
        head: null,
        files: [],
        index: 0,
        focus: 'index',
        // Optimistic: the previous result, until the fresh one replaces it.
        ...(cached
          ? {
              base: cached.base,
              branch: cached.branch,
              mergeBase: cached.mergeBase,
              head: cached.head,
              files: cached.files,
              status: 'ready' as const,
            }
          : {}),
      })
      this.store.set(
        branchStatsAtom,
        cached
          ? { stats: cached.stats, done: cached.statsDone }
          : { stats: {}, done: false },
      )
      if (cached) {
        const key = this.branchMarksKey()
        this.setBranchMarks(pruneMarks(key ? loadMarks(key) : {}, cached.files))
      }
    }
    const fail = (message: string) => {
      if (!signal.cancelled && !cached && !quiet)
        this.branchPatch({ status: 'error', message })
    }
    // Git attaches when the tree walk ends; wait for it rather than refusing.
    for (let i = 0; i < 3000 && !this.gitSvc && !signal.cancelled; i++) {
      if (this.store.get(treeStatusAtom).state !== 'loading') break
      await new Promise((r) => setTimeout(r, 20))
    }
    if (signal.cancelled) return
    const svc = this.gitSvc
    if (!svc || !(await svc.hasHead())) {
      return fail('This folder is not a git repository with a commit.')
    }
    // The comparison (git walk, status scan, line totals) runs in a worker so the editor
    // stays responsive; without one, or if it dies, the same work runs below.
    const run = this.prefetchRun
    if (run?.pending && mode === 'base' && !baseArg?.trim() && !inThread) {
      run.join?.resolve(true)
      const finished = await new Promise<boolean>((resolve) => {
        run.join = { signal, svc, cacheKey, fail, finished: false, resolve }
      })
      if (run.join?.signal === signal) run.join = null
      if (finished || signal.cancelled) return
    }
    const linked = this.linkHandle
    if (linked && linked.kind === 'directory' && !inThread) {
      const finished = await this.reviewInWorker(
        linked as FileSystemDirectoryHandle,
        { mode, base: baseArg },
        { signal, svc, cacheKey, fail },
      )
      if (finished || signal.cancelled) return
    }
    let base = 'HEAD'
    let baseOid: string | null = null
    if (mode === 'base') {
      const named = baseArg?.trim() || (await svc.defaultBase())
      if (!named) {
        return fail(
          'No main, master or trunk branch found; name a base, for example :BranchReview origin/dev',
        )
      }
      base = named
      baseOid = await svc.resolveBase(base)
      if (!baseOid) return fail(`Unknown base: ${base}`)
    }
    const branch = await svc.currentBranch()
    if (signal.cancelled) return
    this.branchPatch({ base, branch })
    // Edits made outside the app are picked up here; saves already invalidate the scan.
    if (!inThread) svc.invalidateStatusIfOlder(5000)
    const res = await svc.branchChanges(baseOid, signal, (files, mergeBase, head) => {
      // Show the committed files at once; the working-tree overlay lands in the final patch.
      if (signal.cancelled || this.gitSvc !== svc) return
      const cur = this.store.get(branchReviewAtom)
      if (!cur || cur.status === 'ready') return
      this.branchPatch({
        status: 'ready',
        mergeBase,
        head,
        files,
        index: 0,
        partial: true,
      })
    })
    if (signal.cancelled) return
    if (this.gitSvc !== svc) return fail('Workspace changed while reading the branch.')
    if (res.kind === 'error') {
      return this.branchPatch({ status: 'error', message: res.message })
    }
    // Keep the cursor on the same file, and totals of files that did not change.
    const prev = this.store.get(branchReviewAtom)
    const prevPath = prev?.files[prev.index]?.path
    const keptStats = this.knownStats(res.files)
    const at = prevPath ? res.files.findIndex((f) => f.path === prevPath) : -1
    const complete = res.files.every((f) => keptStats[f.path])
    this.setStats(keptStats, res.files.length === 0 || complete)
    this.branchPatch({
      status: 'ready',
      mergeBase: res.mergeBase,
      head: res.head,
      files: res.files,
      index: at === -1 ? 0 : at,
      message: res.multipleBases ? 'Several merge bases; using the first.' : null,
      partial: false,
    })
    const key = this.branchMarksKey()
    const marks = pruneMarks(key ? loadMarks(key) : {}, res.files)
    this.setBranchMarks(marks)
    const remember = () => this.rememberBranch(signal, cacheKey)
    remember()
    void this.computeBranchStats(svc, res.files, keptStats, signal).then(remember)
  }

  private rememberBranch(signal: { cancelled: boolean }, cacheKey: string) {
    const cur = this.store.get(branchReviewAtom)
    if (cur && cur.status === 'ready' && !signal.cancelled) {
      const totals = this.store.get(branchStatsAtom)
      this.branchCache.set(cacheKey, {
        base: cur.base,
        branch: cur.branch,
        mergeBase: cur.mergeBase,
        head: cur.head,
        files: cur.files,
        stats: totals.stats,
        statsDone: totals.done,
      })
    }
  }

  /** Patches the open review with a worker result; true once a full (non-partial) result landed. */
  private applyWorkerResult(
    r: BranchPrefetch,
    done: boolean,
    signal: { cancelled: boolean },
    cacheKey: string,
  ): boolean {
    // A review already on screen keeps its full list until the full result lands.
    if (r.partial && this.store.get(branchReviewAtom)?.status === 'ready') return false
    // Keep the cursor on the same file; totals of unchanged files come from the cache.
    const prev = this.store.get(branchReviewAtom)
    const prevPath = prev?.files[prev.index]?.path
    this.rememberStats(r.files, r.stats)
    this.setStats({ ...this.knownStats(r.files), ...r.stats }, done)
    const at = prevPath ? r.files.findIndex((f) => f.path === prevPath) : -1
    this.branchPatch({
      status: 'ready',
      base: r.base,
      branch: r.branch,
      mergeBase: r.mergeBase,
      head: r.head,
      files: r.files,
      index: at === -1 ? 0 : at,
      partial: r.partial === true,
      message: r.multipleBases ? 'Several merge bases; using the first.' : null,
    })
    if (r.partial) return false
    const key = this.branchMarksKey()
    this.setBranchMarks(pruneMarks(key ? loadMarks(key) : {}, r.files))
    this.rememberBranch(signal, cacheKey)
    return true
  }

  /**
   * Runs the review in a worker, patching the open review as results stream in. Resolves
   * true once the review has finished (or failed with a message for the user), false when
   * the caller should compute it on this thread instead.
   */
  private reviewInWorker(
    handle: FileSystemDirectoryHandle,
    req: BranchRequest,
    ctx: {
      signal: { cancelled: boolean }
      svc: GitService
      cacheKey: string
      fail: (message: string) => void
    },
  ): Promise<boolean> {
    const { signal, svc, cacheKey, fail } = ctx
    this.reviewWorker?.dispose()
    const worker = new BranchPrefetchService()
    this.reviewWorker = worker
    return new Promise<boolean>((resolve) => {
      let finished = false
      const stale = () =>
        signal.cancelled || this.gitSvc !== svc || this.reviewWorker !== worker
      const started = worker.start(
        handle,
        (r, done) => {
          if (stale()) return
          if (r.blobs) svc.primeBlobs(r.blobs)
          if (this.applyWorkerResult(r, done, signal, cacheKey) && done) finished = true
        },
        () => {
          if (this.reviewWorker === worker) this.reviewWorker = null
          resolve(finished)
        },
        { ...req, known: Object.fromEntries(this.statsCache) },
        (message) => {
          if (stale()) return
          finished = true
          fail(message)
        },
        () => {
          // Disposed: a newer review or a close needs nothing more; a workspace change does.
          if (!signal.cancelled && this.gitSvc !== svc)
            fail('Workspace changed while reading the branch.')
          finished = true
          resolve(true)
        },
      )
      if (!started) resolve(false)
    })
  }

  /** Line totals per file, computed in the background (selected file first, a few at a time). */
  private async computeBranchStats(
    svc: GitService,
    files: readonly BranchFile[],
    known: Record<string, { add: number; del: number }>,
    signal: { cancelled: boolean },
  ) {
    const stats = { ...known }
    const todo = files.filter((f) => !stats[f.path])
    if (todo.length === 0) return
    const first =
      this.store.get(branchReviewAtom)?.files[
        this.store.get(branchReviewAtom)?.index ?? 0
      ]
    todo.sort((x, y) => Number(y.path === first?.path) - Number(x.path === first?.path))
    let n = 0
    await mapLimit(todo, 4, async (f) => {
      if (signal.cancelled) return
      try {
        await this.statOne(svc, f, stats)
      } catch {
        // an unreadable blob just has no totals
      }
      if (++n % 10 === 0 && !signal.cancelled) this.setStats({ ...stats }, false)
    })
    if (!signal.cancelled) this.setStats(stats, true)
  }

  private async statOne(
    svc: GitService,
    f: BranchFile,
    stats: Record<string, { add: number; del: number }>,
  ) {
    const [a, b] = await Promise.all([
      f.mbOid
        ? svc.readBlobAt(f.mbOid)
        : Promise.resolve({ kind: 'text', text: '' } as const),
      f.headOid
        ? svc.readBlobAt(f.headOid)
        : Promise.resolve({ kind: 'text', text: '' } as const),
    ])
    if (a.kind === 'text' && b.kind === 'text') {
      const { stats: st } = diffTexts(a.text, b.text)
      stats[f.path] = { add: st.added, del: st.removed }
      this.statsCache.set(this.statKey(f), stats[f.path]!)
    }
  }

  /** Focuses the Branch Review tab, if a review is open. */
  showBranchReview() {
    if (!this.store.get(branchReviewAtom)) return
    this.store.set(reviewOpenAtom, false)
    this.store.set(branchTabActiveAtom, true)
  }

  closeBranchReview() {
    if (!this.store.get(branchReviewAtom)) return
    this.dropBranchReview()
    this.handle?.view.focus()
  }

  /** Cancels any read in flight and clears the review, its marks and its session approvals. */
  private dropBranchReview() {
    if (this.branchSignal) this.branchSignal.cancelled = true
    this.reviewWorker?.dispose()
    this.reviewWorker = null
    this.store.set(branchReviewAtom, null)
    this.store.set(branchTabActiveAtom, false)
    this.store.set(branchConfirmAtom, null)
    this.store.set(branchMarksAtom, {})
    this.store.set(branchApprovedAtom, new Set())
  }

  /** Both sides of the open file's patch, or a placeholder reason. */
  async branchFileContent(
    file: BranchFile,
  ): Promise<{ base: string; current: string } | { placeholder: string }> {
    const svc = this.gitSvc
    if (!svc) return { placeholder: 'No repository' }
    const [a, b] = await Promise.all([
      file.mbOid
        ? svc.readBlobAt(file.mbOid)
        : Promise.resolve({ kind: 'text', text: '' } as const),
      file.headOid
        ? svc.readBlobAt(file.headOid)
        : Promise.resolve({ kind: 'text', text: '' } as const),
    ])
    for (const side of [a, b]) {
      if (side.kind !== 'text') {
        return {
          placeholder: `[${side.kind === 'large' ? 'Large' : 'Binary'} file changed — Click to inspect metadata]`,
        }
      }
    }
    return { base: (a as { text: string }).text, current: (b as { text: string }).text }
  }

  /** Blob ids and sizes for the placeholder's metadata line. */
  async branchFileMeta(file: BranchFile): Promise<string> {
    const svc = this.gitSvc
    if (!svc) return ''
    const parts: string[] = []
    for (const [label, oid] of [
      ['base', file.mbOid],
      ['head', file.headOid],
    ] as const) {
      if (!oid) {
        parts.push(`${label}: none`)
        continue
      }
      const c = await svc.readBlobAt(oid)
      const size = c.kind === 'text' ? new TextEncoder().encode(c.text).length : c.size
      parts.push(`${label}: ${oid.slice(0, 7)}, ${size} bytes`)
    }
    return parts.join(' · ')
  }

  /** Moves the cursor in the file list; `autoMark` marks the file left behind as reviewed. */
  branchStep(delta: number, autoMark = false) {
    const s = this.store.get(branchReviewAtom)
    if (!s || s.files.length === 0) return
    if (autoMark) this.markBranchFile(s.index, true)
    const n = s.files.length
    this.branchPatch({ index: (((s.index + delta) % n) + n) % n })
  }

  branchSelect(index: number) {
    const s = this.store.get(branchReviewAtom)
    if (!s || index < 0 || index >= s.files.length) return
    this.branchPatch({ index })
  }

  setBranchFocus(focus: BranchFocus) {
    this.branchPatch({ focus })
  }

  private markBranchFile(index: number, reviewed: boolean) {
    const s = this.store.get(branchReviewAtom)
    const file = s?.files[index]
    if (!file) return
    this.setBranchMarks(markFile(this.store.get(branchMarksAtom), file, reviewed))
  }

  /** The sidebar checkbox: sets one file's mark without moving the selection. */
  setBranchFileReviewed(index: number, reviewed: boolean) {
    this.markBranchFile(index, reviewed)
  }

  /** `a`/Space: flips the file's mark, and advances when it became reviewed. */
  toggleBranchReviewed() {
    const s = this.store.get(branchReviewAtom)
    const file = s?.files[s.index]
    if (!s || !file) return
    const was = isReviewed(this.store.get(branchMarksAtom), file)
    this.markBranchFile(s.index, !was)
    if (!was && s.files.length > 1) this.branchStep(1)
  }

  /** :BRMarkReviewed: always marks, then advances. */
  markBranchReviewed() {
    const s = this.store.get(branchReviewAtom)
    if (!s || s.files.length === 0)
      return this.notify('info', 'No branch review is open.')
    this.markBranchFile(s.index, true)
    if (s.files.length > 1) this.branchStep(1)
  }

  resetBranchReviewed() {
    if (!this.store.get(branchReviewAtom))
      return this.notify('info', 'No branch review is open.')
    this.setBranchMarks({})
    this.store.set(branchApprovedAtom, new Set())
  }

  approveBranchHunk(key: string) {
    this.store.set(branchApprovedAtom, (set) => new Set(set).add(key))
    this.notify('info', 'Approved the hunk for this session.')
  }

  /** `e`: opens the file in its own tab; the review stays open in its tab. */
  async editBranchFile(path: string) {
    await this.openFile(path)
  }

  /** Writes the merge base's text of a file into the working tree (undoable in the buffer). */
  async revertBranchFile(file: BranchFile) {
    const svc = this.gitSvc
    if (!svc) return
    try {
      if (file.status === 'A') {
        await this.deletePath(file.path)
        this.notify('info', `Removed ${file.path} (added on this branch).`)
        return void this.refreshGitStatus()
      }
      const mb = await svc.readBlobAt(file.mbOid!)
      if (mb.kind !== 'text')
        return this.notify('error', 'Cannot revert a binary or large file here.')
      if (file.status === 'D') await this.createFile(file.path)
      else await this.openFile(file.path)
      const view = this.handle?.view
      if (!view || this.active !== file.path) return
      view.dispatch({ changes: minimalChange(view.state.doc.toString(), mb.text) })
      await this.saveActive()
      this.notify('info', `Reverted ${file.path} to the base branch.`)
      void this.refreshGitStatus()
    } catch (e) {
      this.fail(e)
    }
  }

  /** Reverts one hunk of the branch patch in the working tree, matched against the live text. */
  async revertBranchHunk(file: BranchFile, hunk: Hunk) {
    const svc = this.gitSvc
    if (!svc || !file.mbOid || !file.headOid) {
      return this.notify('info', 'Use r to revert an added or deleted file.')
    }
    try {
      const mb = await svc.readBlobAt(file.mbOid)
      if (mb.kind !== 'text') return
      await this.openFile(file.path)
      const view = this.handle?.view
      if (!view || this.active !== file.path) return
      const live = view.state.doc.toString()
      const match = computeHunks(mb.text, live).find((h) => sameHunk(h, hunk))
      if (!match) return this.notify('info', 'The diff changed; try again.')
      view.dispatch({
        changes: minimalChange(live, revertHunkText(mb.text, live, match)),
      })
      this.notify(
        'info',
        'Reverted the hunk to the base branch. Undo with Ctrl-Z in the editor.',
      )
    } catch (e) {
      this.fail(e)
    }
  }

  private async stageChange(
    svc: GitService,
    path: string,
    action: ReviewAction,
    head: string | null,
    live: string,
    hunk: Hunk | null,
  ) {
    const index = await svc.readIndex(path)
    if (hunk === null) {
      // The whole file: stage the buffer's text, or take it out of the index again.
      if (action === 'stage' && index === live) {
        await svc.resetIndex(path)
        return this.notify('info', `Unstaged ${path}.`)
      }
      await svc.writeIndex(path, live)
      return this.notify('info', `Staged ${path}.`)
    }
    const base = index ?? head ?? ''
    const staged = stageHunkText(base, live, hunk)
    if (staged !== null) {
      await svc.writeIndex(path, staged)
      return this.notify('info', 'Staged the hunk.')
    }
    if (action === 'put') return this.notify('info', 'The hunk is already staged.')
    const unstaged = unstageHunkText(head ?? '', base, hunk)
    if (unstaged === null) return this.notify('info', 'Nothing to stage for this hunk.')
    if (head === null && unstaged === '') await svc.removeFromIndex(path)
    else await svc.writeIndex(path, unstaged)
    this.notify('info', 'Unstaged the hunk.')
  }

  /** True when `.git` can be written; otherwise raises the reconnect prompt. */
  private async ensureGitWritable(): Promise<boolean> {
    const handle = this.linkHandle
    if (!handle || handle.kind === 'file')
      return (this.notify('error', 'Staging needs a linked git folder.'), false)
    if (this.linkPaused || !(await this.queryPermission(handle))) {
      this.requestGitWrite()
      return false
    }
    return true
  }

  private requestGitWrite() {
    this.linkGranted = false
    this.setLinkPaused(true)
    this.notify(
      'error',
      'Staging changes .git, which needs write access to the folder. Reconnect it to continue.',
    )
  }

  private applyDiff(path: string, hunks: readonly Hunk[]) {
    this.store.set(fileDiffMapAtom, (m) => {
      const next = new Map(m)
      if (hunks.length > 0) next.set(path, hunks)
      else next.delete(path)
      return next
    })
    if (path === this.active && this.handle) {
      this.handle.view.dispatch({ effects: setHunks.of(hunks) })
    }
  }

  // ---- live grep -------------------------------------------------------

  /** Keeps the text index in step with the tree; builds a fresh one for a new file system. */
  private syncGrep(entries: readonly Entry[]) {
    const fs = this.fs
    if (this.grepSvc && this.grepSvc.fs !== fs) {
      this.grepSvc.dispose()
      this.grepSvc = null
      this.store.set(grepStatusAtom, null)
    }
    if (!fs) return
    this.grepSvc ??= new GrepService(
      fs,
      (s) => this.store.set(grepStatusAtom, s),
      undefined,
      this.folderRoot(),
    )
    this.grepSvc.sync(entries)
  }

  /**
   * Live grep over the indexed workspace. Hits stream into `onBatch`; the returned
   * function cancels. Open buffers are searched first.
   */
  grep(
    query: string,
    onBatch: (hits: GrepHit[]) => void,
    onDone: (truncated: boolean) => void,
  ): () => void {
    // Text search covers every file, so the whole tree is read (and indexed) first.
    let stop = () => {}
    let cancelled = false
    void this.ensureFullTree().then(() => {
      if (cancelled) return
      const svc = this.grepSvc
      if (!svc) return onDone(false)
      const priority = [
        ...(this.active ? [this.active] : []),
        ...this.tabs.map((t) => t.path),
      ]
      stop = svc.search(query, priority, onBatch, onDone)
    })
    return () => {
      cancelled = true
      stop()
    }
  }

  /**
   * Like `grep`, but starts only once the whole tree is indexed, so a miss means the
   * symbol is absent, not that its file was not read yet.
   */
  grepComplete(
    query: string,
    onBatch: (hits: GrepHit[]) => void,
    onDone: (truncated: boolean) => void,
  ): () => void {
    let stop = () => {}
    let cancelled = false
    void this.ensureFullTree()
      .then(() => this.grepSvc?.idle())
      .then(() => {
        if (cancelled) return
        stop = this.grep(query, onBatch, onDone)
      })
    return () => {
      cancelled = true
      stop()
    }
  }

  /** The current text of a file for the grep preview: the open buffer, else the disk. */
  async readForPreview(path: string): Promise<string | null> {
    const b = this.buffers.get(path)
    if (b && !b.image) return this.liveDoc(b, path).toString()
    try {
      const fs = this.requireFS()
      const bytes = await fs.readBytes(path)
      return new TextDecoder().decode(bytes)
    } catch {
      return null
    }
  }

  /** Opens a file and puts the cursor on a 1-based line, centered in view. */
  async openFileAt(path: string, line: number, col = 0) {
    await this.openFile(path)
    const view = this.handle?.view
    if (!view || this.active !== normalizePath(path)) return
    const doc = view.state.doc
    const ln = doc.line(Math.min(Math.max(line, 1), doc.lines))
    const at = ln.from + Math.min(Math.max(col, 0), ln.length)
    view.dispatch({
      selection: EditorSelection.cursor(at),
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    })
    if (!this.overlayOpen()) view.focus()
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
      this.noWorkspaceLeft()
    }
  }

  // ---- showing buffers in the editor ----------------------------------

  private showActive() {
    const h = this.handle
    if (!h) return
    const b = this.active ? this.buffers.get(this.active) : undefined
    // Same object while the tab stays active, so the viewer keeps one object URL.
    this.store.set(activeImageAtom, b?.image ?? null)
    if (!b || b.image) {
      const empty = h.createState('')
      h.setState(
        empty.update({
          effects: StateEffect.appendConfig.of([
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
          ]),
        }).state,
      )
      this.store.set(
        activeBufferAtom,
        b?.image && this.active
          ? { ...initialBuffer, id: this.active, name: this.active }
          : { ...initialBuffer },
      )
      return
    }
    h.setState(b.state)
    if (this.active) {
      // A stashed state carries the hunks it was left with; show the freshest, then re-diff.
      h.view.dispatch({
        effects: setHunks.of(this.store.get(fileDiffMapAtom).get(this.active) ?? []),
      })
      this.pushDiff(this.active, true)
    }
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
    return (
      this.store.get(paletteOpenAtom) ||
      this.store.get(grepOpenAtom) ||
      this.store.get(settingsOpenAtom)
    )
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
    this.pushDiff(path)
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
    const bytes = await fs.readBytes(path)
    const kind = imageKind(path)
    if (kind) {
      if (!sniffImage(kind, bytes))
        throw new Error(`${path} is not a valid ${kind} image`)
      if (epoch !== this.epoch) return null
      if (!this.buffers.has(path)) {
        const state = this.handle
          ? this.handle.createState('')
          : EditorState.create({ doc: '' })
        this.buffers.set(path, {
          state,
          saved: state.doc,
          dirty: false,
          saveError: false,
          languageSet: true,
          image: { path, bytes, mime: imageMime(kind) },
          timer: undefined,
          chain: Promise.resolve(),
        })
        this.tabs.push({ path, pinned: false })
      }
      return path
    }
    // Binary files open as lossy text, read-only so a save can never corrupt them.
    const binary = bytes.subarray(0, 8192).includes(0)
    if (epoch !== this.epoch) return null
    if (!this.buffers.has(path)) {
      const text = new TextDecoder().decode(bytes)
      let state = this.handle
        ? this.handle.createState(text)
        : EditorState.create({ doc: text })
      if (binary) {
        state = state.update({
          effects: StateEffect.appendConfig.of([
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
          ]),
        }).state
      }
      this.buffers.set(path, {
        state,
        saved: state.doc,
        dirty: false,
        saveError: false,
        languageSet: binary,
        timer: undefined,
        chain: Promise.resolve(),
      })
      this.tabs.push({ path, pinned: false })
    }
    return path
  }

  /** Opens a file. */
  async openFile(path: string) {
    const target = normalizePath(path)
    const pending = !this.buffers.has(target)
    // Optimistic: mark it opening at once so the tree and editor can react while it reads.
    if (pending) this.store.set(openingPathAtom, target)
    try {
      const p = await this.load(path)
      if (p) {
        this.activate(p)
      }
    } catch (e) {
      this.fail(e)
    } finally {
      if (pending && this.store.get(openingPathAtom) === target)
        this.store.set(openingPathAtom, null)
    }
  }

  /**
   * Whether `ref`, mentioned in the active file, may be a workspace file: true when it
   * matches the loaded tree, or when the tree is still partial and could hold it.
   */
  mayOpenReference(ref: string): boolean {
    const from = this.active
    if (!this.fs || from === null) return false
    const cands = pathCandidates(ref, from)
    if (!this.complete) return cands.length > 0
    const tree = this.store.get(treeAtom)
    return cands.some((p) => tree.some((e) => e.kind === 'file' && e.path === p))
  }

  /**
   * Opens the file a path mentioned in the active file refers to (relative to its folder,
   * then to the workspace root). Does nothing when no such file exists. Responds at once:
   * a file already in the loaded tree opens without waiting, and otherwise the likeliest
   * target shows as opening while the candidates are checked directly on disk (no full
   * tree walk).
   */
  async openReference(ref: string): Promise<boolean> {
    const from = this.active
    const fs = this.fs
    if (!fs || from === null) return false
    const cands = pathCandidates(ref, from)
    // Nothing to look up (e.g. a bare package name in code).
    if (cands.length === 0) return false
    const known = new Set(
      this.store
        .get(treeAtom)
        .filter((e) => e.kind === 'file')
        .map((e) => e.path),
    )
    let hit = cands.find((p) => known.has(p))
    if (!hit && this.complete) return false
    if (!hit) {
      const guess = cands[0]!
      this.store.set(openingPathAtom, guess)
      try {
        const found = await Promise.all(
          cands.map((p) =>
            fs.stat(p).then(
              (e) => e?.kind === 'file',
              () => false,
            ),
          ),
        )
        hit = cands.find((_, i) => found[i])
      } finally {
        if (this.fs === fs && this.store.get(openingPathAtom) === guess)
          this.store.set(openingPathAtom, null)
      }
      if (!hit || this.fs !== fs) return false
    }
    await this.openFile(hit)
    return true
  }

  /** Focuses a tab, even if it is already active (clicking a tab returns focus to the editor). */
  private activate(path: string) {
    this.store.set(branchTabActiveAtom, false)
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

  /** Copies the active file's live text (the editor's current doc, saved or not). */
  async copyActiveText() {
    const view = this.handle?.view
    if (!view || !this.active) return this.notify('error', 'No file is open to copy.')
    try {
      await navigator.clipboard.writeText(view.state.doc.toString())
      this.notify('info', 'Copied file contents')
    } catch {
      this.notify('error', 'Could not copy to the clipboard')
    }
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
    if (!b || !this.fs || b.image) return Promise.resolve() // images are read-only
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
        if (this.fs === fs) {
          this.grepSvc?.touch(path)
          this.scheduleGitRefresh(path)
        }
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
    if (this.fs instanceof SingleFileFS) {
      this.notify('info', 'This workspace is a single file; open a folder to create more')
      return
    }
    if (this.untitledTyping) {
      this.untitledTyping.text += initial
      return
    }
    const typing = { text: initial }
    this.untitledTyping = typing
    try {
      const fs = this.requireFS()
      const path = await this.nextUntitledPath(fs)
      const epoch = this.epoch
      await fs.write(path, '')
      if (this.fs !== fs || this.epoch !== epoch) return
      await this.patchTree((entries) =>
        addEntry(entries, { name: basename(path), path, kind: 'file', size: 0 }),
      )
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
   * Replaces every whole-word `oldName` with `newName` in the given files (text-based, so
   * strings and comments change too). Open buffers are edited like typing and autosave;
   * closed files are read, changed and written. Returns how many files changed.
   */
  async renameSymbol(paths: readonly string[], oldName: string, newName: string) {
    const re = refRegex(oldName)
    const fs = this.requireFS()
    let changed = 0
    for (const raw of paths) {
      const path = normalizePath(raw)
      const b = this.buffers.get(path)
      if (b?.image) continue
      if (!b) {
        // Not open: read, change and write the file without opening a tab for it.
        try {
          const text = new TextDecoder().decode(await fs.readBytes(path))
          const out = text.replace(re, () => newName)
          if (out === text) continue
          await fs.write(path, out)
          this.grepSvc?.touch(path)
          changed++
        } catch (e) {
          this.fail(e)
        }
        continue
      }
      const doc = this.liveDoc(b, path)
      const changes: { from: number; to: number; insert: string }[] = []
      for (const m of doc.toString().matchAll(re))
        changes.push({ from: m.index, to: m.index + m[0].length, insert: newName })
      if (changes.length === 0) continue
      changed++
      if (this.handle && this.active === path) {
        this.handle.view.dispatch({ changes })
      } else {
        b.state = b.state.update({ changes }).state
        b.dirty = !b.state.doc.eq(b.saved)
      }
      clearTimeout(b.timer)
      b.timer = setTimeout(() => void this.save(path), AUTOSAVE_MS)
    }
    this.scheduleGitRefresh()
    this.publishBuffers()
    return changed
  }

  /**
   * Shows the blank page (the opener) without closing any tab. The open tabs stay in the
   * strip; clicking one brings its file back.
   */
  showHome() {
    // The review overlays cover the opener, so drop them too.
    this.store.set(reviewOpenAtom, false)
    this.store.set(branchTabActiveAtom, false)
    if (this.active === null) return
    this.commit({ tabs: this.tabs, active: null })
  }

  // ---- files and folders ----------------------------------------------

  async createFile(rawPath: string) {
    try {
      const path = normalizePath(rawPath)
      if (path === '') throw new Error('Name cannot be empty')
      const fs = this.requireFS()
      if (this.fs instanceof SingleFileFS) {
        this.notify(
          'info',
          'This workspace is a single file; open a folder to create more',
        )
        return
      }
      if (await fs.stat(path)) throw new Error(`Already exists: ${path}`)
      const epoch = this.epoch
      await fs.write(path, '')
      if (this.fs !== fs || this.epoch !== epoch) return
      await this.patchTree((entries) =>
        addEntry(entries, { name: basename(path), path, kind: 'file', size: 0 }),
      )
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
      if (this.fs instanceof SingleFileFS) {
        this.notify(
          'info',
          'This workspace is a single file; open a folder to create more',
        )
        return
      }
      if (await fs.stat(path)) throw new Error(`Already exists: ${path}`)
      const epoch = this.epoch
      await fs.mkdir(path)
      if (this.fs !== fs || this.epoch !== epoch) return
      await this.patchTree((entries) =>
        addEntry(entries, { name: basename(path), path, kind: 'dir' }),
      )
    } catch (e) {
      this.fail(e)
    }
  }

  async renamePath(fromRaw: string, toRaw: string) {
    try {
      const from = normalizePath(fromRaw)
      const to = normalizePath(toRaw)
      const fs = this.requireFS()
      const epoch = this.epoch
      await Promise.all(
        [...this.buffers.keys()]
          .filter((p) => isWithin(p, from))
          .map((p) => this.save(p)),
      )
      await fs.rename(from, to)
      // The switch first: renaming the buffers of a workspace the user already left
      // would corrupt them; the tree patch can afford to be skipped instead.
      if (this.fs !== fs || this.epoch !== epoch) return
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
      await this.patchTree((entries) => renameEntries(entries, from, to))
    } catch (e) {
      this.fail(e)
    }
  }

  async deletePath(rawPath: string) {
    let deletingPath: string | null = null
    let fs: WorkspaceFS | null = null
    let epoch = this.epoch
    let started = false
    try {
      const path = normalizePath(rawPath)
      deletingPath = path
      fs = this.requireFS()
      epoch = this.epoch
      if (this.store.get(deletingPathsAtom).size > 0) return
      this.store.set(deletingPathsAtom, (current) => new Set(current).add(path))
      started = true
      this.treeMutations++
      this.store.set(treeAtom, (entries) =>
        entries.filter((entry) => !isWithin(entry.path, path)),
      )
      this.pruneLoaded()

      await fs.remove(path)
      if (this.fs !== fs || this.epoch !== epoch) return

      const gone = [...this.buffers.keys()].filter((p) => isWithin(p, path))
      this.commit(removeTabs(this.tabState(), gone), { removed: gone })
      // The optimistic filter above already removed the entries; a full walk would
      // only re-derive what the delete decided.
      this.notify('info', `Deleted "${path}".`)
    } catch (e) {
      // A failed delete may have left the tree half-updated; refresh it. If the
      // folder cannot be listed either, the refresh itself surfaces that state.
      if (fs && this.fs === fs && this.epoch === epoch) await this.refreshTree()
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

  /** No workspace is left: nothing is open, and the tree asks for a folder. */
  private noWorkspaceLeft() {
    this.linkHandle = null
    this.linkPaused = false
    this.linkGranted = null
    this.publishLink()
    this.store.set(currentWorkspaceIdAtom, null)
    this.store.set(treeAtom, [])
    this.store.set(treeStatusAtom, { state: 'no-folder' })
  }

  /** Opens a folder picker and creates or switches to the workspace for that folder. */
  async newWorkspace() {
    const handle = await this.pickFolder()
    if (!handle) return
    await this.openFolderHandle(handle)
  }

  async switchTo(id: string, opts: { seed?: () => Promise<string | undefined> } = {}) {
    const manager = this.requireManager()
    if (this.wsId) {
      await this.flushAll()
      await this.saveSessionNow()
    }
    const epoch = ++this.epoch
    // An open branch review belongs to the workspace it was read from: drop it now and
    // read the same kind of review again once the new workspace is ready.
    const review = this.store.get(branchReviewAtom)
    const reopen = review
      ? { mode: review.mode, visible: this.store.get(branchTabActiveAtom) }
      : null
    if (review) this.dropBranchReview()
    for (const b of this.buffers.values()) clearTimeout(b.timer)
    this.buffers = new Map()
    this.tabs = []
    this.active = null
    this.wsId = id
    this.fs = null
    this.linkHandle = null
    this.store.set(currentWorkspaceIdAtom, id)
    // The previous workspace's files leave the view while this folder is read.
    this.store.set(treeAtom, [])
    this.resetTreeState()
    this.store.set(treeStatusAtom, { state: 'loading' })
    await manager.setLastId(id)

    const meta = await manager.get(id)
    // A single-file workspace keeps its handle under a different key (see `fileLinkKey`).
    const handle =
      meta?.kind === 'file' ? await manager.getFileLink(id) : await manager.getLink(id)
    if (!handle) {
      // Rare after pruning: a record with no linked handle cannot be read at all.
      this.linkPaused = false
      this.linkGranted = null
      this.store.set(treeStatusAtom, {
        state: 'error',
        message: 'Workspace is missing its linked folder',
      })
    } else {
      this.linkHandle = handle
      // Readwrite is checked, never required: listing needs only read, and a
      // freshly picked handle is always readable (the pick grants read). A
      // lapsed or partial write grant keeps the files visible read-only; failed
      // writes raise Reconnect (see `save`).
      const writable = await this.queryPermission(handle)
      this.linkGranted = writable
      this.linkPaused = !writable
      this.fs = this.fsFor(handle)
    }
    this.publishLink()
    // Only the root is listed; the rest of the tree is read when it is needed.
    const treeDone = this.refreshTree()
    let wanted = meta?.openFiles ?? []
    if (wanted.length === 0 && opts.seed) {
      try {
        const first = await opts.seed()
        if (first) wanted = [first]
      } catch {
        /* unreadable folder: the tree already shows the permission or error state */
      }
    }
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
    // Tabs are on screen already; the tree may still be filling in.
    await treeDone
    // Git attaches when the tree is read, so the review waits for it: opened earlier it
    // would read the previous workspace's repository.
    if (reopen && this.fs && epoch === this.epoch) {
      void this.openBranchReview(undefined, reopen.mode)
      if (!reopen.visible) this.store.set(branchTabActiveAtom, false)
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

  async togglePinWorkspace(id: string) {
    try {
      const manager = this.requireManager()
      const meta = await manager.get(id)
      if (!meta) return
      await manager.setPinned(id, !meta.pinned)
      this.store.set(workspacesAtom, await manager.list())
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
          this.noWorkspaceLeft()
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

  /** A picked file becomes a workspace with that one file; `SingleFileFS` serves it. */
  async importFileHandle(handle: LinkedFile) {
    const manager = this.requireManager()
    // Keyed by the file name, so opening the same file again switches to its existing
    // workspace, mirroring how folders reuse theirs. The marker keeps a same-named
    // folder and file from sharing one source key; folder hashing stays untouched.
    const source = await sourceKey(handle.name, ['<single-file>'])
    const existing = await manager.findBySource(source)
    if (existing) {
      await manager.setFileLink(existing.id, handle)
      await this.refreshWorkspaces()
      await this.switchTo(existing.id)
      this.notify(
        'info',
        `"${existing.name}" is already open, so it was switched to. Delete it under Recent workspaces to open this file again.`,
      )
      return
    }
    const meta = await manager.create(handle.name, source, 'file')
    await manager.setFileLink(meta.id, handle)
    await this.refreshWorkspaces()
    await this.switchTo(meta.id)
    if (this.active !== handle.name) await this.openFile(handle.name)
    this.notify('info', `Opened "${meta.name}".`)
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
    try {
      const folder = await w.showDirectoryPicker({ mode: 'readwrite' })
      return folder as LinkedFolder
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
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
      this.store.set(sidebarOpenAtom, true)
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
    this.store.set(sidebarOpenAtom, true)
    // The first file is a convenience: a folder that cannot be read (yet) must
    // still open; refreshTree surfaces exactly how far the access reaches. It opens
    // while the tree is still being read.
    await this.switchTo(meta.id, { seed: () => this.firstFilePath(handle) })
    this.notify('info', `Opened "${meta.name}".`)
  }

  /**
   * The file a new workspace opens with: the first file (natural order) of the shallowest
   * directory that has one, skipping folders that are never listed. Reads only as many
   * directories as it takes, not the whole tree.
   */
  private async firstFilePath(
    handle: FileSystemDirectoryHandle,
  ): Promise<string | undefined> {
    const byName = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true })
    const search = async (
      dir: FileSystemDirectoryHandle,
      prefix: string,
    ): Promise<string | undefined> => {
      const files: string[] = []
      const dirs: FileSystemDirectoryHandle[] = []
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'file') files.push(name)
        else if (!IGNORED.has(name)) dirs.push(h as FileSystemDirectoryHandle)
      }
      if (files.length > 0) return joinPath(prefix, files.sort(byName)[0]!)
      for (const d of dirs.sort((a, b) => byName(a.name, b.name))) {
        const found = await search(d, joinPath(prefix, d.name))
        if (found) return found
      }
      return undefined
    }
    return search(handle, '')
  }

  // ---- linked folder ---------------------------------------------------

  private publishLink() {
    const handle = this.linkHandle
    this.store.set(
      linkedFolderAtom,
      handle
        ? {
            name: handle.name,
            paused: this.linkPaused,
            single: handle.kind === 'file',
          }
        : null,
    )
    // Ask on open and after a failed write. A dismissed prompt stays dismissed until then.
    this.store.set(reconnectPromptAtom, this.linkPaused)
  }

  private async queryPermission(handle: LinkedFolder | LinkedFile): Promise<boolean> {
    try {
      return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
    } catch {
      return false
    }
  }

  /** The workspace reads and writes through an FS shaped like the linked handle. */
  private fsFor(handle: LinkedFolder | LinkedFile): WorkspaceFS {
    return handle.kind === 'file'
      ? new SingleFileFS(handle as FileSystemFileHandle & PermissionedHandle)
      : new FolderFS(handle as FileSystemDirectoryHandle & PermissionedHandle)
  }

  private setLinkPaused(paused: boolean) {
    this.linkPaused = paused
    this.publishLink()
  }

  /**
   * Re-checks the link permission when the tab regains focus or becomes visible. The
   * File System Access API has no change events, so a revoke or an external disk change
   * is otherwise only noticed by a failed save. While `linkGranted` says granted and
   * the browser now says otherwise, that lapse is new: the reconnect prompt is raised
   * again even if an earlier one was dismissed, because access still does not work.
   */
  async revalidateOnFocus() {
    if (document.visibilityState === 'hidden') return
    const handle = this.linkHandle
    if (!handle || this.revalidating) return
    // One refresh at a time: a switch's own first listing or a Ctrl-R covers it. A
    // paused link still gets checked, so it is the one state that can recover here.
    if (this.store.get(treeStatusAtom).state === 'loading') return
    this.revalidating = true
    const epoch = this.epoch
    try {
      const granted = await this.queryPermission(handle)
      if (this.epoch !== epoch || this.linkHandle !== handle) return
      const wasGranted = this.linkGranted
      this.linkGranted = granted
      if (wasGranted && !granted) {
        this.setLinkPaused(true)
      } else if (granted && this.linkPaused) {
        // Access can also come back without a click (browser site settings): rebuild
        // the FS exactly like reconnectFolder does, folder and file alike.
        this.fs = this.fsFor(handle)
        this.setLinkPaused(false)
        await this.refreshTree()
      } else if (granted && Date.now() - this.lastTreeRefresh > 15_000) {
        await this.refreshTree({ silent: true })
      }
    } finally {
      this.revalidating = false
    }
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
      this.linkGranted = true
      this.setLinkPaused(false)
      this.fs = this.fsFor(handle)
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
