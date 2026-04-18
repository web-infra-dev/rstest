# Rstest setup — agent execution prompt

Set up Rstest in a project that doesn't have a test runner configured yet. Pick the target, detect what it needs, install, verify.

## Prerequisite check

If the target already has Jest or Vitest configured (any of the signals below), **STOP this prompt and fetch https://rstest.rs/guide/start/agent-migrate.md instead** — migration has its own flow:

- A `jest.config.{js,ts,cjs,mjs,cts,mts,json}` or `vitest.config.{js,ts,cjs,mjs,cts,mts,json}`.
- A `jest` / `@jest/globals` / `ts-jest` / `vitest` dep, or an inline `"jest"` / `"vitest"` field in `package.json`.
- A `test` script invoking `jest` / `vitest`.
- A workspace root with hoisted Jest/Vitest deps or config that affect this target.
- The user asked to migrate from Jest/Vitest, or to keep Jest/Vitest and add Rstest side-by-side.

Otherwise, continue below.

## Section 1 — pick the target

All work in this prompt happens inside a single **target package**.

**Single-package repo** → the target is the repo root.

**Monorepo** (signals: `pnpm-workspace.yaml`, `workspaces` in root `package.json`, `turbo.json`, `nx.json`):

- If the user named a specific package (by path, package name, or source file), that package is the target.
- If the user expressed repo-wide scope ("this monorepo", "the whole repo", "every package", "all packages") **and** at least one package has Jest/Vitest signals, **STOP this prompt and fetch https://rstest.rs/guide/start/agent-migrate.md instead** — that flow iterates per package and handles heterogeneity.
- Otherwise, **STOP this prompt and ask**:

  > This is a monorepo. Rstest setup is applied to one package at a time. Which package should Rstest go in — the workspace root, or a specific package (e.g. `packages/foo`)?

## Section 2 — detect

All detection below runs inside the target.

### 2.1 Language

Determine from the target's **actual source/test file extensions** first. Only fall back to `tsconfig.json` presence or `typescript` in deps when extensions are mixed or absent.

- TypeScript → `.ts` / `.tsx` test files.
- JavaScript → `.js` / `.jsx` test files.

### 2.2 Build tool (→ pick adapter)

- **Rsbuild project** (`rsbuild.config.*` or `@rsbuild/core` dep) → follow https://rstest.rs/guide/integration/rsbuild.md
- **Rslib project** (`rslib.config.*` or `@rslib/core` dep) → follow https://rstest.rs/guide/integration/rslib.md
- **Neither** → configure Rstest standalone.

An adapter auto-inherits plugins, aliases, and build config. Even with an adapter you still need to decide `testEnvironment` or browser mode from 2.3 — adapters do not decide those. If 2.3 picks Browser Mode, that takes precedence over adapters.

### 2.3 Test environment

Decide based on what the target's tests actually need, not solely from framework deps in `package.json`. See https://rstest.rs/config/test/test-environment.md for all options.

#### A. No DOM APIs needed → node (default)

Omit `testEnvironment`. No extra deps. If not using an adapter and no other options are needed:

```ts
import { defineConfig } from '@rstest/core';
export default defineConfig({});
```

#### B. DOM APIs needed, simulated DOM is sufficient → `happy-dom` / `jsdom`

Pick B only if any of these hold for the target's source/test code:

- Imports JSX or a UI framework (`react`, `react-dom`, `vue`, `@vue/*`, `svelte`, `solid-js`, `preact`, `lit`).
- Directly references `document`, `window`, `navigator`, `localStorage`, or other DOM globals.
- The user's request explicitly mentions component/UI testing.

If none of the above hold, stay on A. Seeing `react` in `dependencies` alone is not sufficient.

- If the target already depends on `jsdom` or `happy-dom`, follow that choice. Otherwise default to `happy-dom` (lighter).
- **React** → follow https://rstest.rs/guide/framework/react.md
- **Vue** → follow https://rstest.rs/guide/framework/vue.md
- Other frameworks (Svelte, Solid, Preact, Lit, etc.) → apply the same DOM-environment reasoning and install the framework's standard compiler/plugin if the adapter doesn't already cover it. Keep config minimal.

#### C. Real browser behavior needed → browser mode (experimental)

Choose **only** when tests explicitly require Canvas, WebGL, CSS computed styles, Web Workers, or cross-browser testing. This is opt-in, not a default escalation. Vue Browser Mode is **not yet supported**. See https://rstest.rs/config/test/browser.md.

→ **STOP this prompt.** Fetch https://rstest.rs/guide/browser-testing/getting-started.md and follow it end-to-end — Browser Mode has its own setup flow that replaces Sections 3–4. For React component testing in browser, also fetch https://rstest.rs/guide/browser-testing/framework-guides.md.

## Section 3 — install and configure

All edits are scoped to the target package. If the target already has `@rstest/core`, `rstest.config.ts`, or an `rstest` script, extend it minimally instead of recreating it.

- Always install `@rstest/core`. Add any framework plugin / DOM environment justified in Section 2. Use the repo's package manager (pnpm: `pnpm --filter <target> add -D <pkg>`; npm: `npm i -D <pkg> -w <target>`; yarn: `yarn workspace <target> add -D <pkg>`; bun: `bun add -d <pkg> --filter <target>`). For a single-package repo, drop the workspace flag.
- Config file is always `rstest.config.ts` (even in JS projects), placed in the target directory. Keep it minimal — include only options justified by Section 2. Do not copy examples blindly; see https://rstest.rs/guide/basic/configure-rstest.md only if the guides linked from Section 2 don't fully specify the config.
- Add `"test": "rstest"` to the target's `package.json`. Preserve existing naming conventions.

## Section 4 — verify

- Run the target's test command from wherever the target's test script lives. If it fails, read the error and fix — do not leave a broken setup.
- If the target has **zero** test files, add one small real test before running:
  - Prefer a real exported function/module over a UI component (to avoid extra test utilities).
  - Match existing naming (`*.test.*` vs `*.spec.*`), placement, and language. If no convention exists, colocate next to the source file.
  - Do not write placeholder tests (e.g. `test('placeholder', () => {})`). If no small deterministic export exists, skip the test and rely on `rstest --passWithNoTests`.
