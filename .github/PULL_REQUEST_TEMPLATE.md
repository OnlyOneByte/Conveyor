## Summary

<!-- What changes, in one or two sentences. -->

## Why

<!-- The problem this solves or the issue it closes (e.g. "Closes #12"). -->

## How tested

<!-- Commands you ran and what you checked by hand. -->

- [ ] `bun run check` (Biome lint + format + import order)
- [ ] `bun run typecheck` and `svelte-check` in `packages/web`
- [ ] `bun test`
- [ ] `bun run check:comments`

## Screenshots / GIF

**Required for any UI change.** Show before and after. Use a GIF or video for animations, transitions or multi-step flows. Write "No UI change" if this PR does not touch the UI.

| Before | After |
| ------ | ----- |
|        |       |

## Checklist

- [ ] No comments added to code (the `no-comments` ratchet must not go up; docs live in `docs/`)
- [ ] Docs updated in `docs/` where behaviour, config or setup changed
- [ ] Conventional-commit PR title (`feat:`, `fix:`, `chore:`, ...)
- [ ] Screenshots / GIF attached for UI changes
