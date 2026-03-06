---
description: Run structured rstest perf profiling for a local project directory, then inspect rstest hotspots and optimization candidates
model: openai/gpt-5.4
---

Load the `rstest-perf-improve` skill, then apply it to `$ARGUMENTS`.

Requirements:

- default to `--ensure-build always`
- default to `--workers 1` for the first run unless the user asked for realistic concurrency
- read the generated `summary.json` and `summary.md`
- include a ready-to-run flamegraph command using `npx --yes speedscope '<cpuprofile>'`
- if hotspots point into `rstest`, inspect the relevant source files and propose optimization directions
- if hotspots are mostly in target project code or Node internals, say so clearly
