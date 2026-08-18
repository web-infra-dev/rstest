# Coverage pipeline

Coverage spans three packages: `@rstest/core` owns the `CoverageProvider` contract (`../types/coverage.ts`), the run-cycle merge, and the report stage; `@rstest/coverage-istanbul` and `@rstest/coverage-v8` each implement the contract plus an Rsbuild instrumentation plugin. `packages/coverage-v8` has no AGENTS.md; this doc is its architecture reference.

## Data flow

- **Node**: each worker builds its own provider instance and prefers `collectRaw` when the provider also implements `resolveRawCoverage` (deferring conversion to the host); a null `collectRaw` return falls back to full in-worker `collect`. The pool strips `result.coverage`/`result.coverageRaw` off results before they reach reporters and forwards them to executor callbacks instead.
- **Browser**: Istanbul copies `globalThis.__coverage__` onto each file result and `buildBrowserCoverageMap` folds them into one map at outcome assembly. With Chromium + Playwright, the host collects V8 ranges for each page, attaches the generated bundles and source maps as raw payload resources, and lets the shared finalizer remap them host-side. Browser config validation rejects V8 only for non-Chromium browser projects; it deliberately skips the `list` command, which never collects coverage.
- **Finalize**: `finalizeRunCycle` merges outcome maps and resolves raw v8 batches host-side (`resolveAndMergeRawCoverage`). Normal runs then report through `generateCoverage`: filter → untested-file backfill → `generateReports` → thresholds (negative threshold values mean max-uncovered-count). Blob runs defer that stage only when the provider advertises `supportsDeferredCoverageFinalization`; older providers serialize collected coverage first, then retain their shard-local finalization.
- **Providers**: istanbul instruments at compile time by pushing `swc-plugin-coverage-instrument` into the SWC rule; v8 does not instrument — it profiles via the inspector and converts payloads host-side with acorn AST + source maps.

## Key invariants

- Coverage stripping differs by path. Node strips at the pool before reporters or state see results. Browser results carry `result.coverage` through the sink during the run and are stripped retroactively when the cycle map is folded (the browser executor's outcome assembly, or the host's per-rerun outcome assembly in watch) — reporters DO observe browser coverage at `onTestFileResult` time.
- Worker provider `cleanup()` runs in `finally` per file; istanbul's cleanup deletes `globalThis.__coverage__` — skipping it double-counts hits on non-isolated reruns.
- Report-stage failures are caught and raise the context-local exit status, but the raw-resolution seam inside `finalizeRunCycle` rethrows — a resource-load rejection propagates out of finalize instead of downgrading.
- `cleanCoverageReports` must stay on the test-run lifecycle, never an rsbuild compile hook — browser-only mode has no node rsbuild instance and `--passWithNoTests` races the hook.
- Memory bounds in `generateCoverage` are deliberate: projects are processed sequentially and untested files in small batches. Do not parallelize.
- Blob coverage from capable providers is deliberately pre-finalization: shards never scan the same untested files or check thresholds independently. `merge-reports` is the sole owner of filtering, backfill, reports, and thresholds for that unified blob workflow; providers without the capability retain the legacy per-run finalization path.
- The reporting provider (main process) and the worker collection providers are distinct instances — state set during collection never reaches reporting.
- Every browser cycle reports through the shared finalize, on both commands and in every watch shape — there is no bespoke report path left. Watch coverage is per-cycle on both transports: each report covers only the files that cycle ran, so the fold that produces a cycle's map must never widen past the cycle's own results.

## Coupling points (change both sides)

- A new `CoverageProvider` member → both provider packages plus the worker call sites in `../runtime/worker/runInPool.ts`.
- Each provider package entry must export `{ CoverageProvider, pluginCoverage }` — both are destructured by `loadCoverageProvider` under exactly those names.
- `createFastCoverageMap` / `mapWithConcurrency` are duplicated verbatim in both provider packages' `utils.ts` — change one, mirror the other.
- Bumping `swc-plugin-coverage-instrument` ↔ `COVERAGE_MAGIC_VALUE` used by istanbul's `readInitialCoverage`.
- `ExecutorCycleOutcome.coverage` shape: producers (node executor, browser executor) ↔ consumer (`finalizeRunCycle`).

## Gotchas

- `createFastCoverageMap` monkey-patches merge to sum hit counts in place when shapes match — retained file-coverage objects are mutated rather than copied; never assume istanbul's copy-on-merge semantics.
- v8 `collect`/`collectRaw` are one-shot per `init`; raw payload conversion destroys its input as it goes to cap peak memory — payloads cannot be replayed.
- istanbul's `readInitialCoverage` brace-matches around a magic value and VM-evaluates the extracted object literal — it depends on the exact generated-code shape, not on parsing.
