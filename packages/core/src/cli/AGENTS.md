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
- **opaque provider payload** (`browser.providerOptions`, and the `browser` object that carries it): deep-merge with `plainDeepMerge` (`config.ts`), NOT `mergeRsbuildConfig`. It is third-party data (Playwright launch/context options), so non-plain values (functions, arrays) must be replaced, not chained/concatenated — `mergeRsbuildConfig` would turn `launch.logger.log` into an array and append `launch.args`. `browser` is therefore excluded from the top-level `mergeRsbuildConfig` call and merged separately; never re-add a `{ ...merged.browser, ...config.browser }` spread.
- **`boolean | object` union** (e.g. `output.cleanDistPath`): a boolean flag replacing the object is intentional, not a bug.
- **array** (`include`, `reporters`, ...): replace vs concat is per-option; match siblings. Known inconsistency: most replace, `coverage.exclude` concatenates.

Wildcard options must be registered in `allowedWildcardOptions` (+ `allowedNestedWildcardOptions` for arbitrary-depth objects) in `commands.ts`. Don't CLI-expose an object-typed config field unless its merge deep-merges.

When changing merge behavior, add a test asserting sibling/nested keys survive a partial override.
