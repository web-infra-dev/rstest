# Migrate to Rstest

## Goal

Migrate Jest- or Vitest-based tests and configuration to Rstest with minimal behavior changes.

## Migration principles (must follow)

1. **Smallest-change-first**: prefer the smallest viable change that restores test pass.
2. **Config before code**: prefer fixing in config/tooling/mocks before touching test logic.
3. **Do not change user source behavior**: avoid modifying production/business source files unless user explicitly requests it.
4. **Avoid bulk test rewrites**: do not refactor entire test suites when a local compatibility patch can solve it.
5. **Preserve test intent**: keep assertions and scenario coverage unchanged unless clearly broken by framework differences.
6. **Two-phase legacy-runner lifecycle (per migrated scope)**: (a) While the scope being migrated is not green on Rstest, keep every Jest/Vitest dep + config/setup/workspace file untouched — they are your rollback path. (b) Once that scope is green, delete its scope-local legacy config/setup files in the same commit. Drop the shared legacy devDeps (`jest`, `vitest`, adapters, environments) only when no other scope still relies on them — in a partial / mixed-mode monorepo migration that means the final scope, not the first. Leaving files behind "for reference" creates two source-of-truth configs. Framework-specific file enumeration: see the deltas reference.
7. **Literal API substitution, no shims**: rewrite every `vi.` / `jest.` / `vitest.` call site — no global aliasing, no local rebinding, no aliased imports. Full forbidden-form list and reasoning in `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/global-api-migration.md`.
8. **Replace on call sites, not strings**: match only identifiers preceding `(`; after every batch edit, grep `describe\(|it\(|test\(` to confirm no test name string was mutated. Regex template and rationale in `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/global-api-migration.md`.
9. **Coverage thresholds are not negotiable**: never lower `coverage.thresholds` (lines/functions/branches/statements) to make a migrated suite pass. If thresholds fail under Rstest, investigate `coverage.include` / `exclude` / provider wiring before touching the numbers.

## Workflow

1. Detect current test framework (`https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/detect-test-framework.md`)
2. Dependency install gate (blocker check, see `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/dependency-install-gate.md`)
3. Open the framework-specific deltas file and the official migration guide it points to. Prefer the `.md` URL form when fetching — Rstest pages provide Markdown variants that are more AI-friendly.
   - Jest: `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/jest-migration-deltas.md`
   - Vitest: `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/vitest-migration-deltas.md`
   - Global API replacement rules: `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/global-api-migration.md`
4. Apply the mapping from the official guide + the skill-side enforcement rules from the deltas file
5. Check type errors
6. Run tests and fix deltas
7. Apply cleanup phase of principle 6 once the migrated scope is green (delete scope-local legacy config/setup in the same commit; drop shared legacy devDeps only when no other scope still relies on them; framework-specific file list is in the deltas file)
8. Summarize changes

## Detect current test framework

See `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/detect-test-framework.md` for detection signals and the mixed-mode scope policy.

## Dependency install gate (blocker check)

Before large-scale edits, verify dependencies can be installed and test runner binaries are available. Detailed checks, blocked-mode output format, and `ni` policy are in `https://raw.githubusercontent.com/rstackjs/agent-skills/main/skills/migrate-to-rstest/references/dependency-install-gate.md`.

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

Principles 6–9 above are themselves red lines — the bullets below cover the scope / intent red lines not captured there:

- Do not rewrite many tests in one sweep without first proving config-level fixes are insufficient.
- Do not alter business/runtime behavior to satisfy tests.
- Do not change assertion semantics just to make tests pass.
- Do not broaden migration to unrelated packages in a monorepo.

### Escalation rule for large edits

If a fix would require either:

- editing many test files, or
- changing user source files,

stop and provide:

1. why minimal fixes failed,
2. proposed large-change options,
3. expected impact/risk per option,
4. recommended option.

## Run tests and fix deltas

- Run the test suite and fix failures iteratively.
- Fix configuration and resolver errors first, then address mocks/timers/snapshots, and touch test logic last.
- If mocks fail for re-exported modules under Rspack, first check whether the project is pinned to `rstest < 0.9.3` (fixed in 0.9.3 — upgrade before debugging mock behavior further).

## Summarize changes

- Provide a concise change summary and list files touched.
- Call out any remaining manual steps or TODOs.
