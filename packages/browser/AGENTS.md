# @rstest/browser

Browser mode support for Rstest. Provides browser test execution using Playwright and a React-based test UI.

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

## Architecture

```plaintext
┌─────────────────────────────────────────────────────────────────┐
│  HOST (Node.js) - hostController.ts                             │
│  ┌──────────────┐  ┌───────────┐  ┌─────────────────────────┐  │
│  │ Rsbuild Dev  │  │ Playwright│  │ WebSocket Server (RPC)  │  │
│  │ Server       │  │ (Chromium)│  │ - rerunTest()           │  │
│  │ - Bundle     │  │           │  │ - getTestFiles()        │  │
│  │ - Lazy comp  │  │           │  │ - dispatch(request)     │  │
│  └──────────────┘  └───────────┘  └─────────────────────────┘  │
│  Headless: direct page transport + session-based scheduler      │
│  Headed: container page + iframe runners                        │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER (Chromium)                                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Container Page (@rstest/browser-ui)                      │  │
│  │  - React + Ant Design UI                                  │  │
│  │  - Test file tree, status tracking                        │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │  Runner iframes (client/entry.ts)                   │ │  │
│  │  │  - Loads tests via @rstest/browser-manifest         │ │  │
│  │  │  - Executes tests via shared runtime from @rstest/core │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
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
