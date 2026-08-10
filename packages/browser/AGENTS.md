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
- Runner lifecycle events feed `@rstest/core`'s per-project `RunnerEventSink` — the same event pump the node pool uses. The host never fans out to reporters or `stateManager` directly, and it routes every event by the project name carried on the payload — never derived from a test path, which is ambiguous when concurrent projects run the same file.
- Core's `finalizeRunCycle` owns reporters `onTestRunEnd`, coverage merge, and the exit code for every cycle on both commands. The host never finalizes, and a failing file, a fatal error, and a boot failure all reach core as part of the cycle outcome. The single exit code the host still writes is the one no cycle can carry: a watch launch that finds no test files at all, which can never open a session — core's watch no-test report deliberately leaves the code alone, because a rerun matching nothing is not a failure.
- Watch differs from one-shot only in what the host owns, not in who finalizes: a persistent runtime reused across controller re-entry, the rerun triggers, and HMR. The initial cycle returns a live watch session instead of a deferred `close`, and `executor.close()` is what tears the runtime down.
- Every rerun trigger the host owns (dev rebuild, HMR, the in-page rerun button, an explicit request from a CLI shortcut) resolves its own scope and then signals core's `onInvalidate` subscriber, which calls back into the session to execute exactly that scope. Resolving the scope at the trigger is load-bearing twice over: the file-set diff can only be consumed once, and a trigger that resolves to no work must not signal at all.
- Signalling hands the cycle to core and returns; only an explicit request (a CLI shortcut, the in-page rerun button) waits for the cycle it started, because it has state to restore afterwards. A rebuild trigger must not wait, and the reason is not politeness: it is signalled from inside the bundler's dev-compile hook, and the bundler holds no watcher while that hook is pending — anything created or deleted in that window is never seen again, so a cycle-long hook silently drops test files added or removed mid-run.
- Core queues cycles, so a trigger that arrives while one is still running would otherwise wait out a run the user has already superseded. The headless loop therefore cancels its in-flight run as it signals the replacement scope: the stale cycle finalizes with what it had and the queued one starts immediately. That cancel belongs at the signal, not at the trigger: only the signal knows a replacement cycle is actually coming, and a trigger that resolves to no affected files must leave the running cycle alone.
- Headed run identity has one mint and one comparison. The host mints a `runId` in `HeadedRunRegistry`, synchronously, before the reload RPC leaves the process; the container holds it as a per-frame lease and confers it on whatever document boots into that frame over the config handshake; the runner adopts it once and stamps it beside every message it sends (`RunnerEnvelope` — beside, never inside, so no transport identity ever reaches core reporting or `BlobReporter` output); and the host accepts a message iff its stamped `runId` names a live run, at the single `dispatch` gate. Nothing may re-derive identity from a frame URL, DOM state, React state, or a test path — a path can be deleted and re-added while a run is in flight (same path, different run), and a frame's URL still names the run it was originally navigated for after an HMR full reload (same document slot, different run). Both directions of that ambiguity produced real deadlocks; identity-only matching is what removed the tombstone table and the fallback chains, so reintroducing a secondary identity source reintroduces the ambiguity.
- A headed cycle ends only once every run it minted has settled. Settlement is exactly-once inside `HeadedRunRegistry` (every settler funnels through one guarded delete), and any host action that makes a completion impossible settles the run in the same step: a file-set commit calls `retainPaths` before the container is told (the unmounted frame's completion may already be in transport — its identity is gone from the registry, so the arrival drops by rule), transport death or silent socket replacement settles through `rejectAll` / the transport epoch, and a granted run whose document never boots is bounded by the container's boot deadline reporting `onRunAbandoned`. An unsettled run wedges its cycle and every cycle core has queued behind it, with no error and no disconnect to show for it, so a new way to make a runner unreachable is a new settlement obligation, not just a new log line.
- The host's `retainPaths` sweep and the container's boot-deadline `onRunAbandoned` are not a fallback chain for one fact: they observe different facts (file-set membership vs. document boot) and funnel into the same idempotent settle. Removing either reopens the failure mode it covers.
- Headed watch HMR degenerates to a full reload of every runner iframe (no hot accept anywhere in the runner). A rerun document must execute under the identity the host is awaiting NOW, which is exactly why identity is conferred at document boot from the lease — written synchronously at grant, before any render or navigation — and never read from the document's own URL. The runner URL therefore carries no identity at all; keep it that way.
- The watch control plane is core-owned: core is the single stdin/CLI-shortcuts owner — the host never subscribes to stdin.
- Browser config compatibility (which `RuntimeConfig` fields are supported / ignored / stripped) is declared in core's `executorCapabilities` table; `configValidation.ts` derives its generic warnings and errors from that table instead of hand-maintaining a list. The one exception is `coverage`, which has a hand-written V8 capability guard: native V8 coverage requires Chromium (see the coverage pipeline doc in core).
- Cross-file `bail` is enforced host-side at file boundaries in the headless scheduler (each worker checks the cycle-wide failed count before picking up the next file and drains the remaining queue as skipped). The headed debugging UI does not apply bail; the runner's per-test gate uses the client-local per-file failed count only.

## Runner runtime invariants (`src/client`)

- `runner.ts` is the only bootstrap entry and decides `collect` vs `run` mode.
- Console interception is per test file and must restore the original console methods in `finally`.
- An unhandled window error or `unhandledrejection` that escapes a test file fails the file even when every test passed. The runner deliberately yields macrotasks before finalizing each file result so late-dispatched rejections are still observed — the timing rationale is commented in `runner.ts`.

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
- Don't rely on cross-version compatibility of the internal contract with @rstest/core — core's browser loader (`packages/core/src/core/browser/loader.ts`) enforces an exact version match, so cross-package contract changes must land in the same release
- Don't bypass the `RunnerEventSink` for runner lifecycle events (no direct reporter/`stateManager` fanout from the host)
- Don't self-finalize in the host, on either command — core's `finalizeRunCycle` owns reporters, coverage, and every cycle's exit code
- Don't hand-maintain browser config compatibility lists; add or change rows in core's `executorCapabilities` table instead
- Don't access the filesystem from the runner runtime; proxy through dispatch namespaces
