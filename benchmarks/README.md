# Benchmarks

This package owns the repository benchmark entrypoints and synthetic fixture generators.

Use it when you want to:

- run the CPU benchmark suite (`startup`, `compile`, `runner`, `jsdom`)
- run the frontend memory benchmark suite (`forks` and `vmThreads`)
- adjust or calibrate the generated workloads

Important files:

- `suiteRun.mjs` — CPU benchmark entrypoint (`walltime` mode in CI)
- `createCpuFixtures.mjs` — generator for the four focused CPU benchmark projects
- `memorySuiteRun.mjs` — memory benchmark entrypoint (`memory` mode in CI)
- `createFrontendMemoryFixture.mjs` — generator for the synthetic `jsdom` + React + `antd` + `three` frontend workload

All benchmark fixtures are generated dynamically under `benchmarks/fixtures/` (gitignored) and cleaned up after each run.

## Run benchmarks locally

These commands work locally without the CodSpeed CLI. They validate the
benchmark workloads and print local timing output.

From the repository root:

```bash
pnpm bench:cpu
pnpm bench:memory
```

Directly against this package:

```bash
pnpm --filter @rstest/benchmarks bench:cpu
pnpm --filter @rstest/benchmarks bench:memory
```

When you run the memory benchmark locally on macOS, you should expect only the
generated workload to run plus a local timing summary. CodSpeed memory metrics
are not produced locally on macOS.

## CPU suite

`suiteRun.mjs` separates four orthogonal performance paths instead of mixing
startup overhead into every measurement:

- `startup` — full cold start (`loadConfig` + `createRstest` + minimal 1-test run)
- `compile` — cold compilation (`buildCache: false`) of a 16-entry / 128-module TS/TSX graph with barrel re-exports
- `runner` — high-density test execution (nested suites, hooks, `it.each`, `rstest.fn`/`spyOn`, deep matchers, async batches) with a pre-warmed `buildCache` and single worker
- `jsdom` — multi-file `jsdom` (`prebundle: 'auto'`) + `react-dom/client` mount/interaction/unmount + `rstest.mock`

Local iteration controls:

```bash
RSTEST_BENCH_CPU_ITERATIONS=5 RSTEST_BENCH_CPU_WARMUP=1 pnpm bench:cpu
```

## Memory suite

`memorySuiteRun.mjs` generates a multi-worker `jsdom` frontend workspace using
real `react-dom/client` (`createRoot`) mount/update/unmount lifecycle flows, `antd`,
and `three`. Persistent `buildCache` is primed once before benchmarking so both
local runs and CodSpeed's analysis runner consistently measure warm-cache
execution memory.

By default it runs both `forks` and `vmThreads` profiles using Rstest's default
`prebundle: 'auto'`:

- `frontend-memory-forks` — `pool: 'forks'`, `maxWorkers: 4`
- `frontend-memory-vm-threads` — `pool: 'vmThreads'`, `maxWorkers: 4`, `memoryLimit: '256MB'`

Local tuning overrides:

```bash
# Run a single pool profile
RSTEST_BENCH_MEMORY_POOL=forks pnpm bench:memory
RSTEST_BENCH_MEMORY_POOL=vmThreads RSTEST_BENCH_MEMORY_LIMIT=256MB pnpm bench:memory

# Override worker count, test file count, or environment prebundle mode
RSTEST_BENCH_MEMORY_WORKERS=6 RSTEST_BENCH_MEMORY_FILES=48 RSTEST_BENCH_MEMORY_PREBUNDLE=false pnpm bench:memory
```

## How this relates to CI

CI runs the same benchmark entrypoints through [`.github/workflows/codspeed.yml`](../.github/workflows/codspeed.yml):

- the `codspeed-cpu` job runs `node benchmarks/suiteRun.mjs` with CodSpeed `mode: walltime` on `codspeed-macro` (weekly schedule + manual dispatch)
- the `codspeed-memory` job runs `benchmarks/memorySuiteRun.mjs` with CodSpeed `mode: memory` on `ubuntu-latest` (daily schedule + manual dispatch)

Local and CI runs use the same benchmark entrypoints, but CodSpeed metric
collection only happens inside the GitHub Action on Linux.

The CPU benchmark tracks wall-clock time on CodSpeed bare-metal runners
(`codspeed-macro`), capturing full end-to-end runtime including worker pool and
system-call overhead.

Relevant CodSpeed docs:

- Instruments overview: https://codspeed.io/docs/instruments
- CPU walltime: https://codspeed.io/docs/instruments/walltime
- Memory instrument: https://codspeed.io/docs/instruments/memory
