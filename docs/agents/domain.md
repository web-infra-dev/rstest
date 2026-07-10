# Domain docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CLAUDE.md`** at the repo root — monorepo structure, commands, workflow, and code style.
- **Per-package `AGENTS.md`** — each package under `packages/*` may carry its own `AGENTS.md` with package-specific guidelines; read the one for the package you're about to touch (see the root `CLAUDE.md` for the list).
- **`CONTEXT.md`** at the repo root and **`docs/adr/`** — if they don't exist, proceed silently. Don't flag their absence; don't suggest creating them upfront.

## Use the repo's vocabulary

When your output names a domain concept (in an issue title, a triage note, an agent brief, a test name), use the terms already used by the codebase and docs (e.g. pool, runner, reporter, snippet, coverage provider, browser mode). Don't invent synonyms.

## Flag conflicts

If your output contradicts documented guidance (root `CLAUDE.md`, a package `AGENTS.md`, or an ADR), surface it explicitly rather than silently overriding.
