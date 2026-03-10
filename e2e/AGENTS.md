# E2E tests

Integration and end-to-end coverage for Rstest features.

## Do

- Prefer reusing an existing fixture when the new scenario can be expressed by extending it with a small, focused test file.
- Add a new fixture only when the scenario truly needs different config, dependencies, or file layout.
- Keep fixtures minimal and representative of the behavior under test.
- Prefer targeted e2e runs over full suites while iterating.

## Don't

- Don't create near-duplicate fixtures just to add one extra test case.
- Don't expand fixture scope beyond the behavior the e2e is meant to cover.

## Browser e2e tests

Browser-mode e2e fixtures set `headless: true` in their `rstest.config.ts` so no browser windows pop up locally. A few "headed smoke tests" (tests that explicitly need a visible browser, e.g. viewport assertions) are **skipped locally by default** and only run on CI. To opt in to headed smoke tests locally:

```bash
RSTEST_E2E_RUN_HEADED=true pnpm rstest browser-mode/basic.test.ts
```
