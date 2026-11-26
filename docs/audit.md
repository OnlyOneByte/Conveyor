# Doc audit

Code has no comments, so stale docs are the main way knowledge rots here. The audit catches drift between
`docs/`, `AGENTS.md` and the code.

## When

Every **10 merged PRs** or every **Monday**, whichever comes first. Count the PRs merged since the last
report:

```bash
gh pr list --state merged --search "merged:>=<last-report-date>" --limit 100 --json number --jq length
```

Once a month, the audit also includes a full read of every page for accuracy, not just the mechanical checks.

## Checklist

Work from a fresh `origin/main`. Every item is checked or written down as a finding.

1. **Index.** Every file under `docs/` is linked from [README.md](README.md), and every link there resolves.
2. **Links.** Every relative link in `AGENTS.md`, `README.md`, `SPEC.md` and `docs/**` resolves to a file.
3. **Symbols and paths.** Every backticked path exists (`git ls-files`), and every backticked exported
   symbol is still exported (`git grep -n "export .*<symbol>"`).
4. **Architecture.** [architecture.md](architecture.md) matches the code: services in `docker-compose.yml`,
   packages and their imports, routes in `packages/api/src/routes/`, job states in `packages/shared/src/job.ts`.
5. **Env and config.** Every environment variable the code reads is documented, and every documented
   variable is still read. The grep catches `process.env.X`, `Bun.env.X`, an injected `env.X` and `env["X"]`:
   `git grep -ohE '\benv(\.|\[")[A-Z_]+' -- packages plugins scripts tools | sort -u`. It misses a name passed in
   as a string, such as `positiveSetting("MOONRAKER_STATUS_TIMEOUT_MS", …)`, so also run
   `git grep -ohE '"(CONVEYOR|MOONRAKER|ELEGOO|PRINTER|ORCA|PRUSA|OPENSCAD)_[A-Z_]+"' -- packages plugins | sort -u`.
6. **Rules vs CI.** The check table in `AGENTS.md` matches the job names in `.github/workflows/ci.yml`, and
   each `[CI]` tag points at a check that really enforces it. A `[review]` rule that is now enforced becomes
   `[CI]`.
7. **Rules vs rubric.** `AGENTS.md` limits and conventions agree with [review-rubric.md](review-rubric.md), and that page is still a verbatim copy of the reviewer kit's `RUBRIC.md`.
8. **ADRs.** Every merged decision with alternatives since the last audit (new dependency, pattern or major
   upgrade) has an ADR, and superseded ADRs say so in their status line.
9. **Modules.** Every package under `packages/` has a `docs/modules/<package>.md`, `plugins/` has
   `docs/modules/plugins.md`, and prose moved out of code comments landed there.
10. **Length.** `AGENTS.md` stays under about 300 lines; anything longer moves to a linked page.

## Output

1. Write `docs/audits/YYYY-MM-DD.md` with `Audited at: <sha>`, each checklist item as `ok` or its findings,
   and the PRs covered.
2. Fix what is mechanical (a dead link, a renamed path, a missing env var) in one `docs:` PR with the report,
   labelled `agent` and `area/infra`.
3. File an issue for each finding that needs a code change or a decision, and link it from the report.
