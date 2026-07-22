# Rstest monorepo

Rstest is an Rsbuild-based testing framework for JavaScript/TypeScript projects.

## Sub-package Instructions

When working on code in a specific package, read that package's `AGENTS.md` file for package-specific guidelines:

- For @rstest/core: `packages/core/AGENTS.md`
- For @rstest/browser: `packages/browser/AGENTS.md`
- For @rstest/browser-ui: `packages/browser-ui/AGENTS.md`
- For @rstest/browser-react: `packages/browser-react/AGENTS.md`
- For @rstest/playwright: `packages/playwright/AGENTS.md`
- For @rstest/coverage-istanbul: `packages/coverage-istanbul/AGENTS.md`
- For @rstest/adapter-rslib: `packages/adapter-rslib/AGENTS.md`
- For @rstest/adapter-rsbuild: `packages/adapter-rsbuild/AGENTS.md`
- For @rstest/adapter-rspack: `packages/adapter-rspack/AGENTS.md`
- For rstest VS Code extension: `packages/vscode/AGENTS.md`
- For documentation site: `website/AGENTS.md`

If a package does not have its own `AGENTS.md`, follow this root file and copy the closest local patterns.

A new `AGENTS.md` needs a sibling `CLAUDE.md` symlink (`ln -s AGENTS.md CLAUDE.md`). `pnpm check-harness-docs` enforces that, plus the command, path, and dependency claims written inside `AGENTS.md`/`SKILL.md` files.

**Altitude rule**: an `AGENTS.md` documents only what cannot be read from the code — data flow across boundaries, invariants, coupling points ("change A → also change B"), and historical pitfalls. Every line must either constrain future changes or record a decision/pitfall the code cannot express; do not describe what the code plainly shows. If a fact cannot be verified against the code, delete it rather than qualify it. No per-file inventories and no `file:line` references (the checker validates paths but not line numbers, so line references are undetectable drift); refer to symbols instead.

## Monorepo structure

- `packages/core/` — @rstest/core: core testing framework (CLI, runtime, reporter, pool)
- `packages/browser/` — @rstest/browser: browser mode support (Playwright, WebSocket RPC)
- `packages/browser-ui/` — @rstest/browser-ui: prebuilt browser container UI (React + Tailwind + Ant Design)
- `packages/browser-react/` — @rstest/browser-react: React component testing utilities for browser mode
- `packages/playwright/` — @rstest/playwright: Node-side Playwright browser automation fixtures
- `packages/coverage-istanbul/` — @rstest/coverage-istanbul: Istanbul coverage provider
- `packages/coverage-v8/` — @rstest/coverage-v8: V8 coverage provider
- `packages/adapter-rslib/` — @rstest/adapter-rslib: Rslib configuration adapter
- `packages/adapter-rsbuild/` — @rstest/adapter-rsbuild: Rsbuild configuration adapter
- `packages/adapter-rspack/` — @rstest/adapter-rspack: Rspack configuration adapter
- `packages/vscode/` — rstest: VS Code extension
- `benchmarks/` — benchmark projects and runners
- `e2e/` — end-to-end integration tests
- `examples/` — example projects (node, react, browser)
- `website/` — documentation site (Rspress)
- `scripts/` — build scripts and shared configs

## Package manager and workspace

- Use `pnpm` (the version is pinned via the `packageManager` field in the root `package.json`).
- The workspace includes `benchmarks`, `website`, `scripts/**`, `packages/**`, `examples/**`, and `e2e/**`.
- Dependency installs use pnpm's stricter settings (`minimumReleaseAge`, `strictDepBuilds`, and explicit build-script approvals). Do not loosen these settings or add heavy dependencies without discussion.

## Commands

```bash
# Root commands
pnpm install                  # Install all workspace dependencies
pnpm build                    # Build all packages under packages/*
pnpm test                     # Run unit tests via rstest
pnpm e2e                      # Run e2e tests
pnpm lint                     # Prettier + spell check + harness docs + rslint
pnpm lint:type                # Run rslint --type-check (needs built package .d.ts)
pnpm typecheck                # Alias of lint:type
pnpm format                   # Prettier format + heading-case --write
pnpm check-unused             # Run knip
pnpm test:examples            # Run example tests
pnpm test:vscode              # Run VS Code extension tests
pnpm bench:cpu                # Run CPU benchmarks
pnpm bench:memory             # Run memory benchmarks

# Package-specific examples
pnpm --filter @rstest/core build
pnpm --filter @rstest/core dev
pnpm --filter @rstest/core test
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts
pnpm --filter @rstest/core lint    # Rslint rules, this package only

# File-scoped / faster feedback
pnpm rstest packages/core/tests/core/rsbuild.test.ts
pnpm prettier --write path/to/file.ts
```

_Note_: E2E tests and examples consume built package output. Rebuild affected packages before running them (for example, `pnpm --filter @rstest/browser build`). For testing workflows, use the `testing` skill.

_Note_: `rslint --type-check` is the repo's type check and exists at the root only — it builds one program from `rslint.config.mts` and cannot be narrowed to a package, so run `pnpm typecheck` from the root. A package's `lint` covers that package's lint rules and nothing else.

## Development workflow

- Before changing behavior, identify the affected package(s), public API/config impact, browser-mode impact, adapter impact, docs impact, and test scope.
- Public API or config changes usually require docs updates.
- Behavioral changes require corresponding e2e coverage unless there is a clear reason existing coverage is sufficient.
- If a config option is shared with Rsbuild/Rslib/Rspack, check whether the adapters need to transform or pass it through consistently.
- Do not make repo-wide rewrites unless explicitly asked.
- Do not revert unrelated local changes.

## Testing guidance

- For root-discovered unit tests, prefer `pnpm rstest <package-test-path>`.
- Do not pass `e2e/...` paths to the root `pnpm rstest` command.
- Run e2e tests from the `e2e/` directory; when passing a path, strip the `e2e/` prefix.
- Do not overlap `pnpm build` and `pnpm e2e`; wait for builds to finish before e2e.
- If e2e fails with missing built files, rebuild the affected package(s) before retrying.

## Code style

- Use ESM-first: `.mjs` for runtime loaders, `.ts`/`.mts` for typed utilities.
- Do not mix CommonJS and ESM in the same module unless the file is intentionally a compatibility fixture.
- Use 2-space indentation and LF line endings.
- Use camelCase for locals, PascalCase for types/components, and SCREAMING_SNAKE_CASE for constants.
- Avoid namespace imports like `import * as foo from 'foo'` unless the module shape requires it.
- In-file TypeScript quality rules (restating comments, defensive checks, `as`/`any`, one-use abstractions, drift prevention) are owned by the `typescript` skill — apply it when writing `.ts`/`.tsx`/`.mts` files.

## Skills

Available workflow skills in `.agents/skills/`:

| Skill                      | Description                                                                       |
| -------------------------- | --------------------------------------------------------------------------------- |
| development                | Feature / bug-fix checklist for scope review and workflow routing                 |
| testing                    | Testing workflow for the rstest monorepo (run tests, write tests, debug failures) |
| typescript                 | TypeScript anti-slop guardrails for `.ts`, `.tsx`, and `.mts` files               |
| verify                     | Behavioral verification rules before claiming a change works (no proxy signals)   |
| pr-creator                 | Create a PR for the current branch                                                |
| create-draft-release-notes | Create or update draft GitHub releases and organize generated release notes       |
| create-release-blog        | Draft bilingual release blog posts from a version range                           |
| api-doc-sync               | Verify/fix that hand-written API doc signatures stay faithful to exported types   |
