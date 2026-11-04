# Agent Instructions

## Testing

- Use `@testing-library/user-event` for keyboard and pointer interactions.
- Only fall back to `fireEvent` for events that `user-event` cannot model, such as `contextMenu`.
- Keep DOM/event patches in `src/test-setup.ts` when the test environment omits browser behavior the code relies on (e.g., `keyCode` for Enter).

## Delegation

- Delegate every repository search and every test run to the `search`, `grep`, and `audit` subagents instead of searching or running tests in the main session, to keep the main context small.
- Subagents run on Anthropic models, configured in `.opencode/agents/*.md`:

  | Agent    | Model                                  | Role                                          |
  | -------- | -------------------------------------- | --------------------------------------------- |
  | `search` | Sonnet 5.5 (`anthropic/claude-sonnet-5-5`) | Maps layout, modules, and conventions         |
  | `grep`   | Haiku 5.5 (`anthropic/claude-haiku-5-5`)   | Fast call-site and usage lookups              |
  | `audit`  | Opus 5.5 (`anthropic/claude-opus-5-5`)     | Reviews diffs; runs lint, typecheck, and tests |

- Use the cheapest capable model for exploration. Repository searches, file lookups, and layout surveys go to Haiku 5.5 (`grep`), or Sonnet 5.5 (`search`) when the question needs synthesis. Reserve Opus for `audit` (diff review, lint, typecheck, tests).
- In Claude Code these agents live in `.claude/agents/*.md` (see `CLAUDE.md`); use them by name and never substitute a generic agent such as `Explore`. Where one must be used, set its model to `haiku` (or `sonnet` for synthesis) explicitly.
- Claude Code loads `.claude/agents/*.md` at session start. After adding or editing an agent file, restart the session (or open `/agents`) before delegating; until then `Agent` reports `Agent type '<name>' not found`.
- Fallback while an agent is not loaded: use `general-purpose` with the model the table assigns (`haiku` for `grep`, `sonnet` for `search`, `opus` for `audit`) and paste the agent's role from `.claude/agents/<name>.md` into the prompt. Tell the user which fallback was used.
- Keep `.claude/agents/*.md` and `.opencode/agents/*.md` in sync; the agent names and models in the table above are the source of truth.
