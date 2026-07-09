---
name: development
description: Feature and bug-fix development checklist for the Rstest monorepo. Use when implementing a new feature, fixing a bug, changing public APIs/config/CLI behavior, addressing a GitHub issue or PR request, or assessing cross-package impact before a PR.
metadata:
  internal: true
---

# Feature / Bug-Fix Development Checklist

This skill is a checklist of **guardrails** for feature and bug-fix work — reminders to catch missing work during development, then hand off to the more specific workflow when needed. The sections roughly follow a task's lifecycle for easy reading, but treat them as prompts to apply where relevant, not a rigid pipeline.

## Confirm Intent & Scope

Decide what the task actually is before doing any work.

- If the request is phrased as "review / verify / assess", treat it as **investigation** — report findings and confirm before implementing anything.
- When the user enumerates a subset ("only the low items", "core field only", "先只加 skip"), implement exactly that subset and stop.
- If a fix would span multiple clusters or packages, estimate file/PR size and confirm scope before writing code. Keep one PR per coherent seam.

## Build Verified Context

Gather the real inputs and ground every claim in something you read **this session** — never answer from memory or impression.

- For GitHub issues/PRs/checks/reviews, read the linked context before editing; do not implement from the title alone.
- For external repros, read README/scripts/deps and reproduce with the smallest command first.
- Identify the smallest user-visible behavior, the affected package(s), and the validation path.
- Behavioral, root-cause, version, or package-name claims must cite `path:line` — never answer from recall.
- To answer "how does vitest/jest/rsbuild/rspack behave?", read the **latest upstream source, not the built `node_modules` dist**: if a local clone exists (e.g. `~/Projects/vitest`), bring it up to the latest default branch before reading (`git pull` — a `git fetch` alone leaves the working tree stale); otherwise shallow-clone fresh (vitest → `vitest-dev/vitest`; rsbuild/rspack → `web-infra-dev/{rsbuild,rspack}`; `npm view <pkg> repository` finds others). Prefer a subagent for the lookup.
- If you cannot verify, say so explicitly instead of guessing.

## Map the Blast Radius

Before writing code, determine what the change reaches:

| Question                                        | Action                                                 |
| ----------------------------------------------- | ------------------------------------------------------ |
| Which packages are touched?                     | List them (`@rstest/core`, `@rstest/browser`, etc.)    |
| Does it affect the public API or config schema? | If yes → docs update required                          |
| Does it change behavior in Node mode?           | If yes → unit tests + e2e required                     |
| Does it change behavior in browser mode?        | If yes → browser e2e required; see Browser Mode Impact |
| Could it affect both Node and browser modes?    | Evaluate both; see Browser Mode Impact                 |
| Is the config option also present in Rsbuild?   | If yes → adapter sync required; see Adapter Impact     |

### Public API / Config / CLI Checklist

For public API/config/CLI changes, check the full surface in one pass:

1. Canonical type/default/normalization/runtime consumer.
2. CLI flag/help/output/error text when applicable.
3. Adapters (`rsbuild`, `rslib`, `rspack`), browser mode, and docs (`en`, `zh`, `ApiMeta`) impact.
4. Unit tests for internals/transforms; e2e tests for user-facing behavior.

## Implement the Minimal Root-Cause Fix

Make the smallest **design** change that resolves the root cause — this is where design-scope decisions belong. For in-file code quality (`any`/`as`, defensive checks, one-use abstractions, single source of truth, catch-and-rethrow), defer to the `typescript` skill rather than restating its rules here.

- Fix at the single origin of the bug with the fewest lines. Find the one source, not N symptoms.
- Do **not** add new config knobs, buffers, heuristics, timeouts, dependencies, abstractions, or mode-specific hacks (e.g. string-replacing the Rspack runtime) unless the user asks. Surface any such need as an explicit decision point or follow-up issue — never take the shortcut silently.
- Before adding a top-level config option, prove the existing channel (`inlineConfig` / run params) cannot express it.
- When aligning behavior with another tool, match the reference impl as the parity target — read its **source** (the latest upstream clone, per Build Verified Context), not the `node_modules` dist. Don't harden edges beyond it.

## Prove It Empirically

Every behavioral change — feature or bug fix — must have a corresponding e2e test. Unit tests alone are not enough; e2e tests verify the full CLI → runner → reporter pipeline.

Decide _whether_ test work is required here. For test layout, fixture strategy, rebuild requirements, and exact commands, switch to the `testing` skill.

### When Test Work Is Required

- New feature or config behavior → add or extend an e2e test that exercises the user-facing flow.
- Bug fix → add a regression test that fails before the fix and passes after it.
- Internal refactor with no observable behavior change → evaluate whether existing coverage is enough, and note why if no new test is added.

### Bug-Fix Tests (Flip-and-Verify)

Prove the repro both ways before claiming a fix:

1. Run the repro against `origin/main` (unfixed) → confirm it **fails**.
2. Run the same repro with your fix applied → confirm it **passes**.
3. Add the regression test that captures this delta.

Never present a hypothesis as a conclusion — state confidence explicitly; "I believe" is not "verified".

## Browser Mode Impact

Not every feature needs browser mode support, but you must **consciously decide** rather than ignore it.

### When Browser Mode Needs Changes

- The feature touches test execution, module resolution, or runtime APIs → likely affects browser mode.
- The feature adds a new config option → check if it should apply in browser mode too.
- The feature modifies the reporter, CLI output, or test filtering → usually Node-only, but verify.

### When Browser Mode Does NOT Need Changes

- Pure Node-specific features (e.g., `process.env` handling, Node module mocking).
- Internal refactors that don't change the runtime contract.

### If Browser Mode Is Affected

1. Keep ownership clear: `@rstest/browser` = host/protocol/scheduling, `@rstest/browser-ui` = UI, runner/runtime = execution semantics, provider packages = provider behavior.
2. Update `packages/browser/` if the runtime behavior differs.
3. Add or update browser e2e coverage via the `testing` skill.
4. If the feature requires a new browser fixture, follow the pattern in `e2e/browser-mode/fixtures/`.
5. If the feature involves React component testing, check `@rstest/browser-react` as well.

### If Browser Mode Is Not Affected

Add a brief note in the PR explaining **why** browser mode is unaffected, so reviewers don't have to ask.

## Adapter Impact

If the new or changed configuration option also exists in Rsbuild, check whether the adapters (`@rstest/adapter-rsbuild`, `@rstest/adapter-rslib`) need to transform it.

### When Adapters Need Updates

- The config option maps to an equivalent Rsbuild/Rslib config field → the adapter must translate it so users' existing Rsbuild configs work seamlessly.
- A new rstest config is introduced that overlaps with Rsbuild concepts (e.g., resolve, output, source) → evaluate whether the adapter should auto-convert.

### Testing Adapters

- If `@rstest/core` already has an e2e test covering the underlying feature, **do not duplicate it** in the adapter package. Prefer a **unit test** inside the adapter package (`packages/adapter-rsbuild/` or `packages/adapter-rslib/`) that verifies the config transformation logic.
- Only add a separate adapter e2e test (`e2e/adapterTransformImport/`) when the transformation itself has complex behavior that unit tests cannot adequately cover.

### Adapter Docs

- Update adapter-specific documentation when a new transform is added, so users know which Rsbuild configs are auto-converted.

## Keep Docs In Sync

Documentation is not a follow-up task — it ships with the code. **Do not merge features without docs.**

### Route The Docs Work

- Public API, config, CLI, or behavior changes usually require docs updates.
- Treat this as the routing step: identify that docs must be updated, then inspect the existing docs structure under `website/docs/en/` and `website/docs/zh/` to edit the right pages.
- If the change introduces a new docs surface or convention, follow the established structure in the surrounding guide/config/api pages instead of guessing a new location.

### Docs Conventions

- All docs exist in **both** `en/` and `zh/` — update both languages.
- Use Rspress frontmatter conventions (see existing docs for examples).
- When adding `ApiMeta` markers for a new API or config option, default `addedVersion` to the current package version with its patch segment incremented by 1. For example, if `@rstest/core` is currently `0.10.6`, a newly documented core API should use `<ApiMeta addedVersion="0.10.7" />`.
- Include code examples that are copy-pasteable.
- **Signature fidelity:** if you changed a public type in `packages/core/src/types/`, or edited a `**Type:**` / `**类型：**` block, run the `api-doc-sync` skill. The doc signatures are hand-written copies of the real types and drift silently (missing overloads, wrong arg order, en/zh divergence); `api-doc-sync` grounds them against source and `tsc`.

## Self-Check Before Committing

Run through this before you consider the work done:

- [ ] **Unit tests** cover the new/changed logic in the relevant package
- [ ] **E2E test** covers the feature/fix end-to-end (see Prove It Empirically)
- [ ] **Browser mode** impact evaluated — either updated or noted as unaffected
- [ ] **Adapter sync** evaluated — config transforms updated or noted as N/A
- [ ] **Docs** updated in both `en/` and `zh/`
- [ ] **Public type surface matches docs** — TS declarations and `website/docs/{en,zh}` agree (e.g. `TestOptions.timeout?: number` is reflected for `describe`/`test`)
- [ ] **Types** are correct — no new `any` leaking into public APIs (rule owned by the `typescript` skill)
- [ ] **Unused exports / files checked** — run `pnpm run check-unused` before wrapping up
- [ ] **Build passes** — `pnpm --filter <package> build` succeeds
- [ ] **Existing tests still pass** — `pnpm test` and relevant e2e tests green

## Handle Review Feedback by Redesign

Review feedback arrives after you commit — resolve it by redesign, not more local patches.

- When 2+ review comments hit the same code region or invariant, stop and assess for a single root-cause redesign before applying more local patches.
- Flag any fix that creates the next finding (self-inflicted), and any field/option consumed only by tests — both are smells that the patch moved the bug rather than fixing it.
