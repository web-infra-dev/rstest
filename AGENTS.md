# Rstest monorepo

Rstest is an Rsbuild-based testing framework for JavaScript/TypeScript projects.

## Sub-package Instructions

When working on code in a specific package, use the Read tool to load that package's AGENTS.md file for package-specific guidelines:

- For @rstest/core: @packages/core/AGENTS.md
- For @rstest/browser: @packages/browser/AGENTS.md
- For @rstest/browser-ui: @packages/browser-ui/AGENTS.md
- For @rstest/coverage-istanbul: @packages/coverage-istanbul/AGENTS.md
- For @rstest/adapter-rslib: @packages/adapter-rslib/AGENTS.md
- For rstest VS Code extension: @packages/vscode/AGENTS.md

## Monorepo structure

- `packages/core/` — @rstest/core: Core testing framework (CLI, runtime, reporter, pool)
- `packages/browser/` — @rstest/browser: Browser mode support (Playwright, WebSocket RPC)
- `packages/browser-ui/` — @rstest/browser-ui: Browser test UI (React + Tailwind + Ant Design)
- `packages/coverage-istanbul/` — @rstest/coverage-istanbul: Istanbul coverage provider
- `packages/adapter-rslib/` — @rstest/adapter-rslib: Rslib configuration adapter
- `packages/vscode/` — rstest: VS Code extension
- `e2e/` — End-to-end integration tests
- `examples/` — Example projects (node, react, browser)
- `website/` — Documentation site (Rspress)
- `scripts/` — Build scripts and shared configs

## Root commands

```bash
pnpm install                  # Install all workspace dependencies
pnpm build                    # Build all packages (excludes examples)
pnpm test                     # Run unit tests via rstest
pnpm e2e                      # Run e2e tests
pnpm lint                     # Biome check + spell check + type lint
pnpm format                   # Prettier format
pnpm typecheck                # Type check all packages
```

## Package-specific commands

Use `pnpm --filter <package> <command>` for targeted operations:

```bash
pnpm --filter @rstest/core build
pnpm --filter @rstest/core dev
pnpm --filter @rstest/core test
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts  # Single file
```

## E2E testing

- To run a specific e2e test: `pnpm rstest <path-to-test>` (e.g., `pnpm rstest browser-mode/config.test.ts`)
- To run tests in a fixture directory: `cd` into `e2e/<test>/fixtures/<fixture>/`, then run `npx rstest`

## File-scoped commands

Prefer file-scoped commands over project-wide commands for faster feedback:

```bash
# Type check a single file
pnpm tsc --noEmit path/to/file.ts

# Format a single file
pnpm prettier --write path/to/file.ts

# Lint a single file (with auto-fix)
pnpm biome check --write path/to/file.ts

# Run a single test file
pnpm rstest path/to/file.test.ts

# Run a single e2e test
cd e2e && pnpm rstest browser-mode/config.test.ts
```

Note: Always lint and typecheck updated files. Use project-wide commands sparingly.

## Do

- Use ESM-first: `.mjs` for runtime loaders, `.ts` for typed utilities
- Use 2-space indentation, LF line endings
- Use camelCase for locals, PascalCase for types/components, SCREAMING_SNAKE_CASE for constants
- Run `pnpm lint` before committing
- Keep changes small and focused
- Place tests mirroring source structure

## Don't

- Don't mix CommonJS and ESM in the same module
- Don't add heavy dependencies without discussion
- Don't commit without running lint
- Don't make repo-wide rewrites unless explicitly asked

## Commit guidelines

- Follow Conventional Commits: `type(scope): subject`
- Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`
- Keep PRs small and focused
- Reference issues when applicable (e.g., `Fixes #123`)

## Safety

Allowed without asking:

- Read/list files, search codebase
- Run lint, typecheck, test on single files
- Format code

Ask first:

- Install new dependencies
- Delete files
- Run full build or e2e suites
- Git push

## When stuck

- Ask clarifying questions or propose a plan
- Do not push large speculative changes without confirmation
