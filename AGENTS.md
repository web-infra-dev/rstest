# Rstest monorepo

Rstest is an Rsbuild-based testing framework for JavaScript/TypeScript projects.

## Sub-package Instructions

When working on code in a specific package, use the Read tool to load that package's `AGENTS.md` file for package-specific guidelines:

- For @rstest/core: `packages/core/AGENTS.md`
- For @rstest/browser: `packages/browser/AGENTS.md`
- For @rstest/browser-ui: `packages/browser-ui/AGENTS.md`
- For @rstest/browser-react: `packages/browser-react/AGENTS.md`
- For @rstest/coverage-istanbul: `packages/coverage-istanbul/AGENTS.md`
- For @rstest/adapter-rslib: `packages/adapter-rslib/AGENTS.md`
- For @rstest/adapter-rsbuild: `packages/adapter-rsbuild/AGENTS.md`
- For @rstest/adapter-rspack: `packages/adapter-rspack/AGENTS.md`
- For rstest VS Code extension: `packages/vscode/AGENTS.md`
- For documentation site: `website/AGENTS.md`

If a package does not have its own `AGENTS.md`, follow this root file and copy the closest local patterns.

## Monorepo structure

- `packages/core/` — @rstest/core: core testing framework (CLI, runtime, reporter, pool)
- `packages/browser/` — @rstest/browser: browser mode support (Playwright, WebSocket RPC)
- `packages/browser-ui/` — @rstest/browser-ui: prebuilt browser container UI (React + Tailwind + Ant Design)
- `packages/browser-react/` — @rstest/browser-react: React component testing utilities for browser mode
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

- Use `pnpm` (the repository currently pins `pnpm@11.5.2`).
- The workspace includes `benchmarks`, `website`, `scripts/**`, `packages/**`, `examples/**`, and `e2e/**`.
- Dependency installs use pnpm's stricter settings (`minimumReleaseAge`, `strictDepBuilds`, and explicit build-script approvals). Do not loosen these settings or add heavy dependencies without discussion.

## Commands

```bash
# Root commands
pnpm install                  # Install all workspace dependencies
pnpm build                    # Build all packages under packages/*
pnpm test                     # Run unit tests via rstest
pnpm e2e                      # Run e2e tests
pnpm lint                     # Prettier check + spell check + type lint
pnpm lint:type                # Run rslint
pnpm typecheck                # Run rslint --type-check-only
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

# File-scoped / faster feedback
pnpm rstest packages/core/tests/core/rsbuild.test.ts
pnpm prettier --write path/to/file.ts
```

_Note_: E2E tests and examples consume built package output. Rebuild affected packages before running them (for example, `pnpm --filter @rstest/browser build`). For testing workflows, use the `testing` skill.

## Development workflow

- Keep changes small and focused.
- Before changing behavior, identify the affected package(s), public API/config impact, browser-mode impact, adapter impact, docs impact, and test scope.
- Public API or config changes usually require docs updates.
- Behavioral changes require corresponding e2e coverage unless there is a clear reason existing coverage is sufficient.
- If a config option is shared with Rsbuild/Rslib/Rspack, check whether the adapters need to transform or pass it through consistently.
- Do not make repo-wide rewrites unless explicitly asked.
- Do not revert unrelated local changes.

## Testing guidance

- Prefer targeted tests first, then broader validation when needed.
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
- Prefer existing local patterns over introducing new abstractions.
- Do not add comments that restate the code; comment only non-obvious intent or constraints.
- Avoid unnecessary defensive runtime checks when TypeScript already guarantees the type.
- Minimize `as` casts and `any`; never let `any` leak into exported APIs, config types, or cross-package contracts.
- Avoid one-use abstractions unless they materially improve readability.

## Skills

Available workflow skills in `.agents/skills/`:

| Skill                      | Description                                                                       |
| -------------------------- | --------------------------------------------------------------------------------- |
| development                | Feature / bug-fix checklist for scope review and workflow routing                 |
| testing                    | Testing workflow for the rstest monorepo (run tests, write tests, debug failures) |
| typescript                 | TypeScript anti-slop guardrails for `.ts`, `.tsx`, and `.mts` files               |
| pr-creator                 | Create a PR for the current branch                                                |
| create-draft-release-notes | Create or update draft GitHub releases and organize generated release notes       |
| create-release-blog        | Draft bilingual release blog posts from a version range                           |
| api-doc-sync               | Verify/fix that hand-written API doc signatures stay faithful to exported types   |
| triage                     | Move issues and external PRs through triage states and write agent briefs         |
| implement                  | Implement a piece of work based on a spec, agent brief, or set of tickets         |
| setup-matt-pocock-skills   | Re-scaffold the triage/issue-tracker configuration in `docs/agents/`              |

## Agent skills

### Issue tracker

Issues and external PRs are tracked on GitHub (`web-infra-dev/rstest`); public writes require per-item maintainer confirmation. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles map to repo labels (`needs-info` → `need reproduction`; others match by name). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CLAUDE.md` plus per-package `AGENTS.md` files. See `docs/agents/domain.md`.
