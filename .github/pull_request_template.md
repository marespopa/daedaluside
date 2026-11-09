## Summary

<!-- What changed and why. Link the issue: Closes #123 -->

## Test plan

<!-- How you verified it: tests added, manual steps on the Netlify deploy preview. -->

## Checklist

- [ ] UI responds in the same frame as the action (no unchanged screen while work runs)
- [ ] New surfaces use `anim-fade` / `anim-pop`; no one-off transitions or keyframes
- [ ] Colors meet WCAG 2.2 AA, state is not shown by color alone, new pairs added to `src/styles/tokens.test.ts`
- [ ] Interaction tests use `@testing-library/user-event`
- [ ] New provider host added to CSP `connect-src` in `netlify.toml` (if applicable)
- [ ] Checked the Netlify deploy preview
