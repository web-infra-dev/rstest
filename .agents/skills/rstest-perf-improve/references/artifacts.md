# Artifacts

Each profiling run writes into `test-results/rstest-perf/<run-id>/`.

## Files

- `summary.json`: structured machine-readable result
- `summary.md`: quick human-readable summary
- `stdout.log`: command stdout
- `stderr.log`: command stderr
- `build.log`: rebuild log when `--ensure-build` rebuilds workspace packages
- `diagnostic/*.cpuprofile`: raw CPU profiles for flamegraph tools

## Human flamegraph workflow

Two options:

```bash
pnpm perf:rstest -- './examples/node' --workers 1 --flame
npx --yes speedscope 'test-results/rstest-perf/<run-id>/diagnostic/<profile>.cpuprofile'
```

`--flame` opens the first generated `.cpuprofile` automatically.

If you want to reopen a profile later, use the exact `.cpuprofile` path with `speedscope`.
