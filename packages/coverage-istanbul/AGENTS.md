# @rstest/coverage-istanbul

Istanbul coverage provider for Rstest. Instruments code and generates coverage reports.

The package entry must export exactly `{ pluginCoverage, CoverageProvider }` — both are destructured by core's `loadCoverageProvider` under those names. The cross-package pipeline contract (data flow, invariants, coupling points shared with core and coverage-v8) lives in `packages/core/src/coverage/AGENTS.md`.

## Commands

```bash
pnpm --filter @rstest/coverage-istanbul build    # Build via Rslib
pnpm --filter @rstest/coverage-istanbul dev      # Watch mode
pnpm --filter @rstest/coverage-istanbul lint     # Rslint
```

## Constraints

- Keep instrumentation logic in `src/plugin.ts` and provider logic in `src/provider.ts`.
- Don't deviate from the istanbul coverage data format; downstream tooling expects the standard shape.
- Don't add report formats without discussing the use case.
- Keep Node coverage queries stateless and fold results immediately into the cycle map; reserving structures or buffering results would break later workers' knowledge of the host. The first wave (up to `maxWorkers`) can send duplicate full structures.
- Hash equality for the same path is the only structural identity for omitting maps, as in `createFastCoverageMap`. Native unions renumber counter keys, so that utility must drop the stored hash after a union, including on the full-coverage path. If two projects instrument one absolute path differently in a cycle, packed results can race that union and must fail loudly rather than corrupt counts.
- Keep the raw path opportunistic: core 0.12 remains supported through `collect` because this provider has no `resolveRawCoverage`. Browser Istanbul collection bypasses this Node protocol and retains standard coverage data.
