# Project Structure

Daedalus IDE is a browser-only code editor built with React 19, jotai, CodeMirror 6 (with vim mode), isomorphic-git, Tailwind 4 and Vite. It is installable as a PWA. See [ARCHITECTURE.md](ARCHITECTURE.md) for the product design (BYOK AI pipeline) and [AGENTS.md](AGENTS.md) for contributor and agent rules.

## Top level

| Path | Purpose |
| --- | --- |
| [index.html](index.html) | Vite entry HTML |
| [package.json](package.json) | Scripts: `dev`, `build`, `lint`, `typecheck`, `format`, `format:check`, `test`, `test:watch`, `preview` |
| [vite.config.ts](vite.config.ts) | Plugins (react, tailwind, PWA), ES-module workers, manual chunks (vim, vendor-git, vendor-react), and the vitest config |
| [tsconfig.json](tsconfig.json) | Project-references root over [tsconfig.app.json](tsconfig.app.json) and [tsconfig.node.json](tsconfig.node.json) |
| [eslint.config.js](eslint.config.js), [.prettierrc.json](.prettierrc.json) | Lint and format config (no semicolons, single quotes, width 90) |
| [public/](public/) | Static assets: icons, [manifest.webmanifest](public/manifest.webmanifest), [theme-init.js](public/theme-init.js) (external because the CSP forbids inline scripts) |
| [netlify/edge-functions/](netlify/edge-functions/) | Placeholder for a planned proxy |
| [.claude/agents/](.claude/agents/), [.opencode/agents/](.opencode/agents/) | Subagent definitions (`search`, `grep`, `audit`). Keep the two in sync. [advisor.md](.opencode/agents/advisor.md) exists only under `.opencode` |
| [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md) | Docs and agent instructions |

Empty placeholder directories (`.gitkeep` only) for planned features: [src/providers](src/providers/), [src/router](src/router/), [src/vault](src/vault/), [src/workflow](src/workflow/).

## Entry points

- [src/main.tsx](src/main.tsx) applies the theme, registers the service worker and renders `<App/>`.
- [src/App.tsx](src/App.tsx) is the shell. It composes editor, workspace, PWA and UI pieces, reads atoms from [state/](src/state/), and gets the controller through [workspace/useWorkspace](src/workspace/useWorkspace.ts).
- [src/index.css](src/index.css) and [src/styles/tokens.css](src/styles/tokens.css) hold the Tailwind setup and design tokens.

## `src/` directories

### [`state/`](src/state/) (jotai atoms and pure helpers)
[workspaceAtoms.ts](src/state/workspaceAtoms.ts), [editorAtoms.ts](src/state/editorAtoms.ts), [gitAtoms.ts](src/state/gitAtoms.ts), [branchReviewAtoms.ts](src/state/branchReviewAtoms.ts), and [tabOps.ts](src/state/tabOps.ts) (pure tab operations).

### [`editor/`](src/editor/) (CodeMirror layer and editor UI)
- [Editor.tsx](src/editor/Editor.tsx) is the React wrapper, and [createEditor.ts](src/editor/createEditor.ts) builds the CodeMirror instance.
- [theme.ts](src/editor/theme.ts) is the CodeMirror theme, and [languages.ts](src/editor/languages.ts) loads languages lazily.
- [pathLinks.ts](src/editor/pathLinks.ts) turns file paths in the text into links.
- [vimMode.ts](src/editor/vimMode.ts) and [VimStatus.tsx](src/editor/VimStatus.tsx) handle vim integration and its status line.
- [diffGutter.ts](src/editor/diffGutter.ts) and [DiffStat.tsx](src/editor/DiffStat.tsx) show diff marks and the diff summary.
- [CommandPalette.tsx](src/editor/CommandPalette.tsx) and [paletteSearch.ts](src/editor/paletteSearch.ts) are the command palette and its search.
- [GrepFinder.tsx](src/editor/GrepFinder.tsx) is the grep search UI.
- [ImageViewer.tsx](src/editor/ImageViewer.tsx) and [EditorSkeleton.tsx](src/editor/EditorSkeleton.tsx) are the image preview and loading state.
- [testing/runEx.ts](src/editor/testing/runEx.ts) is a test helper for vim ex commands.

### [`workspace/`](src/workspace/) (filesystem, git, search, workers, workspace UI)
- **Orchestration**
  - [controller.ts](src/workspace/controller.ts) is the hub. It wires the filesystems and the git, grep, diff and branch-prefetch services to editor, state and review.
  - [manager.ts](src/workspace/manager.ts) (`WorkspaceManager`) stores the filesystem handle links.
  - [useWorkspace.ts](src/workspace/useWorkspace.ts) provides the React hooks `useController` and `useWorkspaceLifecycle`.
  - [types.ts](src/workspace/types.ts) and [path.ts](src/workspace/path.ts) hold shared types and path helpers.
- **Filesystems**
  - [fsContract.ts](src/workspace/fsContract.ts) defines the interface.
  - [folderFs.ts](src/workspace/folderFs.ts) and [folderWalk.ts](src/workspace/folderWalk.ts) implement the File System Access folder and its walk.
  - [singleFileFs.ts](src/workspace/singleFileFs.ts) implements a single file.
  - [gitFs.ts](src/workspace/gitFs.ts) adapts a filesystem for isomorphic-git.
  - [testing/memoryDisk.ts](src/workspace/testing/memoryDisk.ts) is an in-memory disk for tests.
- **Persistence**: [db.ts](src/workspace/db.ts) (IndexedDB), [storage.ts](src/workspace/storage.ts), [snapshot.ts](src/workspace/snapshot.ts), [loadEstimate.ts](src/workspace/loadEstimate.ts).
- **Files**: [archive.ts](src/workspace/archive.ts) (zip export) and [image.ts](src/workspace/image.ts) (image detection).
- **Git**: [gitService.ts](src/workspace/gitService.ts), [branchPrefetch.ts](src/workspace/branchPrefetch.ts), [branchPrefetchService.ts](src/workspace/branchPrefetchService.ts), [branchPrefetch.worker.ts](src/workspace/branchPrefetch.worker.ts).
- **Search**: [grep.ts](src/workspace/grep.ts), [grepRead.ts](src/workspace/grepRead.ts), [grepService.ts](src/workspace/grepService.ts), [grep.worker.ts](src/workspace/grep.worker.ts).
- **Walk worker**: [walk.worker.ts](src/workspace/walk.worker.ts), [walkService.ts](src/workspace/walkService.ts).
- **UI**
  - Pickers and dialogs: [useFilePicker.tsx](src/workspace/useFilePicker.tsx), [useFolderPicker.tsx](src/workspace/useFolderPicker.tsx), [WorkspaceOpener.tsx](src/workspace/WorkspaceOpener.tsx), [ReconnectDialog.tsx](src/workspace/ReconnectDialog.tsx), [SettingsDialog.tsx](src/workspace/SettingsDialog.tsx).
  - Components: [FileTree.tsx](src/workspace/FileTree.tsx), [FileFinder.tsx](src/workspace/FileFinder.tsx), [Tabs.tsx](src/workspace/Tabs.tsx), [HomeButton.tsx](src/workspace/HomeButton.tsx), [SaveButton.tsx](src/workspace/SaveButton.tsx), [NameInput.tsx](src/workspace/NameInput.tsx), [Notice.tsx](src/workspace/Notice.tsx).
  - Tree rows and loading screen: [treeRows.ts](src/workspace/treeRows.ts), [TreeSkeleton.tsx](src/workspace/TreeSkeleton.tsx), [TicTacToe.tsx](src/workspace/TicTacToe.tsx), [ticTacToeLogic.ts](src/workspace/ticTacToeLogic.ts).

### [`review/`](src/review/) (diff and review)
[diff.ts](src/review/diff.ts) (hunk computation), [diff.worker.ts](src/review/diff.worker.ts) and [diffService.ts](src/review/diffService.ts) (diffing off the main thread), [diffView.ts](src/review/diffView.ts), [reviewPane.ts](src/review/reviewPane.ts), [stage.ts](src/review/stage.ts), [DiffReview.tsx](src/review/DiffReview.tsx), and [branch/](src/review/branch/) ([BranchReview.tsx](src/review/branch/BranchReview.tsx), [marks.ts](src/review/branch/marks.ts)).

### [`ui/`](src/ui/) (design-system primitives, re-exported from [ui/index.ts](src/ui/index.ts))
[Button](src/ui/Button.tsx), [Chip](src/ui/Chip.tsx), [ContextMenu](src/ui/ContextMenu.tsx), [GlassPopover](src/ui/GlassPopover.tsx), [Icon](src/ui/Icon.tsx), [IconButton](src/ui/IconButton.tsx), [Input](src/ui/Input.tsx), [Kbd](src/ui/Kbd.tsx), [Panel](src/ui/Panel.tsx), [Skeleton](src/ui/Skeleton.tsx).

### [`lib/`](src/lib/) (utilities)
[theme.ts](src/lib/theme.ts) and [themes.ts](src/lib/themes.ts) (theme apply, load and definitions), [doubleShift.ts](src/lib/doubleShift.ts), [motion.ts](src/lib/motion.ts), [platform.ts](src/lib/platform.ts).

### [`pwa/`](src/pwa/)
[register.ts](src/pwa/register.ts) (service worker and preload-error handling), [updateAtom.ts](src/pwa/updateAtom.ts), [UpdatePrompt.tsx](src/pwa/UpdatePrompt.tsx).

### [`styles/`](src/styles/)
[tokens.css](src/styles/tokens.css) (design tokens).

## Dependency direction

```
main.tsx -> App.tsx -> editor/, workspace/, state/, ui/, pwa/
workspace/controller.ts -> editor/ (createEditor, diffGutter), state/, review/ (diff, DiffService)
```

Heavy work runs in ES-module web workers: grep, walk, diff and branch prefetch. Each follows the same pattern of a pure logic file, a `*.worker.ts` and a `*Service.ts` wrapper.

## Conventions

- Naming: components are `PascalCase.tsx`, logic modules are `camelCase.ts`, workers are `*.worker.ts`, hooks are `use*.ts(x)`.
- Imports are relative. There is no path alias.
- Tests are colocated as `*.test.ts(x)` next to the source. Vitest only picks up `src/**/*.test.{ts,tsx}` (jsdom, globals, fake-indexeddb). Test helpers live in `testing/` subdirectories.
- [src/test-setup.ts](src/test-setup.ts) holds environment patches: a fresh IndexedDB per test, an in-memory `WorkspaceManager` link store, `keyCode` for Enter, and `Range` rect stubs.
- Use `@testing-library/user-event` for interactions. Use `fireEvent` only for events it cannot model, such as `contextMenu`.
- Run `npm run lint`, `npm run typecheck` and `npx vitest run` directly in the working checkout.
