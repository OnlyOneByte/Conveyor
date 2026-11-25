## What

<!-- What changes, in one or two sentences. -->

## Why

<!-- The problem this solves. -->

Closes #

<!-- One line per issue. Use "Part of #N" when the issue stays open after this PR. -->

## How verified

<!-- Commands you ran and what you checked by hand. -->

- [ ] `bun run lint` and `bun run format:check`
- [ ] `bun run typecheck` and `svelte-check` in `packages/web`
- [ ] `bun test`
- [ ] `bun run check:comments`

## Visuals

**Required for any UI change.** Show before and after. Use a GIF or video for animations, transitions or multi-step flows. Write "No UI change" if this PR does not touch the UI.

Provenance: <!-- the commit SHA the captures were taken from -->

| Before | After |
| ------ | ----- |
|        |       |

## Risk and rollback

<!-- What could break, and how to undo it (revert, flag, migration). -->

## Docs touched

<!-- Files under docs/ changed by this PR, or "None" with a reason. -->

## Checklist

- [ ] No comments or suppressions in code (`no-comments` runs `--strict`: one anywhere fails it)
- [ ] Docs updated in `docs/` where behaviour, config or setup changed
- [ ] Conventional-commit PR title (`feat:`, `fix:`, `chore:`, ...)
- [ ] Visuals attached for UI changes
