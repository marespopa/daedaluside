# Implementation Plan

The **MVP ships with Google Gemini as the only AI provider** and no backend (M0–M7, tagged `v0.1.0`). More providers come after the MVP (M8–M9). Each milestone ends in a working build that can be deployed. Later milestones depend on earlier ones, but the UI polish work (M6) can run alongside M3–M5. See [ARCHITECTURE.md](./ARCHITECTURE.md) for design details, and §1.1 there for the MVP scope.

| Milestone | Outcome                                                                 | Depends on | Release  |
| :-------- | :---------------------------------------------------------------------- | :--------- | :------- |
| M0        | Project scaffold + CI + Netlify deploy (Netlify connection pending)     | n/a        | MVP      |
| M1        | Distraction-free editor (single file, in-memory) (done; e2e pending CI) | M0         | MVP      |
| M2        | OPFS workspace (multi-file, persistent)                                 | M1         | MVP      |
| M3        | Key vault + Gemini adapter                                              | M0         | MVP      |
| M4        | Model router + Plan → Review workflow                                   | M2, M3     | MVP      |
| M5        | Execute → Diff review → Apply                                           | M4         | MVP      |
| M6        | UX polish, focus mode, theming, accessibility                           | M1         | MVP      |
| M6b       | iA Writer workspace redesign (layout, tree, tabs, status, focus)        | M1; M2 for tree and tabs | MVP |
| M7        | Hardening, testing, docs, **MVP release `v0.1.0`**                      | M0–M6      | MVP      |
| M8        | Direct providers: Anthropic, local Ollama; cross-provider fallback      | M7         | Post-MVP |
| M9        | LLM proxy (Edge Function) + Ollama Cloud + OpenCode                     | M8         | Post-MVP |

---

## M0: Scaffold & Deployment

**Goal:** an empty app deployed to Netlify with the final security headers in place from day one.

- [x] `npm create vite@latest` with the React + TypeScript template; strict `tsconfig`.
- [x] Tailwind CSS v4, base typography tokens, light/dark CSS variables.
- [x] ESLint + Prettier; `vitest` + `@testing-library/react`; Playwright for e2e.
- [x] Create the folder structure from ARCHITECTURE.md §4.
- [x] `netlify.toml` with SPA redirect, the corrected CSP (ARCHITECTURE.md §8.1), and immutable asset caching.
- [x] GitHub Actions: typecheck, lint, unit tests, build, `npm audit --audit-level=high`.
- [ ] Connect the repo to Netlify; deploy previews on PRs.
- [x] Design system foundation (ARCHITECTURE.md §5.8): `src/styles/tokens.css` with semantic light/dark color tokens (canvas, surface, text, muted, line, accent, diff-add, diff-remove) mapped through Tailwind `@theme`; class-based dark mode; UI sans and monospace font stacks. Replace any raw hex values in existing components with tokens.

**Status:** implemented, including the design tokens (`src/styles/tokens.css`). Only connecting the repo to Netlify remains (not verifiable from the repo; do this in the Netlify dashboard). Dark-mode diff colors are provisional until M6.

**Done when:** a pushed commit deploys, and the CSP header shows up in the browser with no console violations.

---

## M1: Distraction-Free Editor

**Goal:** a single-buffer CodeMirror 6 editor in the iA Writer style.

- [x] `editor/` module: `createEditor()` factory with the base extensions (history, search, bracket matching, autoclose, keymaps).
- [x] Lazy language loading through `@codemirror/language-data`.
- [x] Monochrome syntax theme (light + dark); self-hosted monospace font with `font-display: swap`.
- [x] Centered layout with a max line width; chrome hidden by default.
- [x] Command palette (`Mod-K`) as the main control surface.
- [x] Jotai `editorAtoms`: active buffer metadata. CodeMirror owns the document text.
- [x] Apply the design system (§5.8): CodeMirror theme driven by CSS variables; 2 px accent cursor and accent selection tint; editor column `max-w-[72ch]` (since replaced by the responsive column, M6b Phase 1), `leading-relaxed`; app shell layout (collapsible translucent sidebar, 48 px header with transparent border until hover, breadcrumb); command palette as a glass panel.
- [x] `src/ui/` primitives: `Panel`, `GlassPopover`, `Chip`, `IconButton`, `Kbd`, with an opaque fallback when `backdrop-filter` is unsupported.

**Status (2026-11-03):** complete. Line numbers and active-line fill were added in M6b Phase 1, and the shell now uses the 40 px header from §5.8. Typecheck, lint, Prettier, unit tests, and `vite build` pass. The Playwright smoke test (CSP + palette) still fails because Chromium's GPU process crashes in the Termux dev environment; run it in CI. Main bundle is 689 kB (221 kB gzip), under the M7 budget of 250 KB gzip. Re-check in M7.

**Done when:** the user can open the app, type code with highlighting, switch themes, and use the palette, with no visible chrome.

---

## M2: OPFS Workspace

**Goal:** persistent, multi-file workspaces stored on the device.

- [x] `fs.worker.ts`: OPFS operations using `createSyncAccessHandle` (list/read/write/remove/rename/mkdir).
- [x] Typed RPC client (`fs.ts`, `rpc.ts`), hand-written wrapper (`RpcBackend`).
- [x] Atomic writes (temp file + replace, native move with copy fallback).
- [x] `fallback-idb.ts` implementing the same `WorkspaceFS` interface; capability detection at startup (`createBackend`: OPFS worker probe, else IndexedDB).
- [x] Workspace manager: create, rename, delete, switch. Metadata in IndexedDB (`manager.ts`, `db.ts`).
- [x] File tree overlay (toggle with `Mod-B`): create, rename, delete, open (`FileTree.tsx`).
- [x] Multiple open buffers (`Tabs.tsx`), dirty tracking, autosave (800 ms debounce) + `Mod-S`.
- [x] Import from folder or `.zip` (`fflate`); zip import is a drop onto the opener. Export to `.zip` is implemented (`archive.ts`, `controller.exportCurrentZip`) but no longer exposed in the UI after the 2026-11-03 sidebar cleanup. Re-expose it in Settings if needed.
- [x] Opening a folder shows a loading overlay with progress (scan, then copy) in place of the blank page and scratch tab, until its first file is open. A failed import shows the error and restores the previous view. Only one import runs at a time (`OpeningFolder.tsx`, `controller.runImport`).
- [x] Blank workspaces (first run, New workspace) start with no files; the opener says what to do next. An empty, untouched `scratch.ts` left by older builds is removed once, when its workspace is opened (`controller.dropPlaceholderScratch`).
- [x] `navigator.storage.persist()` requested at startup; storage details and quota in settings.

**Status (2026-11-03):** code complete and committed in `79ad171` (`Add tab bar, OPFS workspace and iA Writer shell redesign`). The shared FS contract runs against IndexedDB, OPFS with native move, OPFS with copy fallback, and OPFS through the worker RPC. Controller tests cover the workspace flows, reload restore, zip drop, and error notices. Not verified in a real browser: OPFS persistence across a browser restart, and the worker path under real `createSyncAccessHandle`. Verify manually or in CI. The `pre-iA-redesign` stash remains as a safety copy; retain it until separately reviewed.

**Re-opening a folder:** a folder or zip is identified by its name and file layout (`sourceKey`). Opening the same one again switches to the existing workspace and shows a notice. It does not re-import, so later changes in the source folder are not picked up. To re-import, delete the workspace from Recent workspaces (each row has a Delete action with a second click to confirm). Changing the layout (adding or removing files) counts as a different folder and creates a new entry.

**Done when:** a workspace with nested folders survives reloads and browser restarts, and zip import followed by export reproduces the same file tree. FS unit tests pass against both the OPFS and IDB backends.

---

## M3: Key Vault & Gemini Adapter

**Goal:** keys stored encrypted, and working streaming chat with Gemini behind a provider interface that later providers can reuse.

### Vault
- [ ] `vault/crypto.ts`: PBKDF2-SHA-256 (600k iterations) → AES-GCM-256 non-extractable key; encrypt/decrypt with a random IV.
- [ ] Vault records in IndexedDB; in-memory key map; lock/unlock API.
- [ ] Unlock modal at session start; auto-lock on idle (configurable) and on `pagehide`.
- [ ] Settings UI: add, replace, or remove a key per provider; change passphrase (re-encrypt everything); reset the vault.
- [ ] Optional "remember on this device", with a clear warning that it is weaker.

### Provider layer
- [ ] `LLMProvider` interface and `ChatChunk`/`ProviderError` types. Keep them provider-neutral; don't bake in Gemini-specific fields.
- [ ] Shared SSE parser (`lib/stream.ts`).
- [ ] `gemini.ts`: `streamGenerateContent?alt=sse` with the `x-goog-api-key` header; system instructions; usage extraction (`usageMetadata`); model list from `GET /v1beta/models`, grouped by tier (Pro / Flash / Flash-Lite).
- [ ] "Test connection" button (lists models with the stored key).
- [ ] Mocked-fetch unit tests: stream parsing (including events split across chunks), auth/429/5xx errors, abort.

**Done when:** Gemini streams a reply into a scratch panel, and cancelling stops it immediately. Inspecting IndexedDB shows only ciphertext, and keys are gone after locking.

---

## M4: Router + Plan & Review

**Goal:** the user describes a task and gets a structured plan they can edit.

### Router (MVP: single provider)
- [ ] Per-phase model selection (`plan`, `execute`), defaulting by tier from `listModels()`: Flash for Plan, the cheapest Flash-tier model for Execute.
- [ ] Retry with exponential backoff on 429/5xx (max 3), then `Failed` with retry/switch-model actions.
- [ ] Token estimate before each request; per-request and per-session budget limits with a confirmation dialog.
- [ ] Usage ledger in IndexedDB (from `usageMetadata`); session cost shown in the AI panel, using a small editable price table in settings.

### Workflow
- [ ] Workflow reducer and state machine (ARCHITECTURE.md §5.7); runs saved to the `runs` store and resumable.
- [ ] `context.ts`: selected/open files, tree summary, optional `.daedalus/context.md`; context size indicator.
- [ ] `plan.ts`: system prompt, `Plan` Zod schema, extraction of the fenced JSON, one automatic repair request.
- [ ] AI panel: task input, streaming plan view, cancel.
- [ ] Plan reviewer: editable checklist (edit/reorder/delete steps, add notes); **Approve / Revise / Reject**.

**Done when:** for a sample repo, a task such as "add a dark-mode toggle" produces a valid plan from Gemini Flash. The user can edit it, and "Revise" sends their feedback.

---

## M5: Execute, Diff Review & Apply

**Goal:** approved plans become reviewed changes in the workspace.

- [ ] `execute.ts`: one request per step, sending only the files that step touches.
- [ ] Patch format: full-file blocks for creates and small files; search/replace blocks for edits. Strict parser; each search block must match exactly once.
- [ ] Progress per step (pending/streaming/done/failed); retry or regenerate a single step.
- [ ] Diff viewer with `@codemirror/merge`: unified/split toggle; accept/reject per hunk and per file. Styled with the `diff-add`/`diff-remove` tokens.
- [ ] `apply.ts` + `WorkspaceFS.applyPatchSet`: snapshot, then apply all, with rollback on failure.
- [ ] **Undo last AI change** from snapshot; refresh open buffers after apply.
- [ ] Detect conflicts if the user edited a file between Execute and Apply (compare content hashes) and ask for re-execution.

**Done when:** the end-to-end Playwright test (with a mocked provider) goes task → plan → approve → execute → accept some hunks → apply → undo, and file contents match expectations at every step. The same flow also succeeds once by hand against real Gemini.

---

## M6: UX Polish

Can run alongside M3–M5.

- [ ] Focus mode (dim everything except the current line/paragraph/block); typewriter scrolling.
- [ ] Chrome auto-hide: while typing, sidebar/header/status fade to `opacity-0` over 300 ms and return on pointer movement or keyboard focus; instant under `prefers-reduced-motion`.
- [ ] Finalize design tokens: define dark-mode `diff-add`/`diff-remove` colors and the dark prose secondary shade; audit `muted` contrast in both themes (WCAG AA) and adjust.
- [ ] Glass surfaces on the AI panel, model drawer and status chips; verify contrast on blended backgrounds.
- [ ] Typography settings: font size, line height, and a user-set line width. The default width is responsive and a full-width toggle ships (M6b Phase 1), so only the user setting is open.
- [ ] Keyboard-first: every action in the palette; shortcuts reference sheet (`?`).
- [ ] Minimal status line (file, dirty flag, phase, session cost) that fades when idle.
- [ ] Accessibility: focus outlines, ARIA on overlays/dialogs, `prefers-reduced-motion`, contrast checks for the monochrome themes.
- [ ] First-run onboarding: create vault → add Gemini key (with a link to Google AI Studio) → sample workspace.

---

## M6b: iA Writer Workspace Redesign

**Goal:** Implement the layout, token, and interaction spec in ARCHITECTURE.md §5.8: a 3-column shell with a 72ch editor column, a worktree sidebar, a borderless tab bar, a status line, and focus-mode chrome fading. The spec was received 2026-11-03; each conflict with earlier sections is resolved in §5.8 ("Conflict resolutions").

**Dependencies:** Phase 1 needs only M1. Phases 2 and 3 need the M2 workspace code (file tree, buffers), committed in `79ad171`. Phase 4 can run after Phase 1.

### Phase 1: Tokens, typography, shell (M1 only)
- [x] Tokens in `src/styles/tokens.css` set to the §5.8 table (light and dark). Names stay `--canvas`, `--surface`, etc., mapped to `--color-*` through `@theme`.
- [x] Contrast test (`src/styles/tokens.test.ts`): text, muted, accent and diff foregrounds meet AA (accent 3:1) in both themes; token parity; no raw hex in `src/**/*.tsx`.
- [x] Typography: editor 14 px, line height 1.65; UI 13 px; status 11 px mono (`--text-*` in `index.css`).
- [x] Shell layout: sidebar `w-sidebar` (240 px, replaces `w-64`); header `h-header` (40 px, replaces `h-12`); tabs sit in the header; header has no border on hover or focus.
- [x] Editor column: `padding: 3rem 2rem` (`py-12 px-8`) in `theme.ts` (replaces `12vh` / `40vh`). Width and gutters now come from breakpoints in `index.css`: 100% on phones, then 80ch, 100ch, 130ch and 160ch from 640 px to 2560 px. This replaces the fixed `max-w-[72ch]`.
- [x] Full-width toggle: header button and `View: Toggle Full Width` in the palette. Drops the measure and keeps the gutters. The choice is saved in localStorage.
- [x] Gutter: `lineNumbers()` in `createEditor.ts`, styled `muted` at 70% opacity. Hiding it in focus mode is part of Phase 4.
- [x] Active line: `surface` at 50% fill (`.cm-activeLine`), replacing the transparent value in `theme.ts`.

**Status (2026-11-03):** implemented. Typecheck, ESLint, Prettier, unit tests and `vite build` pass. Not yet checked: a visual review in light and dark, because Chromium crashes in the Termux dev environment (see M1). Do this in CI or by hand before marking the milestone done. The gutter sits at the scroller's left edge, so on wide windows it is still far from the text. Revisit in Phase 4.

### Phase 2: Worktree sidebar (needs M2)
- [x] M2 workspace code is committed in `79ad171` (see M2 status).
- [x] Sidebar is the worktree only. The workspace switcher, workspace options, and archive (zip) options were removed on 2026-11-03 at the user's request. Workspace switching is done from the workspace opener, and zip import is a drop onto the opener.
- [x] New files and folders are created from the tree's right-click menu (or the command palette: `File: New File` / `File: New Folder`, then pick a folder and name it). The header has no New file / New folder buttons.
- [x] Write-back: a folder picked with the File System Access API is linked (readwrite). Saves, creates, renames and deletes are mirrored to it; the app copy is authoritative. If access lapses, the sidebar shows Reconnect, which rewrites the workspace to the folder (nothing is deleted on disk). External edits to the folder are not pulled in. Zip and webkitdirectory imports are not linked.
- [x] Tree toolbar: Expand all and Collapse all folders. Row actions (rename, delete) and the sidebar toggle are `IconButton`s.
- [x] Right-click menu (`ui/ContextMenu.tsx`, also Shift+F10 on a focused row): on a folder, New file / New folder inside it; on a file, the same in its folder; on empty space, at the root.
- [x] Shared `Button` and `IconButton` (`src/ui/Button.tsx`), used for all action buttons, including quiet and compact variants. Covered by `src/ui/Button.test.tsx`.
- [x] Workspace opener describes the selected workspace and offers a direct action to show its file tree when no file is open.
- [ ] Tree rows: 28 px high, 13 px `font-normal`, `truncate`; 12 px indent per level; guide lines 1 px `line` at 40% opacity.
- [ ] Directory chevron rotates 90° over 150 ms. File icons are omitted by default.
- [ ] Active row: `bg-accent/10` and `font-medium`. Modified file: 5 px `accent` dot at the far right.
- [ ] Keyboard (only when the tree has focus): Up/Down move focus; Right expands a folder or opens a file; Left collapses a folder or moves to the parent; Enter opens in the active tab; `A` creates a file in the cursor folder; `Shift+A` creates a folder; `F2` renames.
- [x] Storage footer: removed with the sidebar cleanup. Storage details stay in Settings.
- [ ] Compact sidebar option (200 px) in settings.

### Phase 3: Tab bar (needs M2 buffers)
Spec: the "Minimalist Tab Architecture" PRD (received 2026-11-03; not stored in the repo). Pure rules live in `src/state/tabOps.ts`.
- [x] Transparent, borderless strip in the header; auto-width labels scroll horizontally with the scrollbar hidden. 24 px row height.
- [x] Active tab: full-opacity text with a 1.5 px accent underline; unsaved files show a 4 px accent dot.
- [x] Inactive tabs: `muted` text at 50% opacity, 80% on hover, 150 ms ease-out (per the tab-bar spec).
- [x] Minimal close icon on every tab; visible on the active tab and revealed on hover/focus. Close is also available via middle-click, the context menu, the palette, or `Mod-Alt-W`.
- [x] Context menu (right-click, Shift+F10): Close, Close Others, Close to Right, Close All, Pin/Unpin, Copy Relative Path. Shares the glass surface with the command palette. Pinned tabs survive Close Others and Close All.
- [x] Drag to reorder (native DnD, 2 px accent insert marker, 150 ms FLIP). Pinned and unpinned groups stay separate. Keyboard reorder via palette "Tab: Move Left/Right".
- [x] Horizontal overflow via wheel and trackpad, with a hidden scrollbar. Active tab is scrolled into view.
- [x] `Ctrl-S` / `Mod-S` saves the active file; the dirty dot remains visible until the save completes.
- [ ] Pinned state persistence and drag-over-drop visual checks in a real browser (covered by jsdom tests only).

### Phase 4: Status line, focus mode, palette
- [ ] Status line: one 11 px mono line at the bottom left: file path, encoding, `line:col`, and session token cost (shows `$0.00` until the M4 ledger exists). Fades to 30% opacity while typing.
- [ ] Focus-mode chrome: while typing, tabs, status line, and sidebar fade to `opacity-0` over 300 ms. They return on pointer movement, on `Esc`, or when keyboard focus enters chrome. `Mod-K` opens the palette and does not restore chrome. Instant under `prefers-reduced-motion`. This completes the chrome part of M6 focus mode.
- [ ] Hover transitions (icons, tabs, sidebar triggers): 150 ms ease-out.
- [x] Command palette: glass panel with a centered input, shared with the tab context menu; editor dimmed beneath (`canvas` at 60%).

### Phase 5: Verification
- [ ] Unit: tree keyboard map (including `A`, `Shift+A`, `F2` scoped to tree focus), tab close and width rules, focus-mode state transitions.
- [ ] Playwright screenshots in light and dark at 1280 px, 1920 px and 390 px. Check the editor column follows the breakpoint measure, and fills the pane when full width is on.
- [ ] Reduced-motion: focus-mode transitions are instant.

**Open decisions** (provisional defaults are in §5.8; confirm or change):
1. Gutter line numbers visible by default (spec) vs. "no visible chrome" (earlier §5.8 text). Default: visible, faint.
2. Close-tab shortcut: `Mod-W` is browser-reserved. Default: `Mod-Alt-W`.
3. Editor font: IBM Plex Mono (bundled) vs. the spec's JetBrains Mono or Fira Code. Default: IBM Plex Mono.
4. Base font size: 14 px (spec) vs. 15 px default (spec alternative). Default: 14 px.

**Done when:** Phases 1–5 are checked, and the screenshots show the layout in both themes with the status line and focus mode working.

---

## M7: Hardening & MVP Release (`v0.1.0`)

- [ ] Security review: CSP has no violations, no `innerHTML` of model output, keys never appear in logs or URLs, dependency audit is clean.
- [ ] Cross-browser test matrix (Chrome, Edge, Firefox, Safari), including the OPFS fallback path.
- [ ] Performance budget: initial JS ≤ 250 KB gzip, editor interactive in < 1 s on mid-range hardware, streaming without dropped frames.
- [ ] README, ARCHITECTURE, and in-app help finalized; tag `v0.1.0`.

**Done when:** a new user can open the hosted app in any supported browser, add a Gemini key, and complete a Plan → Review → Execute → Apply run on an imported project.

---

## M8: Direct Providers (post-MVP)

Providers that accept browser requests directly, so no backend is needed.

- [ ] `anthropic.ts`: Messages API streaming; `anthropic-dangerous-direct-browser-access` header; usage extraction. Add `https://api.anthropic.com` to `connect-src`.
- [ ] `ollama.ts`: `/api/chat` NDJSON streaming (shared NDJSON parser); `/api/tags` for the model list; CORS/connection error detection with `OLLAMA_ORIGINS` setup help. Add `http://localhost:11434` to `connect-src`. Document that it doesn't work in Safari.
- [ ] Router: cross-provider fallback chains, asking before switching to a paid provider. Restore the PRD's cost split: Execute on local Ollama (`qwen2.5-coder`) at $0.
- [ ] Optional PWA (service worker + manifest) for offline use with local Ollama.

**Done when:** the M4/M5 acceptance flow passes with Anthropic and with local Ollama, and fallback from an unreachable Ollama to Gemini works after the user confirms.

---

## M9: LLM Proxy + Ollama Cloud + OpenCode (post-MVP)

For providers that block browser requests (ARCHITECTURE.md §5.5.1). This is the only server-side code in Daedalus.

- [ ] Re-check browser access first: if Ollama Cloud or OpenCode has started allowing browser requests, use it directly and skip the proxy for that provider.
- [ ] `netlify/edge-functions/llm-proxy.ts` at `/api/llm/:provider/*`: fixed upstream list (`ollama-cloud`, `opencode`), method/path allowlist, header allowlist (`Authorization`, `Content-Type`), unmodified response streaming, body size cap.
- [ ] Same-origin enforcement (`Origin` / `Sec-Fetch-Site`) and a Netlify rate-limit rule.
- [ ] No logging of headers or bodies; security headers set in the function.
- [ ] Ollama Cloud: reuse `ollama.ts` with base URL `/api/llm/ollama-cloud`.
- [ ] OpenCode: `openai-compat.ts` (OpenAI chat-completions SSE) with base URL `/api/llm/opencode`. The model list can be fetched directly from `opencode.ai/inference/v1/models`, which allows browser requests; add it to `connect-src` if used.
- [ ] UI: mark proxied providers "via Daedalus proxy" and explain that the key passes through the function.
- [ ] Tests: proxy rejects unknown providers/paths/origins; streams pass through unchanged; no key in function logs.

**Done when:** the M4/M5 acceptance flow passes with an Ollama Cloud key and with an OpenCode key, and Netlify usage for 1,000 test calls matches the estimated cost.

---

## Testing Strategy

| Layer | Tooling | Focus |
| --- | --- | --- |
| Unit | Vitest | crypto round-trip, stream parsers, plan/patch parsers, router decisions, reducer transitions |
| FS | Vitest + browser mode | OPFS worker and IDB fallback both pass the shared `WorkspaceFS` contract suite |
| Component | Testing Library | plan reviewer, diff accept/reject, vault modal |
| Design system | Vitest + Playwright | token parity between light/dark, no raw hex in components (lint/grep check), contrast check of token pairs, reduced-motion behavior |
| E2E | Playwright | full workflow with a mocked provider; import/export; reload resumes a run |
| Proxy (M9) | Netlify CLI + Vitest | allowlists, origin checks, streaming pass-through |

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Single provider in the MVP: a Gemini outage, rate limit, or API change blocks all AI features | Retry with backoff; clear error states; editor and workspace keep working without AI; M8 adds fallback providers. |
| Providers change CORS policy or browser-access headers | Adapter layer isolates the change; connection test surfaces failures clearly; CORS checks are re-run before M8/M9. |
| Cheap/small models produce malformed patches | Strict format, exact-match validation, per-step retry, human diff review. |
| Local Ollama unreachable from HTTPS origin (Safari, local network access prompts) (M8) | Detect and explain; offer cloud fallback after confirmation. |
| Proxy abuse burns Netlify credits (M9) | Same-origin check, rate limits, fixed upstream list, body size cap, credit alerts. |
| OPFS data loss (storage eviction) | Request persistent storage; prominent export; warn when not persisted. |
| Spec colors fail contrast (`muted` text, glass panels) or leave dark diff colors undefined | Automated contrast check in M6; tokens are centralized, so fixes are one-line changes. |
| XSS exposing unlocked keys | Strict CSP, no raw HTML rendering, minimal dependencies, auto-lock. |
| Runaway API cost | Cheap Flash-tier defaults, pre-request estimates, hard budget caps. |
