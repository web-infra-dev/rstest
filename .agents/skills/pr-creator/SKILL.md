---
name: pr-creator
description: Use when asked to create a pull request for this repository. It helps the PR follow the repository's branch safety rules, title convention, pull request template, and concise English writing style.
---

# Pull Request Creator

## Steps

1. Confirm the current branch with `git branch --show-current`.
   If it is the default branch, create and switch to a new branch before doing anything else.
   Use a descriptive branch name, preferably `feat-<topic>` or `fix-<topic>`.

2. Review local changes with `git status --short`.
   Before creating the PR, ensure the intended changes are committed and never commit directly on the default branch.

3. Check PR readiness before writing:
   - For existing PRs or CI/review/issue fixes, read PR context, comments, checks/logs, and linked repros before summarizing.
   - Confirm API/config changes mention docs, tests, and adapter/browser impact when relevant.
   - For performance or dependency changes, include benchmark data or release/changelog links when available.

4. If `.github/PULL_REQUEST_TEMPLATE.md` exists, read it and follow its structure.

5. Draft the PR title in the repository's standard format. If the repository uses Conventional Commits, common patterns include:
   - `feat(core): add ...`
   - `fix(types): ...`
   - `docs: ...`
   - `refactor(types): ...`
   - `chore(deps): ...`
   - `release: v1.2.0`

6. Write the PR body in concise, clear English.
   - In `Summary`, explain the change context first: the user-facing problem, maintenance goal, or compatibility constraint that makes the change necessary.
   - Prioritize high-signal information: public API changes, behavior changes, breaking changes, migration notes, and important compatibility implications.
   - Then describe the main implementation change only as much as needed to understand the review.
   - Keep it short: one compact paragraph or 2-4 bullets is usually enough.
   - Avoid low-signal sections such as `Test plan` or `Validation`, routine verification commands, generated file lists, or obvious implementation details unless the repository template explicitly requires them or the change has unusual validation risk.
   - Good background examples:
     - `This PR adds support for custom logger injection so CLI output can be isolated per instance.`
     - `This PR fixes incorrect padding in URL labels to keep terminal output aligned across different label lengths.`
     - `This PR updates the English docs to clarify how the extraction option works and when to enable it.`

7. Fill `Related Links` with issue links, design docs, related PRs, discussion pages, or release notes.
   If the PR upgrades an npm dependency, add a link to the upgraded version's release notes or tag page when available.
   Example: `https://github.com/web-infra-dev/rspack/releases/tag/v1.0.0`
   If there is no relevant link, omit the entire `Related Links` section from the PR body.

8. Push the branch only after re-checking the branch name. Never push the default branch directly.

9. Create the PR with `gh pr create`.

## Constraints

- Do not modify code while following this skill.
