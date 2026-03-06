# Rstest perf scripts

This directory contains the reusable profiling workflow for `rstest` JavaScript-side performance analysis.

## Goals

- profile `rstest` against any local project directory
- emit structured artifacts for agents
- keep raw `.cpuprofile` files for human flamegraph inspection
- make the workflow repeatable instead of relying on ad-hoc shell snippets

## Files

- `profile.mts`: main entry point for profiling and summary generation
- `tsconfig.json`: local TypeScript config for validating the perf scripts

## Human usage

Run against a local project directory:

```bash
pnpm perf:rstest -- './examples/node' --workers 1
```

Run and open the first flamegraph automatically:

```bash
pnpm perf:rstest -- './examples/node' --workers 1 --flame
```

Pass extra `rstest` CLI args after `--`:

```bash
pnpm perf:rstest -- './examples/node' --workers 1 -- run test/index.test.ts
```

Reopen a saved CPU profile later:

```bash
npx --yes speedscope 'test-results/rstest-perf/<run-id>/diagnostic/<profile>.cpuprofile'
```

## Agent usage

Shared skill:

- `.agents/skills/rstest-perf-improve/SKILL.md`

OpenCode command:

- `.opencode/command/rstest-perf-improve.md`

Example prompt:

```text
/rstest-perf-improve 观测下 ./examples/node，执行 perf profile，然后分析 rstest 源码里有哪些性能优化点
```

## Artifacts

Each run writes into `test-results/rstest-perf/<run-id>/`.

- `summary.json`: machine-readable hotspot summary
- `summary.md`: human-readable summary
- `stdout.log`: command stdout
- `stderr.log`: command stderr
- `build.log`: rebuild log
- `diagnostic/*.cpuprofile`: raw CPU profiles

## Validation

Typecheck:

```bash
pnpm tsc --noEmit -p 'scripts/perf/tsconfig.json'
```

Lint:

```bash
pnpm biome check --write 'scripts/perf/profile.mts' 'scripts/perf/README.md'
```
