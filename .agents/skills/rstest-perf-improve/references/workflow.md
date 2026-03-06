# Workflow

## Commands

```bash
pnpm perf:rstest -- './examples/node' --ensure-build always --workers 1
pnpm perf:rstest -- './examples/node' --ensure-build always --workers 1 --flame
pnpm perf:rstest -- '/path/to/project' --ensure-build always --workers 1 -- run
```

## Suggested sequence

1. Run a low-noise baseline with `--workers 1`.
2. Read `summary.json`.
3. If a hotspot is clearly inside `rstest`, inspect the owning source module.
4. If the hotspot is mostly `rspack`/binding code, note that JS-side gains may be limited and recommend deeper `Samply` or Rust-side profiling as a follow-up.

## Interpretation hints

- `runCLI`, `runTests`, discovery/glob functions, worker-pool code, and reporter code are usually good `rstest` optimization entry points.
- Hotspots under the target repo path usually mean the project under test dominates.
- Hotspots under `node:` or Node internals often indicate startup/module loading overhead rather than `rstest` logic.
