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
- Only arrived full payloads populate the cycle map's `(path, hash)` structure registry. Known structures snapshot the identities already folded by the host when the runner sends a run task; keep the registry append-only so anything ever listed stays restorable at fold time. Workers never ask the host; a missing list means full payloads. Never overwrite registered maps or pass them to code that mutates their containers. The first wave (up to `maxWorkers`) can send duplicate full structures; the list can also miss structures folded during its task, safely costing extra full entries.
- Restore packed maps from the registry, not the live accumulator: a native union can replace the live maps without invalidating registered versions. Native unions renumber counter keys, so `createFastCoverageMap` must still drop the live hash after a union, including on the full-coverage path.
- Keep the raw path opportunistic: core 0.12 remains supported through `collect` because this provider has no `resolveRawCoverage`. Browser Istanbul collection bypasses this Node protocol and retains standard coverage data.
