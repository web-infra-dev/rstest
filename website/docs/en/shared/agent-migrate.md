# Migrate to Rstest

## Goal

Migrate Jest- or Vitest-based tests and configuration to Rstest with minimal behavior changes.

## Migration principles (must follow)

1. **Smallest-change-first**: prefer the smallest viable change that restores test pass.
2. **Config before code**: prefer fixing in config/tooling/mocks before touching test logic.
3. **Do not change user source behavior**: avoid modifying production/business source files unless user explicitly requests it.
4. **Avoid bulk test rewrites**: do not refactor entire test suites when a local compatibility patch can solve it.
5. **Preserve test intent**: keep assertions and scenario coverage unchanged unless clearly broken by framework differences.
6. **Defer legacy runner removal**: keep Jest/Vitest dependency and legacy config during migration; remove only after Rstest tests pass.

## Workflow

1. Detect current test framework (`https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/detect-test-framework.md`)
2. Open the official migration guide(s):
   - Jest: https://rstest.rs/guide/migration/jest.md
   - Vitest: https://rstest.rs/guide/migration/vitest.md
   - Prefer the `.md` URL form when available; Rstest pages provide Markdown variants that are more AI-friendly.
3. Dependency install gate (blocker check, see `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/dependency-install-gate.md`)
4. Apply framework-specific migration deltas:
   - Jest: `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/jest-migration-deltas.md`
   - Vitest: `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/vitest-migration-deltas.md`
   - Global API replacement rules: `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/global-api-migration.md`
   - Known compatibility pitfalls: `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/rstest-compat-pitfalls.md`
5. Check type errors
6. Run tests and fix deltas
7. Remove legacy test runner dependency/config only after Rstest is green
8. Summarize changes

## 1. Detect current test framework

Use `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/detect-test-framework.md`.
If both Jest and Vitest are present, migrate one scope at a time (package/suite), keeping mixed mode until each scope is green on Rstest.

## 3. Dependency install gate (blocker check)

Before large-scale edits, verify dependencies can be installed and test runner binaries are available.
Detailed checks, blocked-mode output format, and `ni` policy are in:
`https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/dependency-install-gate.md`

## Patch scope policy (strict)

### Preferred change order

1. CLI/script/config migration (`package.json`, `rstest.config.ts`, include/exclude, test environment).
2. Test setup adapter migration (for example `@testing-library/jest-dom/vitest` to matcher-based setup in Rstest).
3. Mock compatibility adjustments (target module path, `{ mock: true }`, `importActual`).
4. Narrow per-test setup fixes (single-file, single-suite level).
5. Path resolution compatibility fixes (`import.meta.url` vs `__dirname`) in test/setup helpers.
6. As a last resort, test body changes.
7. Never modify runtime source logic by default.

### Red lines

- Do not rewrite many tests in one sweep without first proving config-level fixes are insufficient.
- Do not alter business/runtime behavior to satisfy tests.
- Do not change assertion semantics just to make tests pass.
- Do not broaden migration to unrelated packages in monorepo.
- Do not delete legacy runner dependency/config before confirming Rstest tests pass.

### Escalation rule for large edits

If a fix would require either:

- editing many test files, or
- changing user source files,

stop and provide:

1. why minimal fixes failed,
2. proposed large-change options,
3. expected impact/risk per option,
4. recommended option.

## 6. Run tests and fix deltas

- Run the test suite and fix failures iteratively.
- Fix configuration and resolver errors first, then address mocks/timers/snapshots, and touch test logic last.
- If mocks fail for re-exported modules under Rspack, first check whether the project is pinned to `rstest < 0.9.3`.
- Before broad test rewrites, check known pitfalls in:
  `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/rstest-compat-pitfalls.md`

## 8. Summarize changes

- Provide a concise change summary and list files touched.
- Call out any remaining manual steps or TODOs.
