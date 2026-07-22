# Rstest CLI

CLI parsing (`commands.ts`) and the CLI → config merge (`init.ts`).

## Config merge contract

Two paths must stay consistent: a later/CLI layer overrides only the leaves it
sets, never wholesale-replaces a nested object an earlier layer owns.

- `mergeWithCLIOptions` (`init.ts`) — CLI options onto the config file.
- `mergeRstestConfig` (`../config.ts`) — config layers (`extends`, projects).

Rules by value shape:

- **scalar / boolean**: assign directly, guarded by `!== undefined` (preserves siblings).
- **rstest-owned object** (mirrors rsbuild config, e.g. `output`, `source`, `pool`): deep-merge via `mergeRsbuildConfig` — its function-chaining / array-concat semantics are intended here.
- **opaque provider payload** (`browser.providerOptions`, and the `browser` object that carries it): deep-merge with `plainDeepMerge` (`../config.ts`), NOT `mergeRsbuildConfig`. It is third-party data (Playwright launch/context options), so non-plain values (functions, arrays) must be replaced, not chained/concatenated — `mergeRsbuildConfig` would turn `launch.logger.log` into an array and append `launch.args`. `browser` is therefore excluded from the top-level `mergeRsbuildConfig` call and merged separately; never re-add a `{ ...merged.browser, ...config.browser }` spread.
- **`boolean | object` union** (e.g. `output.cleanDistPath`): a boolean flag replacing the object is intentional, not a bug.
- **array** (`include`, `reporters`, ...): replace vs concat is per-option; match siblings. Known inconsistency: most replace, `coverage.exclude` concatenates.

Wildcard options must be registered in `allowedWildcardOptions` (+ `allowedNestedWildcardOptions` for arbitrary-depth objects) in `commands.ts`. Don't CLI-expose an object-typed config field unless its merge deep-merges.

When changing merge behavior, add a test asserting sibling/nested keys survive a partial override.

## Config load pipeline

`initCli` (`init.ts`) is the entry for `run`/`watch`/`list`: resolve `--root` against cwd, load + merge the root config, then expand projects. Order per config layer: `loadConfig` (`../config.ts`) → `resolveExtends` → `mergeWithCLIOptions`. Facts that bite:

- A missing config file is not an error — `loadConfig` returns `{}`; only an explicit `--config` path that doesn't exist throws. Discovery probes `rstest.config.*` in the layer's cwd.
- `extends` entries (objects, or functions receiving a frozen copy of the user config) merge via `mergeRstestConfig` with the user config last; `projects` is stripped from every extended entry, and extended `forceRerunTriggers` union with the defaults only when the user didn't set that field.
- CLI options apply to **every** layer, not once: `resolveConfig` merges them into the root config and again into each project — path projects re-enter `resolveConfig`, inline project objects go through `resolveExtends` + `mergeWithCLIOptions`. A CLI flag therefore overrides all projects.
- Two CLI-only behaviors live in `mergeWithCLIOptions`, not `commands.ts`: a `shard` field from a config file is warned about and discarded (only `--shard` counts), and `--changed` defaults `passWithNoTests` to true.
- Agent environments (`determineAgent`) default `reporters` to `['md']` when neither config nor `--reporters` set one — applied to the root config in `initCli` only.

`resolveProjects` (`init.ts`): string entries glob (directories allowed, `node_modules` ignored) or must exist; each path is a directory (config discovered inside) or a config file; results dedupe by resolved config path and recurse into nested `projects`. A project's name defaults to its `package.json` name, then the dir basename; duplicate names, and an empty set after the `--project` filter, are hard errors.

## `rstest init` scaffolding

`init [project]` (`commands.ts`) is unrelated to the run pipeline; the only project type is `browser` (prompted for when omitted). `create` (`init/browser/create.ts`):

- Sniffing (`init/browser/detect.ts`): React from `package.json` deps, TS from `tsconfig.json` existence, test dir probed `tests` → `test` → `__tests__` → `src/__tests__` (default `tests`), package manager via `package-manager-detector` (fallback npm).
- Generates `rstest.browser.config.mts` plus a Counter component + test in the test dir. The config filename has one owner, `getConfigFileName` (`init/browser/templates.ts`) — the `test:browser` script embeds it via `getBrowserTestScript`; keep it that way. The example base name dedupes with `_N` suffixes (`getUniqueBaseName`) — probed against the component file only, so a pre-existing test file without its component is still overwritten — and the test's import is rewritten to match (`rewriteComponentImport`); the config file has no guard at all: an existing `rstest.browser.config.mts` is silently overwritten.
- `package.json`: the `test:browser` script is added or updated in place; devDependencies are added only when absent (`updatePackageJsonDevDeps`), with `@rstest/browser`/`@rstest/browser-react` pinned to `^RSTEST_VERSION` and playwright to the `PLAYWRIGHT_VERSION` build constant.
- `--yes` skips prompts; AI agent environments (`determineAgent`, opt out with `RSTEST_NO_AGENT=1`) are routed to the same non-interactive path automatically. Interactive mode uses `@clack/prompts`.
