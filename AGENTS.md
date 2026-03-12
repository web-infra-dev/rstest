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
pnpm lint                     # Biome check + spell check + type lint
pnpm format                   # Prettier format
pnpm typecheck                # Type check all packages

# Package-specific
pnpm --filter @rstest/core build
pnpm --filter @rstest/core dev
pnpm --filter @rstest/core test
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts  # Single file

# File-scoped (faster feedback)
pnpm biome check --write path/to/file.ts   # Lint + auto-fix
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

## Skills

Available workflow skills in `.agents/skills/`:

| Skill      | Description                                                                       |
| ---------- | --------------------------------------------------------------------------------- |
| pr         | Create a PR for the current branch                                                |
| testing    | Testing workflow for the rstest monorepo (run tests, write tests, debug failures) |
| typescript | TypeScript anti-slop guardrails for .ts, .tsx, and .mts files                     |
