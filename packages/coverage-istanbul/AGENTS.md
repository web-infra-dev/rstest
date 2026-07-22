# @rstest/coverage-istanbul

Istanbul coverage provider for Rstest. Instruments code and generates coverage reports.

The package entry must export exactly `{ pluginCoverage, CoverageProvider }` — both are destructured by core's `loadCoverageProvider` under those names. The cross-package pipeline contract (data flow, invariants, coupling points shared with core and coverage-v8) lives in `packages/core/src/coverage/AGENTS.md`.

## Commands

```bash
pnpm --filter @rstest/coverage-istanbul build    # Build via Rslib
pnpm --filter @rstest/coverage-istanbul dev      # Watch mode
pnpm --filter @rstest/coverage-istanbul lint     # Rslint
```

## Dependencies

- `istanbul-lib-coverage` — Coverage data structures
- `istanbul-lib-report` — Report generation
- `istanbul-reports` — Report formats (html, lcov, text, etc.)
- `swc-plugin-coverage-instrument` — SWC-based instrumentation

## Constraints

- Keep instrumentation logic in `src/plugin.ts` and provider logic in `src/provider.ts`.
- Don't deviate from the istanbul coverage data format; downstream tooling expects the standard shape.
- Don't add report formats without discussing the use case.
