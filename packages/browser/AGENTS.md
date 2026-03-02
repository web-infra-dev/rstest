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
    R2[dispatch rpc request]
    R3[snapshot.ts]
  end

  H1 -->|inject host config| U1
  H1 -->|birpc callbacks| U1
  U1 -->|birpc calls| H1

  R1 -->|postMessage \_\_rstest_dispatch\_\_| U3
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

  H1 -->|headless bridge \_\_rstest_dispatch\_\_| R1
  H1 -->|headless bridge \_\_rstest_dispatch_rpc\_\_| R2
```

This diagram is the package-level quick overview and the contract boundary map.
`dispatchRouter` handles inbound request routing only; outbound delivery is transport reply.

Contract ownership:

- `@rstest/browser` owns host scheduling, dispatch routing, and protocol semantics.
- `@rstest/browser-ui` owns transport bridging and UI state projection only.
- Runner runtime (`src/client`) owns test execution and emits protocol messages, but does not own filesystem access.

## Module structure

- `src/index.ts` — Package entry, exports runBrowserTests and listBrowserTests
- `src/hostController.ts` — Main browser mode controller (runtime bootstrap + headless/headed scheduling)
- `src/protocol.ts` — Type definitions for browser-host communication protocol
- `src/dispatchRouter.ts` — Host-side dispatch namespace router
- `src/dispatchCapabilities.ts` — Shared built-in dispatch capability registration (`runner`, `snapshot`, extension namespaces)
- `src/runSession.ts` — Run token lifecycle and cancellation semantics
- `src/sessionRegistry.ts` — Session index keyed by `sessionId`/`testFile`/`runToken`
- `src/concurrency.ts` — Shared headless worker concurrency policy
- `src/headlessTransport.ts` — Top-level headless page bridge wiring (`__rstest_dispatch__` / `__rstest_dispatch_rpc__`)
- `src/watchRerunPlanner.ts` — Shared watch rerun planning logic across headless/headed paths
- `src/client/` — Browser-side runtime code (runs in iframe)
  - `entry.ts` — Browser client entry point
  - `snapshot.ts` — Browser snapshot environment (proxies file ops to host)
  - `sourceMapSupport.ts` — Source map handling for browser
  - `public.ts` — Re-exports runtime API for browser
  - `fakeTimersStub.ts` — Stub for @sinonjs/fake-timers in browser

## Commands

```bash
# Build
pnpm --filter @rstest/browser build
pnpm --filter @rstest/browser dev     # Watch mode

# Typecheck
pnpm --filter @rstest/browser typecheck
```

## Dependencies

This package requires `@rstest/core` as a peer dependency. The browser client code uses internal APIs from `@rstest/core/browser`:

- `createRstestRuntime` - Creates test runtime
- `setRealTimers` - Preserves real timer references
- `globalApis` - List of global API names
- Various types (WorkerState, RuntimeConfig, etc.)

## Do

- Keep browser-specific code in this package
- Use shared runtime from @rstest/core
- Test browser mode via e2e tests in `e2e/browser-mode/`

## Don't

- Don't duplicate runtime code from @rstest/core
- Don't add node-only features here
- Don't modify public API without updating @rstest/core version check

## Key files

- `src/index.ts` — Package entry
- `src/hostController.ts` — Main scheduling flow
- `src/dispatchCapabilities.ts` — Built-in dispatch namespace registration
- `src/watchRerunPlanner.ts` — Shared watch rerun planner
- `src/client/entry.ts` — Browser-side test runner entry
