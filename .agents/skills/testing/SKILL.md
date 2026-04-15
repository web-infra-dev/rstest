---
name: testing
description: 'Testing workflow for the rstest monorepo. Use when running tests, writing test files, debugging test failures, or validating changes.'
metadata:
  internal: true
---

# Testing Workflow

## Running tests

### Package/unit tests from repository root (single file — preferred)

```bash
pnpm rstest packages/core/tests/core/rsbuild.test.ts
```

Use this form for tests discovered by the root workspace config.
Do **not** pass `e2e/...` paths to the root `pnpm rstest` command.

### Package-level tests

```bash
pnpm --filter @rstest/core test
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts  # single file
```

### E2E tests

Run e2e tests from inside the `e2e/` directory.
When passing the test path, strip the `e2e/` prefix because the working directory is already `e2e/`.

```bash
cd e2e && pnpm test <path-to-test>
```

To run tests in a fixture directory directly:

```bash
cd e2e/<test>/fixtures/<fixture>/ && npx rstest
```

## Rebuild before E2E

E2E tests and examples execute against **built package output**, not TypeScript sources. If you changed package source code, you **must rebuild** before running e2e:

```bash
pnpm --filter @rstest/core build    # or whichever package was changed
cd e2e && pnpm test <path>
```

Forgetting this step means e2e runs against stale output — a common source of false passes/failures.

When the change may affect multiple packages, prefer a full workspace package build first:

```bash
pnpm build
cd e2e && pnpm test <path>
```

Important:

- Do **not** start e2e while any package build is still running.
- Do **not** overlap `pnpm build` and `pnpm e2e` in separate sessions.
- Wait for the build command to exit successfully before starting e2e.
- If e2e fails immediately with a missing built file such as `packages/core/dist/rstestSuppressWarnings.cjs`, treat that as an incomplete build and rebuild before retrying.
- When unsure whether the build is fully finished, verify the expected artifact exists before running e2e.

## Browser E2E

- Fixtures default to `headless: true` — no browser windows locally
- Headed smoke tests are skipped locally by default (CI only)
- To opt in locally: `cd e2e && RSTEST_E2E_RUN_HEADED=true pnpm test browser-mode/basic.test.ts`

## Fixture strategy

- **Prefer reusing** an existing fixture when the scenario can be expressed by extending it
- Add a new fixture only when the scenario truly needs different config, dependencies, or file layout
- Keep fixtures minimal and representative of the behavior under test
- Don't create near-duplicate fixtures just to add one extra test case

## Snapshot policy

- Only update snapshots when the behavioral change is **intentional**
- For package/unit tests from repository root, use `-u` / `--update`: `pnpm rstest -u packages/core/tests/core/rsbuild.test.ts`
- Do **not** use snapshot updates as a default way to silence test failures — investigate first
- When updating, review the snapshot diff to confirm it matches expected changes

## Validation before wrapping up

- Do not stop at targeted tests only. Before finishing a code change, run the narrowest relevant tests first, then decide whether broader validation is needed.
- `pnpm run check-unused` is part of the default validation pass for code changes in this repo. Run it before wrapping up, even when focused tests already pass.
- Treat `check-unused` failures as real regressions unless you have confirmed the reported item is an intentional temporary state.
