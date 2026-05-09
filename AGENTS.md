# Rstest monorepo

Rstest is an Rsbuild-based testing framework for JavaScript/TypeScript projects.

## Sub-package Instructions

When working on code in a specific package, use the Read tool to load that package's AGENTS.md file for package-specific guidelines:

- For @rstest/core: @packages/core/AGENTS.md
- For @rstest/browser: @packages/browser/AGENTS.md
- For @rstest/browser-ui: @packages/browser-ui/AGENTS.md
- For @rstest/browser-react: @packages/browser-react/AGENTS.md
- For @rstest/coverage-istanbul: @packages/coverage-istanbul/AGENTS.md
- For @rstest/adapter-rslib: @packages/adapter-rslib/AGENTS.md
- For @rstest/adapter-rsbuild: @packages/adapter-rsbuild/AGENTS.md
- For rstest VS Code extension: @packages/vscode/AGENTS.md
- For documentation site: @website/AGENTS.md

## Monorepo structure

- `packages/core/` — @rstest/core: Core testing framework (CLI, runtime, reporter, pool)
- `packages/browser/` — @rstest/browser: Browser mode support (Playwright, WebSocket RPC)
- `packages/browser-ui/` — @rstest/browser-ui: Browser test UI (React + Tailwind + Ant Design)
- `packages/browser-react/` — @rstest/browser-react: React component testing utilities
- `packages/coverage-istanbul/` — @rstest/coverage-istanbul: Istanbul coverage provider
- `packages/adapter-rslib/` — @rstest/adapter-rslib: Rslib configuration adapter
- `packages/adapter-rsbuild/` — @rstest/adapter-rsbuild: Rsbuild configuration adapter
- `packages/vscode/` — rstest: VS Code extension
- `e2e/` — End-to-end integration tests
- `examples/` — Example projects (node, react, browser)
- `website/` — Documentation site (Rspress)
- `scripts/` — Build scripts and shared configs

## Commands

```bash
# Root commands
pnpm install                  # Install all workspace dependencies
pnpm build                    # Build all packages (excludes examples)
pnpm test                     # Run unit tests via rstest
pnpm e2e                      # Run e2e tests
pnpm lint                     # Prettier check + spell check + type lint
pnpm format                   # Prettier format
pnpm typecheck                # Type check all packages

# Package-specific
pnpm --filter @rstest/core build
pnpm --filter @rstest/core dev
pnpm --filter @rstest/core test
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts  # Single file

# File-scoped (faster feedback)
pnpm prettier --write path/to/file.ts       # Format
pnpm tsc --noEmit path/to/file.ts           # Type check
```

_Note_: E2E tests and examples consume built package output — rebuild affected packages before running them (e.g., `pnpm --filter @rstest/browser build`). For testing workflows, see the testing skill.

## Do

- Use ESM-first: `.mjs` for runtime loaders, `.ts` for typed utilities
- Use 2-space indentation, LF line endings
- Use camelCase for locals, PascalCase for types/components, SCREAMING_SNAKE_CASE for constants
- Keep changes small and focused
- Place tests mirroring source structure

## Don't

- Don't mix CommonJS and ESM in the same module
- Don't add heavy dependencies without discussion
- Don't use namespace imports like `import * as foo from 'foo'` unless the module shape requires it
- Don't make repo-wide rewrites unless explicitly asked

## Public API conventions

`pnpm api:check` (drift detection via `@microsoft/api-extractor`) is the audit trail for the v1 surface. `pnpm build` runs publint + attw via rslib plugins on every package.

- **Default visibility is public.** Any symbol exported from a public entry (`packages/*/src/index.ts`, `packages/core/src/browser.ts`) is part of the v1 contract unless explicitly tagged.
- **Mark internal types with `@internal`** in TSDoc. The symbol still ships in the rolled `.d.ts` for cross-package consumption but is hidden from the user-facing report.
- **Every optional config field needs `@default <literal>`** — the value is the source of truth for documentation. Use `@default {expression}` form when the literal cannot be expressed simply.
- **Custom TSDoc tags** (registered in `scripts/tsdoc.shared.json`):
  - `@cliDefault <literal>` — when the CLI flag default differs from the config default (e.g. `bail`).
  - `@cliFlag <name>` — when the CLI name cannot be derived from the field name via `camel→kebab`.
  - `@since <x.y.z>` — version in which the symbol was introduced (mirrors JSDoc convention).

### Workflow

| When you change…               | Run                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| A public type                  | `pnpm api:update` and commit the updated `packages/*/etc/*.api.md`                   |
| A `package.json` `exports` map | `pnpm build` (publint + attw run as rslib plugins)                                   |
| A public config option         | Sync `website/docs/{en,zh}/config/test/<kebab>.mdx` and add `<ApiMeta addedVersion>` |

Env var escape hatches:

- `UPDATE_API=1 pnpm api:check` — same as `pnpm api:update`; rewrites `etc/*.api.md` baselines instead of failing on drift.
- `SKIP_PUBLISH_CHECK=1 pnpm build` — skips publint + attw plugins for fast local iteration. CI never sets this.

## Skills

Available workflow skills in `.agents/skills/`:

| Skill       | Description                                                                       |
| ----------- | --------------------------------------------------------------------------------- |
| development | Feature / bug-fix checklist for scope review and workflow routing                 |
| pr          | Create a PR for the current branch                                                |
| testing     | Testing workflow for the rstest monorepo (run tests, write tests, debug failures) |
| typescript  | TypeScript anti-slop guardrails for .ts, .tsx, and .mts files                     |
