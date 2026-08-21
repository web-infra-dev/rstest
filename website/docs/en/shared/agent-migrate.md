<!-- cspell:words TYPELESS -->

# Migrate to Rstest

## Goal

Migrate the smallest runnable Jest/Vitest scope with minimal behavior change. Use documentation and types that match the installed Rstest version; use latest online docs only after the capability gate confirms they apply.

## Workflow

1. Detect the runner, environment, Rstack integration, and smallest runnable scope with `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/detect-test-framework.md`.
2. Run `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/dependency-install-gate.md` before choosing Rstest, coverage, adapter, or plugin APIs.
3. Before editing, record the exact command, Node and runner versions, environment, files/tests/skips/snapshots, and failures. Capture the pre-migration test manifest and follow `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/discovery-parity.md` throughout the migration.
4. For Jest read `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/jest-migration-deltas.md`; for Vitest read `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/vitest-migration-deltas.md`; for global APIs also read `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/global-api-migration.md`. If the request explicitly contains the case-insensitive keyword `playwright`, read `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/playwright-migration-deltas.md`; do not load the Playwright path for a browser-only request that omits that keyword. Migrate scripts, config, and setup before editing test bodies; prefer adapter or Rsbuild/Rspack fixes over broad test rewrites.
5. If config loading emits `[MODULE_TYPELESS_PACKAGE_JSON]`, use `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/config-module-type.md`. Do not suppress the warning or change the whole package module type without an audit.
6. Get the migrated scope semantically green. Fix failures in this order: dependency skew, config/resolver, discovery, setup/environment/coverage, mocks/timers/snapshots, then test bodies.
7. Compare the post-migration manifest and execution counts with the baseline. Classify every added, removed, skipped, or excluded test explicitly; do not call a run equivalent merely because it is green.
8. Remove temporary aliases, diagnostic hooks, and copied legacy workarounds that are no longer required. Keep only configuration proven necessary by behavior or measurement.
9. If wall time, build, test runtime, logs, or memory materially regress, load and follow the `rstest-debugging` skill when available. Otherwise use the migration fallback in `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/performance-diagnosis.md`, then read `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/dependency-bundling-performance.md` and/or `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/mocked-module-build-graph.md` according to the measured bottleneck. Change one variable at a time.
10. After correctness and performance validation, remove only legacy files and dependencies owned by the migrated scope. Summarize behavior parity, discovery differences, unsupported fields, retained compatibility config, performance tradeoffs, and TODOs.

## Guardrails

- Keep the smallest viable scope. Do not broaden a monorepo migration because scopes share a lockfile.
- Do not change production behavior, assertions, test names, scenarios, coverage thresholds, or ignore directives to make migration pass.
- Do not introduce `jest`/`vi` shims or aliases; rewrite call sites with `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/global-api-migration.md`.
- Do not silently drop unknown config fields or historical excludes. Verify, replace, or report each one.
- Do not compare performance across different test manifests, Node versions, coverage modes, cache states, or worker settings.
- Keep the previous runner until Rstest is green. Use a local Rstest checkout only for labeled diagnostics, then validate the final result with the project's installed dependency.
- Escalate before many test edits or any production-source change: report why smaller config/setup fixes failed, options, risks, and the recommended path.

## High-risk Rstest deltas

- `rstest` / `rstest run` is single-run; watch mode is `rstest --watch` or `rstest watch`.
- `globals` defaults to `false`; preserving global APIs requires `globals: true` and `@rstest/core/globals` types.
- Rstest builds before tests run. `rs.mock()` is runtime replacement and does not by itself prune the real module graph.
- Dependency bundling trades compiler work for runtime Node loading. Neither “bundle all” nor “externalize all” is universally faster; measure a representative file and the full scope.
- An externalized runtime mock must match the exact request and module format. A config-wide external is unsafe when any test needs the real module.
