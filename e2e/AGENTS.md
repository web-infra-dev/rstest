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

## Validation

- Rebuild affected workspace packages before validating through `e2e/` fixtures when source edits need packaged output.
