# Coverage pipeline

Coverage spans three packages: `@rstest/core` owns the `CoverageProvider` contract (`../types/coverage.ts`), the run-cycle merge, and the report stage; `@rstest/coverage-istanbul` and `@rstest/coverage-v8` each implement the contract plus an Rsbuild instrumentation plugin. `packages/coverage-v8` has no AGENTS.md; this doc is its architecture reference.

## Data flow

- **Node**: each worker builds its own provider instance and prefers `collectRaw` when the provider also implements `resolveRawCoverage` (deferring conversion to the host); a null `collectRaw` return falls back to full in-worker `collect`. The pool strips `result.coverage`/`result.coverageRaw` off results before they reach reporters and forwards them to executor callbacks instead.
- **Browser**: istanbul-only — `@rstest/browser` config validation (not the provider) throws for v8 on a browser-only run and warns on mixed runs; the guard deliberately skips the `list` command, which never collects coverage. The runner copies `globalThis.__coverage__` onto each file result; `buildBrowserCoverageMap` folds them into one map at outcome assembly.
- **Finalize**: `finalizeRunCycle` merges outcome maps, resolves raw v8 batches host-side (`resolveAndMergeRawCoverage`), then reports through `generateCoverage`: filter → untested-file backfill → `generateReports` → thresholds (negative threshold values mean max-uncovered-count).
- **Providers**: istanbul instruments at compile time by pushing `swc-plugin-coverage-instrument` into the SWC rule; v8 does not instrument — it profiles via the inspector and converts payloads host-side with acorn AST + source maps.

## Key invariants

- Coverage stripping differs by path. Node strips at the pool before reporters or state see results. Browser results carry `result.coverage` through the sink during the run and are stripped retroactively at outcome assembly — reporters DO observe browser coverage at `onTestFileResult` time.
- Worker provider `cleanup()` runs in `finally` per file; istanbul's cleanup deletes `globalThis.__coverage__` — skipping it double-counts hits on non-isolated reruns.
- Report-stage failures are caught and downgraded to `process.exitCode = 1`, but the raw-resolution seam inside `finalizeRunCycle` rethrows — a resource-load rejection propagates out of finalize instead of downgrading.
- `cleanCoverageReports` must stay on the test-run lifecycle, never an rsbuild compile hook — browser-only mode has no node rsbuild instance and `--passWithNoTests` races the hook.
- Memory bounds in `generateCoverage` are deliberate: projects are processed sequentially and untested files in small batches. Do not parallelize.
- The reporting provider (main process) and the worker collection providers are distinct instances — state set during collection never reaches reporting.
- Browser-only **watch** runs bypass `finalizeRunCycle`: a bespoke coverage report runs once after the watch session exits. Non-watch browser runs go through the shared finalize like node runs.

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
