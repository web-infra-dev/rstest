# @rstest/browser

Browser mode support for Rstest. Provides browser test execution using Playwright and a React-based test UI.

## Architecture deep dive

- Host scheduling internals: `src/AGENTS.md`
- Runner runtime and transport internals: `src/client/AGENTS.md`

## Architecture overview and cross-package contract

```mermaid
flowchart LR
  subgraph Host["package: @rstest/browser"]
    H1[hostController.ts]
    H2[dispatchRouter.ts]
    H3[namespace handlers]
  end

  subgraph UI["package: @rstest/browser-ui"]
    U1[useRpc birpc]
    U2[channel.ts]
    U3[main.tsx message listener]
  end

  subgraph RunnerRuntime["module: @rstest/browser src/client"]
    R1[send lifecycle]
    R2["dispatch rpc request — snapshot.ts / browserRpc.ts via dispatchTransport.ts"]
    R3["dispatchTransport.ts pending-request resolver"]
  end

  H1 -->|inject host config| U1
  H1 -->|birpc callbacks| U1
  U1 -->|birpc calls| H1

  R1 -->|postMessage __rstest_dispatch__| U3
  U3 -->|onTest* callbacks| U1

  R2 -->|postMessage dispatch rpc request| U2
  U2 -->|rpc.dispatch(request)| U1
  U1 -->|dispatch(request)| H1
  H1 -->|routing inbound request| H2
  H2 -->|resolve namespace handler| H3
  H3 -->|return handler result| H2
  H2 -->|routing done response payload| H1
  H1 -->|dispatch response| U1
  U1 -->|return BrowserDispatchResponse| U2
  U2 -->|postMessage dispatch response| R3

  H1 -->|headless bridge __rstest_dispatch__| R1
  H1 -->|headless bridge __rstest_dispatch_rpc__| R2
```

This diagram is the package-level quick overview and the contract boundary map.
`dispatchRouter` handles inbound request routing only; outbound delivery is transport reply.

Contract ownership:

- `@rstest/browser` owns host scheduling, dispatch routing, and protocol semantics.
- `@rstest/browser-ui` owns transport bridging and UI state projection only.
- Runner runtime (`src/client`) owns test execution and emits protocol messages, but does not own filesystem access.
- Runner lifecycle events (file/suite/case start + result, console logs) feed `@rstest/core`'s per-project `RunnerEventSink` — the same event pump the node pool uses. The host never fans out to reporters or `stateManager` directly.
- Run finalize is split by command: in non-watch runs core's `finalizeRunCycle` owns reporters `onTestRunEnd`, coverage merge, and the exit code (the host returns a `BrowserTestRunResult` with a deferred `close`); watch runs self-finalize host-side per rerun.
- Browser config compatibility (which `RuntimeConfig` fields are supported / ignored / stripped) is declared in core's `executorCapabilities` table; `src/configValidation.ts` derives its warnings and errors from that table instead of hand-maintaining a list.

## Provider-agnostic design

Browser mode must stay provider-neutral at the framework boundary.

- Keep shared config, protocol, scheduling, and public APIs provider-agnostic.
- Treat `browser.providerOptions` as an opaque passthrough at the framework boundary.
- Do not export provider-owned config types from `@rstest/browser` public entrypoints.
- Do not reference optional peer provider modules from public declarations, including `import type` and `import('pkg')` in type positions.
- Keep provider-specific behavior, config decoding, and runtime quirks inside provider implementations whenever possible.
- Prefer direct passthrough to provider APIs over provider-specific post-init translation layers. If a capability cannot be expressed as passthrough, only promote it when the behavior is meaningful across multiple providers.
- Do not introduce new shared abstractions for a single provider convenience; promote behavior into shared contracts only when it is meaningful across multiple providers.
- When richer DX is needed later, prefer provider-owned helpers or separate optional type entrypoints over coupling the main package surface to a specific provider.

## Module structure

- `src/index.ts` — Package entry, exports runBrowserTests, listBrowserTests, and validateBrowserConfig
- `src/hostController.ts` — Main browser mode controller (runtime bootstrap + headless/headed scheduling)
- `src/configValidation.ts` — Browser config validation pass driven by core's `executorCapabilities` table
- `src/protocol.ts` — Type definitions for browser-host communication protocol
- `src/dispatchRouter.ts` — Host-side dispatch namespace router
- `src/dispatchCapabilities.ts` — Shared built-in dispatch capability registration (`runner`, `snapshot`, extension namespaces)
- `src/runSession.ts` — Run token lifecycle and cancellation semantics
- `src/sessionRegistry.ts` — Session index keyed by `sessionId`/`testFile`/`runToken`
- `src/concurrency.ts` — Shared headless worker concurrency policy
- `src/headlessTransport.ts` — Top-level headless page bridge wiring (`__rstest_dispatch__` / `__rstest_dispatch_rpc__`)
- `src/headlessLatestRerunScheduler.ts` — Latest-wins rerun scheduling for headless watch mode
- `src/headedSerialTaskQueue.ts` — Serial task queue for the single headed container page
- `src/watchRerunPlanner.ts` — Shared watch rerun planning logic across headless/headed paths
- `src/rpcProtocol.ts` — Locator IR and Browser RPC request/response types (`browser` dispatch namespace)
- `src/browserRpcRegistry.ts` — Host-side allowlists for Browser RPC methods (locator actions, assertions)
- `src/augmentExpect.ts` — `expect.element` locator assertion typing
- `src/browser.ts` — `@rstest/browser/browser` entry re-exporting the client `page`/locator API
- `src/viewportPresets.ts` — Viewport preset source of truth (kept in sync with core's `DevicePreset` type)
- `src/watchCliShortcuts.ts` — Watch-mode CLI shortcut hints for browser runs
- `src/client/` — Browser-side runtime code (top-level page in headless runs, iframe in headed runs)
  - `entry.ts` — Browser client entry point
  - `dispatchTransport.ts` — Shared client dispatch RPC channel (request ids, timeouts, pending-response resolution) for both iframe and top-level transports
  - `snapshot.ts` — Browser snapshot environment (proxies file ops to host via `snapshot` namespace)
  - `browserRpc.ts` — Client side of the `browser` dispatch namespace (locator/page RPC)
  - `api.ts` / `locator.ts` — `page` API and locator implementation
  - `formatConsole.ts` — Console argument stringification for terminal forwarding
  - `sourceMapSupport.ts` — Source map handling for browser
  - `public.ts` — Re-exports runtime API for browser

## Commands

```bash
# Build
pnpm --filter @rstest/browser build
pnpm --filter @rstest/browser dev     # Watch mode

# Typecheck
pnpm --filter @rstest/browser typecheck
```

## Dependencies

This package requires `@rstest/core` as a peer dependency and consumes two internal entrypoints:

- `@rstest/core/internal/browser-runtime` (client side): `createRstestRuntime`, `setRealTimers`, `globalApis`, and types (WorkerState, RuntimeConfig, etc.)
- `@rstest/core/internal/browser` (host side): logger/color/TTY utilities, `createRunnerEventSink`, and the run-cycle contract types

## Do

- Keep browser-specific code in this package
- Use shared runtime from @rstest/core
- Test browser mode via e2e tests in `e2e/browser-mode/`

## Don't

- Don't duplicate runtime code from @rstest/core
- Don't add node-only features here
- Don't modify public API without updating @rstest/core version check
- Don't bypass the `RunnerEventSink` for runner lifecycle events (no direct reporter/`stateManager` fanout from the host)
- Don't self-finalize non-watch runs in the host — core's `finalizeRunCycle` owns reporters, coverage, and exit code there
- Don't hand-maintain browser config compatibility lists; add or change rows in core's `executorCapabilities` table instead

## Key files

- `src/index.ts` — Package entry
- `src/hostController.ts` — Main scheduling flow
- `src/dispatchCapabilities.ts` — Built-in dispatch namespace registration
- `src/watchRerunPlanner.ts` — Shared watch rerun planner
- `src/client/entry.ts` — Browser-side test runner entry
