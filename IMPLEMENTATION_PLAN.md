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
- [x] Apply the design system (§5.8): CodeMirror theme driven by CSS variables; 2 px accent cursor and accent selection tint; editor column `max-w-[72ch]`, `leading-relaxed`; app shell layout (collapsible translucent sidebar, 48 px header with transparent border until hover, breadcrumb); command palette as a glass panel.
- [x] `src/ui/` primitives: `Panel`, `GlassPopover`, `Chip`, `IconButton`, `Kbd`, with an opaque fallback when `backdrop-filter` is unsupported.

**Status:** all items are implemented, including the design system shell and `src/ui/` primitives. Typecheck, lint, Prettier, unit tests and build pass. The Playwright smoke test (CSP + palette) has not yet passed because Chromium crashes in the Termux dev environment; run it in CI. Known: main bundle is 624 kB (200 kB gzip), over the M7 budget of 250 KB gzip; revisit in M7.

**Done when:** the user can open the app, type code with highlighting, switch themes, and use the palette, with no visible chrome.

---

## M2: OPFS Workspace

**Goal:** persistent, multi-file workspaces stored on the device.

- [ ] `fs.worker.ts`: OPFS operations using `createSyncAccessHandle` (list/read/write/remove/rename/mkdir).
- [ ] Typed RPC client (`fs.ts`), using Comlink or a small hand-written wrapper.
- [ ] Atomic writes (temp file + replace).
- [ ] `fallback-idb.ts` implementing the same `WorkspaceFS` interface; capability detection at startup.
- [ ] Workspace manager: create, rename, delete, switch. Metadata in IndexedDB.
- [ ] File tree overlay (toggle with `Mod-B`): create, rename, delete, open.
- [ ] Multiple open buffers, dirty tracking, autosave (debounced) + `Mod-S`.
- [ ] Import from folder or `.zip` (`fflate`); export to `.zip`.
- [ ] Call `navigator.storage.persist()` and show quota usage in settings.

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
- [ ] Typography settings: font size, line height, line width (default `72ch`).
- [ ] Keyboard-first: every action in the palette; shortcuts reference sheet (`?`).
- [ ] Minimal status line (file, dirty flag, phase, session cost) that fades when idle.
- [ ] Accessibility: focus outlines, ARIA on overlays/dialogs, `prefers-reduced-motion`, contrast checks for the monochrome themes.
- [ ] First-run onboarding: create vault → add Gemini key (with a link to Google AI Studio) → sample workspace.

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
