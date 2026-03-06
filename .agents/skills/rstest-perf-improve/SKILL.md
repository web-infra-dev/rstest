---
name: rstest-perf-improve
description: Profile a local project directory with the current rstest source, emit structured JSON/Markdown artifacts plus flamegraph-ready cpuprofile files, and inspect rstest hotspots for optimization opportunities.
compatibility: Project skill for agents that support the Agent Skills format. Requires node, pnpm, npx, and the current repository checkout.
metadata:
  audience: rstest-maintainers
  workflow: profiling-and-hotspot-analysis
---

# Rstest perf improve

Use this skill when the user wants to measure `rstest` performance, run repeatable perf cases, inspect hotspots, or ask where `rstest` can be optimized.

## Primary workflow

1. Resolve the target directory:
   - any absolute or relative local project path
2. Run the profiler with the current repository source:
   - baseline: `pnpm perf:rstest -- '/path/to/project' --ensure-build always --workers 1`
   - with flamegraph UI: `pnpm perf:rstest -- '/path/to/project' --ensure-build always --workers 1 --flame`
   - extra `rstest` args can be appended after `--`
3. Read the generated structured artifacts:
   - `summary.json` for machine-readable hotspots
   - `summary.md` for quick human scanning
4. If the user wants a graphical view, either:
   - pass `--flame` during the profiling run
   - or reopen the primary profile with `npx --yes speedscope '<cpuprofile-path>'`
5. Inspect the hottest `rstest` frames/files and map them back to source modules, then propose optimization candidates.

## How to analyze

- Prefer `aggregate.topRstestFrames` and `aggregate.topRstestFiles` from `summary.json`.
- Distinguish time spent in:
  - `rstest` code
  - target project code
  - Node internals
  - downstream toolchain like `rsbuild` / `rspack`
- Start with JavaScript-side hotspots. Only suggest Rust-side profiling when the profile is dominated by `rspack`/binding calls.
- When source maps are insufficient, use function names and built chunk paths to trace back into `packages/core/src`.

## Output expectations

Your response should include:

- what target was profiled
- where artifacts were written
- the main hotspots
- likely optimization candidates inside `rstest`
- the flamegraph open command for humans

## Repo assets used by this skill

- `scripts/perf/profile.mts`
- `references/workflow.md`
- `references/artifacts.md`
