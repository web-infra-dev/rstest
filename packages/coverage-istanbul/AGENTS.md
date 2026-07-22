# @rstest/coverage-istanbul

Istanbul coverage provider for Rstest. Instruments code and generates coverage reports.

## Module structure

- `src/index.ts` — Package entry, exports `pluginCoverage` and `CoverageProvider` (both destructured by core's `loadCoverageProvider`)
- `src/provider.ts` — Coverage provider implementation
- `src/plugin.ts` — Rsbuild plugin for instrumentation
- `src/utils.ts` — Fast coverage-map merge, initial-coverage scrape, source-map remapping

Cross-package pipeline deep dive: `packages/core/src/coverage/AGENTS.md`.

## Commands

```bash
pnpm --filter @rstest/coverage-istanbul build    # Build via Rslib
pnpm --filter @rstest/coverage-istanbul dev      # Watch mode
```

## Dependencies

- `istanbul-lib-coverage` — Coverage data structures
- `istanbul-lib-report` — Report generation
- `istanbul-reports` — Report formats (html, lcov, text, etc.)
- `swc-plugin-coverage-instrument` — SWC-based instrumentation

## Do

- Follow istanbul-lib API conventions
- Use `@rstest/core` types for integration
- Keep instrumentation logic in `plugin.ts`
- Keep provider logic in `provider.ts`

## Don't

- Don't modify coverage data format; follow istanbul standards
- Don't add report formats without discussing use case

## Key files

- `src/provider.ts` — Main provider implementing CoverageProvider interface
- `src/plugin.ts` — Rsbuild plugin that instruments source code
- `src/index.ts` — Package entry point
