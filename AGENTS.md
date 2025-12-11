# Rstest Monorepo

Rstest is an Rsbuild-based testing framework for JavaScript/TypeScript projects.

## Monorepo structure

- `packages/core/` — @rstest/core: Core testing framework (CLI, runtime, reporter, pool)
- `packages/browser-ui/` — @rstest/browser-ui: Browser test UI (React + Tailwind + Ant Design)
- `packages/coverage-istanbul/` — @rstest/coverage-istanbul: Istanbul coverage provider
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
