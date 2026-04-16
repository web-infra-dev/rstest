# Benchmarks

This package owns the repository benchmark entrypoints.

Use it when you want to:

- run the CPU benchmark suite
- run the full-path memory benchmark suite
- work on the generated frontend workload used for memory tracking

Important files:

- `suiteRun.mjs` — CPU benchmark entrypoint
- `memorySuiteRun.mjs` — memory benchmark entrypoint
- `createFrontendMemoryFixture.mjs` — generator for the synthetic `jsdom`
  frontend workload used by the memory benchmark

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

## How this relates to CI

CI uses the same package scripts through [`.github/workflows/codspeed.yml`](../.github/workflows/codspeed.yml):

- the `codspeed-cpu` job runs `pnpm bench:cpu` with CodSpeed `mode: simulation`
- the `codspeed-memory` job runs `pnpm bench:memory` with CodSpeed `mode: memory`

Local and CI runs use the same benchmark entrypoints, but CodSpeed metric
collection only happens inside the GitHub Action on Linux.

The CPU benchmark tracks CodSpeed CPU simulation, not wall-clock time. That
means the primary CPU metric focuses on user-space CPU work and should not be
read as full end-to-end runtime including all system-call-heavy overhead.

Relevant CodSpeed docs:

- Instruments overview: https://codspeed.io/docs/instruments
- CPU simulation: https://codspeed.io/docs/instruments/cpu
- Memory instrument: https://codspeed.io/docs/instruments/memory

## Memory workload

The memory benchmark does not commit a large frontend repository to git.
It generates a temporary project at runtime and runs one full Rstest execution
path against it.

Current workload traits:

- `jsdom` environment
- many generated test files
- shared dependency graph
- heavy frontend dependencies through `antd` and `three`
- concurrent execution enabled by default with `4` workers to keep memory
  pressure closer to large-repository OOM scenarios

You can tune the memory benchmark worker count locally or in CI with:

```bash
RSTEST_BENCH_MEMORY_WORKERS=6 pnpm bench:memory
```
