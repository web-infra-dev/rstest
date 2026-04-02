---
name: development
description: 'Feature and bug-fix development checklist. Use when implementing a new feature, fixing a bug, or making behavioral changes to ensure nothing is missed before PR.'
metadata:
  internal: true
---

# Feature / Bug-Fix Development Checklist

This skill acts as a **shift-left** gate — catch missing work during development, not at PR review time.

## When to Use

Invoke this checklist when:

- Implementing a new feature or capability
- Fixing a bug that changes observable behavior
- Modifying an existing API or configuration option

## 1. Identify the Change Scope

Before writing code, determine the **blast radius**:

| Question                                        | Action                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| Which packages are touched?                     | List them (`@rstest/core`, `@rstest/browser`, etc.) |
| Does it affect the public API or config schema? | If yes → docs update required                       |
| Does it change behavior in Node mode?           | If yes → unit tests + e2e required                  |
| Does it change behavior in browser mode?        | If yes → browser e2e required                       |
| Could it affect both Node and browser modes?    | Evaluate both; see §3                               |
| Is the config option also present in Rsbuild?   | If yes → adapter sync required; see §4              |

## 2. E2E Tests Are Required

Every behavioral change — feature or bug fix — must have a corresponding e2e test. Unit tests alone are not enough; e2e tests verify the full CLI → runner → reporter pipeline.

### Adding E2E Tests

- **Prefer reusing** an existing fixture when the scenario fits. Add a new test case to the relevant `e2e/<feature>/index.test.ts`.
- **Create a new fixture** only when the scenario needs different config, dependencies, or file layout. Each fixture is a self-contained mini-project:
  ```
  e2e/<feature>/fixtures/<scenario>/
    ├── rstest.config.mts
    ├── tests/
    │   └── example.test.ts
    └── package.json          # only if extra deps needed
  ```
- Run the e2e test against **built output** — rebuild first:
  ```bash
  pnpm --filter @rstest/core build   # rebuild changed packages
  cd e2e && pnpm test <feature>/index.test.ts
  ```

### Bug-Fix Tests

For every bug fix, add a test case that **reproduces the bug first** (verify it fails without the fix), then confirm it passes with the fix applied.

## 3. Evaluate Browser Mode Impact

Not every feature needs browser mode support, but you must **consciously decide** rather than ignore it.

### When Browser Mode Needs Changes

- The feature touches test execution, module resolution, or runtime APIs → likely affects browser mode.
- The feature adds a new config option → check if it should apply in browser mode too.
- The feature modifies the reporter, CLI output, or test filtering → usually Node-only, but verify.

### When Browser Mode Does NOT Need Changes

- Pure Node-specific features (e.g., `process.env` handling, Node module mocking).
- Internal refactors that don't change the runtime contract.

### If Browser Mode Is Affected

1. Update `packages/browser/` if the runtime behavior differs.
2. Add or update browser e2e tests in `e2e/browser-mode/`:
   ```bash
   cd e2e && pnpm test browser-mode/<test>.test.ts
   ```
3. If the feature requires a new browser fixture, follow the pattern in `e2e/browser-mode/fixtures/`.
4. If the feature involves React component testing, check `@rstest/browser-react` as well.

### If Browser Mode Is Not Affected

Add a brief note in the PR explaining **why** browser mode is unaffected, so reviewers don't have to ask.

## 4. Evaluate Adapter Impact

If the new or changed configuration option also exists in Rsbuild, check whether the adapters (`@rstest/adapter-rsbuild`, `@rstest/adapter-rslib`) need to transform it.

### When Adapters Need Updates

- The config option maps to an equivalent Rsbuild/Rslib config field → the adapter must translate it so users' existing Rsbuild configs work seamlessly.
- A new rstest config is introduced that overlaps with Rsbuild concepts (e.g., resolve, output, source) → evaluate whether the adapter should auto-convert.

### Testing Adapters

- If `@rstest/core` already has an e2e test covering the underlying feature, **do not duplicate it** in the adapter package. Prefer a **unit test** inside the adapter package (`packages/adapter-rsbuild/` or `packages/adapter-rslib/`) that verifies the config transformation logic.
- Only add a separate adapter e2e test (`e2e/adapterTransformImport/`) when the transformation itself has complex behavior that unit tests cannot adequately cover.

### Adapter Docs

- Update adapter-specific documentation when a new transform is added, so users know which Rsbuild configs are auto-converted.

## 5. Documentation Must Be Synchronous

Documentation is not a follow-up task — it ships with the code. **Do not merge features without docs.**

### What to Update

| Change Type               | Docs Action                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| New config option         | Add to `website/docs/en/config/` and `website/docs/zh/config/`, and register in `website/theme/components/ConfigOverview.tsx` |
| New runtime API           | Add to `website/docs/en/api/` and `website/docs/zh/api/`                                                                      |
| New feature               | Add guide page in `website/docs/en/guide/` (or appropriate section) and Chinese counterpart                                   |
| Changed behavior          | Update affected docs pages                                                                                                    |
| New CLI flag              | Update CLI reference in `website/docs/en/basic/cli.mdx` and `website/docs/zh/basic/cli.mdx`                                   |
| Migration-relevant change | Update migration guides in `website/docs/en/migration/`                                                                       |
| Browser-specific feature  | Update `website/docs/en/browser-testing/` section                                                                             |

### Docs Conventions

- All docs exist in **both** `en/` and `zh/` — update both languages.
- Use Rspress frontmatter conventions (see existing docs for examples).
- Include code examples that are copy-pasteable.

## 6. Quick Self-Check Before Committing

Run through this before you consider the work done:

- [ ] **Unit tests** cover the new/changed logic in the relevant package
- [ ] **E2E test** covers the feature/fix end-to-end (see §2)
- [ ] **Browser mode** impact evaluated (see §3) — either updated or noted as unaffected
- [ ] **Adapter sync** evaluated (see §4) — config transforms updated or noted as N/A
- [ ] **Docs** updated in both `en/` and `zh/` (see §5)
- [ ] **Types** are correct — no new `any` leaking into public APIs
- [ ] **Build passes** — `pnpm --filter <package> build` succeeds
- [ ] **Existing tests still pass** — `pnpm test` and relevant e2e tests green
