# Agent Instructions

## UX

- Always respond instantly to user actions. A click, key press or double-click must change the UI in the same frame: open the tab, move the selection, or show a busy state. Never leave the screen unchanged while work runs.
- Do not block a response on slow work (a full tree walk, a worker, a network or disk read) when a cheap check or the data already loaded can answer. Prefer loaded state first, then a direct lookup, and show progress for anything left.

## Motion

- Every surface that appears gets a short entrance, so the UI feels responsive and never snaps. Use the shared classes in `src/index.css`: `anim-fade` (backdrops, tabs, pages, a file coming into view) and `anim-pop` (dialogs, the command palette, dropdown lists, menus; `GlassPopover` already applies it).
- Buttons use the shared `Button`, which gives hover/press feedback (`active:scale`). Do not write one-off transitions or keyframes in feature code.
- Keep it subtle: 140-160ms, ease-out, opacity plus a few pixels of movement. Motion must never delay input or a state change.
- All motion must be off under `prefers-reduced-motion` (the shared classes already do this; use `motion-safe:` for anything else).

## Color

- Follow WCAG 2.2 AA for every color. Text needs 4.5:1 (3:1 for large text), and meaningful UI parts such as control borders and icons need 3:1. Disabled controls are exempt.
- Never use color alone to show state (selected, pinned, current, error). Pair it with a shape, icon, weight or text.
- Add new text/background pairs to `src/styles/tokens.test.ts`.

## Testing

- Use `@testing-library/user-event` for keyboard and pointer interactions.
- Only fall back to `fireEvent` for events that `user-event` cannot model, such as `contextMenu`.
- Keep DOM/event patches in `src/test-setup.ts` when the test environment omits browser behavior the code relies on (e.g., `keyCode` for Enter).

## Delegation

- Delegate repository searches to the `search` and `grep` subagents instead of searching in the main session, to keep the main context small.
- Run lint, typecheck, and tests directly in the main session against the working checkout (`npm run lint`, `npm run typecheck`, `npx vitest run`, or a single file). That tests exactly what will be committed, and a worktree copy goes stale as soon as the code changes.
- Reserve `audit` for a deliberate review of a large or risky diff, where an isolated worktree is useful for temporary repro tests. It is slow (often many minutes), so do not use it as the routine test runner, and re-run checks directly after any edit made while it was running.
- Subagents run on Anthropic models, configured in `.opencode/agents/*.md`:

  | Agent    | Model                                  | Role                                          |
  | -------- | -------------------------------------- | --------------------------------------------- |
  | `search` | Sonnet 5.5 (`anthropic/claude-sonnet-5-5`) | Maps layout, modules, and conventions         |
  | `grep`   | Haiku 5.5 (`anthropic/claude-haiku-5-5`)   | Fast call-site and usage lookups              |
  | `audit`  | Opus 5.5 (`anthropic/claude-opus-5-5`)     | Reviews diffs in a worktree; repro tests       |

- Use the cheapest capable model for exploration. Repository searches, file lookups, and layout surveys go to Haiku 5.5 (`grep`), or Sonnet 5.5 (`search`) when the question needs synthesis. Reserve Opus for `audit` (isolated diff review and repro tests).
- In Claude Code these agents live in `.claude/agents/*.md` (see `CLAUDE.md`); use them by name and never substitute a generic agent such as `Explore`. Where one must be used, set its model to `haiku` (or `sonnet` for synthesis) explicitly.
- Claude Code loads `.claude/agents/*.md` at session start. After adding or editing an agent file, restart the session (or open `/agents`) before delegating; until then `Agent` reports `Agent type '<name>' not found`.
- Fallback while an agent is not loaded: use `general-purpose` with the model the table assigns (`haiku` for `grep`, `sonnet` for `search`, `opus` for `audit`) and paste the agent's role from `.claude/agents/<name>.md` into the prompt. Tell the user which fallback was used.
- Keep `.claude/agents/*.md` and `.opencode/agents/*.md` in sync; the agent names and models in the table above are the source of truth.
