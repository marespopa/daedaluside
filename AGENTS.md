# Agent Instructions

## Testing

- Use `@testing-library/user-event` for keyboard and pointer interactions.
- Only fall back to `fireEvent` for events that `user-event` cannot model, such as `contextMenu`.
- Keep DOM/event patches in `src/test-setup.ts` when the test environment omits browser behavior the code relies on (e.g., `keyCode` for Enter).
