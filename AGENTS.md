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
