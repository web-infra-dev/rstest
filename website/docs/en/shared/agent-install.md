# Rstest setup — agent execution prompt

Follow these steps **in order** to add Rstest to the current project.
Read the repository first. Make the smallest correct change.

Fetch a linked doc page **only after** choosing that branch. Do **not** fetch docs for branches you did not select.

## Guardrails

- Always install `@rstest/core`. Config file is always `rstest.config.ts` (even in JS projects).
- Only add framework plugins, DOM environments, or browser support when the code under test actually needs the transform — not just because `react` or `vue` appears in `dependencies`.
- Do **not** replace existing Jest/Vitest `test` scripts unless migration is clearly intended — add `"test:unit": "rstest"` or similar instead.
- If the package already has Jest/Vitest tests and migration is **not** intended, use `include` (https://rstest.rs/config/test/include.md) to target only Rstest's own tests so it does not discover tests written for another runner.
- If migration **is** intended, follow the migration guide instead of this prompt: Jest → https://rstest.rs/guide/migration/jest.md / Vitest → https://rstest.rs/guide/migration/vitest.md
- Do **not** reuse Jest/Vitest setup files blindly — only add a setup file (https://rstest.rs/config/test/setup-files.md) if the selected Rstest docs require it and the contents are compatible.
- If `@rstest/core` or `rstest.config.ts` already exists, extend the existing setup minimally instead of recreating it.
- Do **not** generate placeholder tests (e.g., `test('placeholder', () => {})`). A real verification test is fine when no tests exist — see Step 8.
- When signals conflict, the project's existing test/build setup takes precedence.

## Step 0 — Repo-wide inventory (no changes yet)

Before editing anything, determine:

- Package manager (from lockfile, or `packageManager` field in root `package.json`)
- Whether this is a monorepo (`pnpm-workspace.yaml`, `workspaces` in `package.json`, `turbo.json`, `nx.json`)
- Whether Rstest is already present anywhere (`@rstest/core`, `rstest.config.ts`, scripts)
- Whether an existing test runner (Jest/Vitest) is in use — if migration is intended, stop here and follow the migration guide (see Guardrails)

## Step 1 — Find the owning package

Choose in this order:

1. Package containing the source files being tested
2. Package containing existing tests for that source
3. Package containing the relevant build config
4. If single-package repo, the root

Note: deps, config, and scripts may live in different places. Determine separately:

- **Config and test files** → always in the owning package.
- **devDependencies and scripts** → in the owning package, unless the repo centralizes them at the workspace root — follow that convention.
- **Validate from** → wherever the test script lives.

## Step 2 — Package-scoped inventory

Now inspect the owning package:

- Source/test file extensions (`.ts`/`.tsx`/`.mts` vs `.js`/`.jsx`/`.mjs`)
- Build tool in scope (`rsbuild.config.*`, `rslib.config.*`, or neither)
- Existing test file naming and location
- Whether tests need Node only, simulated DOM, or real browser APIs

## Step 3 — Detect language

Determine from the owning package's **actual source/test file extensions** first. Use `tsconfig.json` or `typescript` dep only as a tiebreaker.

- TypeScript → `.ts` / `.tsx` test files.
- JavaScript → `.js` / `.jsx` test files.

## Step 4 — Detect build tooling → pick adapter

An adapter auto-inherits plugins, aliases, and build config. If using an adapter, follow that guide first — only fetch a framework guide if the adapter guide does not already cover the required setup.

- **Rsbuild project** (has `rsbuild.config.*` or `@rsbuild/core` dep) → follow https://rstest.rs/guide/integration/rsbuild.md
- **Rslib project** (has `rslib.config.*` or `@rslib/core` dep) → follow https://rstest.rs/guide/integration/rslib.md
- **Neither** → no adapter; configure Rstest standalone (continue below).

When using an adapter you may still need to set `testEnvironment` or `browser` — the adapter does not decide those.

## Step 5 — Choose test environment

Decide based on what the tests actually need, not solely from framework deps in `package.json`. See https://rstest.rs/config/test/test-environment.md for all options.

### A. No DOM APIs needed → Node (default)

Omit `testEnvironment`. No extra deps. If not using an adapter and no other options are needed:

```ts
import { defineConfig } from '@rstest/core';
export default defineConfig({});
```

### B. DOM APIs needed, simulated DOM is sufficient → `happy-dom` / `jsdom`

Use for tests that render components or rely on DOM APIs.

- If the project already depends on `jsdom` or `happy-dom`, follow that choice.
- Otherwise default to `happy-dom` (lighter).
- **React** → follow https://rstest.rs/guide/framework/react.md
- **Vue** → follow https://rstest.rs/guide/framework/vue.md

### C. Real browser behavior needed → Browser Mode (experimental)

Choose **only** when tests explicitly require Canvas, WebGL, CSS computed styles, Web Workers, or cross-browser testing. This is opt-in, not a default escalation. Vue Browser Mode is **not yet supported**. See https://rstest.rs/config/test/browser.md for all options.

→ Follow https://rstest.rs/guide/browser-testing/getting-started.md
→ For React component testing in browser, also follow https://rstest.rs/guide/browser-testing/framework-guides.md

## Step 6 — Install dependencies

Use the repo's existing package manager (`pnpm add -D`, `npm i -D`, `yarn add -D`, `bun add -d`) based on the lockfile. Fall back to the `packageManager` field in root `package.json` if no lockfile exists. Install only packages justified in previous steps.

## Step 7 — Create config

Keep it minimal — include **only** options justified by detection.
→ See https://rstest.rs/guide/basic/configure-rstest.md only if the selected guide above does not fully specify the config.

Config examples are in the guide pages linked in Steps 4–5. Do not copy examples blindly.

## Step 8 — Update scripts

If migration is intended, you should already be following the migration guide — skip this step.

- Do not overwrite any existing test-related script. Add a new non-conflicting name.
- **No test script** → add `"test": "rstest"`.
- **`test` exists (Jest/Vitest)** → add `"test:unit": "rstest"` or similar.
- **Browser Mode** → consider a dedicated `"test:browser"` script.
- Preserve the repo's naming conventions.

## Step 9 — Verification test (only if needed)

Only if no tests exist and verification is needed:

- Add **one** small test for a real exported function or module. Prefer a function/module over a UI component to avoid introducing extra test utilities.
- Match existing naming (`*.test.*` vs `*.spec.*`), placement, and language.
- If no convention, colocate next to the source file.
- If there is no small, deterministic real export to test, skip this step.

## Step 10 — Validate

Run the test command from wherever the test script lives. If it fails, read the error and fix — do not leave a broken setup. If no tests exist and you skipped Step 9, confirm the setup is valid (config loads, `rstest --passWithNoTests` or equivalent succeeds).
