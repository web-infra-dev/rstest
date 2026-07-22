# @rstest/browser

Browser mode support for Rstest. Provides browser test execution using Playwright and a React-based test UI. Host-side scheduling lives in `src/`; the in-browser runner runtime lives in `src/client/` (top-level page in headless runs, iframe in headed runs).

## Boundary map

```
Headed:   runner iframe --postMessage--> browser-ui container --birpc--> host --> dispatchRouter --> namespace handler
Headless: runner top-level page --exposeFunction(__rstest_dispatch__ / __rstest_dispatch_rpc__)--> host (browser-ui not involved)
```

Responses always travel back as transport replies — `dispatchRouter` handles inbound request routing only and never initiates outbound delivery. `dispatchTransport` (client side) owns request ids, timeouts, and pending-response resolution for both transports.

## Contract ownership

- `@rstest/browser` owns host scheduling, dispatch routing, and protocol semantics.
- `@rstest/browser-ui` owns transport bridging and UI state projection only.
- The runner runtime (`src/client`) owns test execution and emits protocol messages, but never owns filesystem access — snapshot file operations go through the `snapshot` dispatch namespace.
- Runner lifecycle events feed `@rstest/core`'s per-project `RunnerEventSink` — the same event pump the node pool uses. The host never fans out to reporters or `stateManager` directly.
- Run finalize is split by command: non-watch runs return a `BrowserTestRunResult` with a deferred `close` and core's `finalizeRunCycle` owns reporters `onTestRunEnd`, coverage merge, and the exit code; watch runs self-finalize host-side per rerun.
- Browser config compatibility (which `RuntimeConfig` fields are supported / ignored / stripped) is declared in core's `executorCapabilities` table; `configValidation.ts` derives its generic warnings and errors from that table instead of hand-maintaining a list. The one exception is `coverage`, a specially handled key with a hand-written v8-provider guard (see the coverage pipeline doc in core).
- Cross-file `bail` is enforced host-side at file boundaries in the headless scheduler (each worker checks the cycle-wide failed count before picking up the next file and drains the remaining queue as skipped). The headed debugging UI does not apply bail; the runner's per-test gate uses the client-local per-file failed count only.

## Runner runtime invariants (`src/client`)

- `entry.ts` is the only bootstrap entry and decides `collect` vs `run` mode.
- Console interception is per test file and must restore the original console methods in `finally`.
- An unhandled window error or `unhandledrejection` that escapes a test file fails the file even when every test passed. The runner deliberately yields macrotasks before finalizing each file result so late-dispatched rejections are still observed — the timing rationale is commented in `entry.ts`.

## Provider-agnostic design

Browser mode must stay provider-neutral at the framework boundary.

- Keep shared config, protocol, scheduling, and public APIs provider-agnostic.
- Treat `browser.providerOptions` as an opaque passthrough at the framework boundary.
- Do not export provider-owned config types from `@rstest/browser` public entrypoints.
- Do not reference optional peer provider modules from public declarations, including `import type` and `import('pkg')` in type positions.
- Keep provider-specific behavior, config decoding, and runtime quirks inside provider implementations whenever possible.
- Prefer direct passthrough to provider APIs over provider-specific post-init translation layers; promote behavior into shared contracts only when it is meaningful across multiple providers.
- When richer DX is needed later, prefer provider-owned helpers or separate optional type entrypoints over coupling the main package surface to a specific provider.

## Commands

```bash
# Build
pnpm --filter @rstest/browser build
pnpm --filter @rstest/browser dev     # Watch mode

# Lint
pnpm --filter @rstest/browser lint
```

## Dependencies

This package requires `@rstest/core` and `playwright` as peer dependencies, and consumes two internal `@rstest/core` entrypoints:

- `@rstest/core/internal/browser-runtime` (client side): `createRstestRuntime`, `setRealTimers`, `globalApis`, and types (WorkerState, RuntimeConfig, etc.)
- `@rstest/core/internal/browser` (host side): logger/color/TTY utilities, `createRunnerEventSink`, and the run-cycle contract types

## Do

- Test browser mode via e2e tests in `e2e/browser-mode/`

## Don't

- Don't duplicate runtime code from @rstest/core
- Don't add node-only features here
- Don't rely on cross-version compatibility of the internal contract with @rstest/core — core's `browserLoader` enforces an exact version match, so cross-package contract changes must land in the same release
- Don't bypass the `RunnerEventSink` for runner lifecycle events (no direct reporter/`stateManager` fanout from the host)
- Don't self-finalize non-watch runs in the host — core's `finalizeRunCycle` owns reporters, coverage, and exit code there
- Don't hand-maintain browser config compatibility lists; add or change rows in core's `executorCapabilities` table instead
- Don't access the filesystem from the runner runtime; proxy through dispatch namespaces
