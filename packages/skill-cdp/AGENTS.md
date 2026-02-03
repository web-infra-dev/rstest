## @rstest/cdp (agent-invoked CLI)

This package ships a CDP debug CLI designed for AI agents.
Treat it as a portable artifact: deterministic, easy to invoke via `npx`, minimal surface area.

How it is used:

- External agent generates a Plan JSON and calls: `npx @rstest/cdp --plan <path|->`
- This repo focuses on keeping the CLI contract stable; the skill runbook lives elsewhere

Skill definition (external):

- https://github.com/rstackjs/agent-skills (skills/rstest-cdp)

## Project structure (start here)

- Entrypoint: `packages/skill-cdp/src/cli.ts`
- CLI orchestration + output writing: `packages/skill-cdp/src/index.ts`
- Plan parsing/validation + runner args normalization: `packages/skill-cdp/src/plan.ts`
- CDP session + sourcemap mapping + breakpoint resolution: `packages/skill-cdp/src/session.ts`
- Generated plan JSON Schema (do not edit): `packages/skill-cdp/schema/plan.schema.json`
- Schema generator: `packages/skill-cdp/scripts/genPlanSchema.mts`

## Output contract (do not break)

- stdout: a single JSON `DebugResult` (machine-readable)
  - Core fields: `ok`, `results`, `errors` (always present)
  - `meta` field: diagnostic info, only included with `--debug` flag
- stderr: runner output + optional debug logs (`--debug`)
- stable ordering, explicit timeouts, no randomness

## Do

- Keep diffs small and localized to `packages/skill-cdp/`.
- Prefer file-scoped commands for fast feedback.
- Treat input from files / CDP / subprocess as `unknown`, then validate/narrow.
- Keep the CLI deterministic (timeouts explicit, stable ordering).
- Rebuild after changes; do not edit `dist/*` by hand.

## Don't

- Don't print non-JSON to stdout (breaks callers).
- Don't add heavy dependencies without approval.
- Don't do repo-wide rewrites unless explicitly requested.

## Commands (development)

File-scoped checks preferred.

```bash
# Typecheck
pnpm --filter @rstest/cdp typecheck

# Build (bundle output in dist/)
pnpm --filter @rstest/cdp build

# Watch build
pnpm --filter @rstest/cdp dev

# Regenerate plan JSON schema (committed artifact)
pnpm --filter @rstest/cdp gen:schema

# Lint / format (file-scoped)
pnpm biome check --write 'packages/skill-cdp/src/index.ts'
pnpm prettier --write 'packages/skill-cdp/src/index.ts'
```

## Tests

This package relies on workspace E2E tests.

```bash
# Run a single E2E test (recommended)
pnpm rstest 'e2e/cdp/index.test.ts'

# Full suites (slower)
pnpm test
pnpm e2e
```

If CLI flags or JSON output shape change, update `e2e/cdp/index.test.ts`.

## Running the CLI locally

```bash
pnpm --filter @rstest/cdp build

# Plan from file
npx @rstest/cdp --plan '/abs/path/to/plan.json'

# Plan from stdin
npx @rstest/cdp --plan -
```

Or directly:

```bash
node 'packages/skill-cdp/dist/rstest-cdp.cjs' --plan '/abs/path/to/plan.json'
```

## Safety / permissions

Allowed without asking:

- Read/list files
- Run: `pnpm --filter @rstest/cdp build|dev|typecheck|gen:schema`
- Run: `pnpm rstest 'e2e/cdp/index.test.ts'`
- Run format/lint on specific files

Ask first:

- Adding/removing dependencies
- Running full workspace builds if not necessary
- Deleting files / changing permissions / running network-heavy tasks
- Git push / publishing

## Pre-PR checklist

```bash
pnpm biome check --write 'packages/skill-cdp/src/index.ts'
pnpm --filter @rstest/cdp typecheck
pnpm rstest 'e2e/cdp/index.test.ts'
pnpm --filter @rstest/cdp build
```

## When stuck

- Propose a short plan and ask 1 targeted question.
- Prefer minimal, reversible changes over speculative refactors.
