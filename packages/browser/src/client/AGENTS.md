# Browser mode runner architecture

This document is architecture-only and focuses on the browser runner runtime in `src/client`.

## Runner bootstrap pipeline

```mermaid
flowchart TD
  A["waitForConfig()"] --> B["read \_\_RSTEST_BROWSER_OPTIONS\_\_ + URL overrides"]
  B --> R["send ready"]
  R --> C["setRealTimers()"]
  C --> D["preloadRunnerSourceMap()"]
  D --> E["resolve project + runtimeConfig"]
  E --> F{"execution mode"}

  F -->|collect| G["create runtime + load setup/test modules + runner.collectTests()"]
  G --> H["send collect-result / collect-complete"]

  F -->|run| I["interceptConsole() + createRstestRuntime()"]
  I --> J["send file-start"]
  J --> K["load setup files + load test module"]
  K --> L["runner.runTests() + send case-result"]
  L --> N["send file-complete per file"]
  N --> O["send complete after all files"]

  H --> M["window.\_\_RSTEST_DONE\_\_ = true"]
  O --> M
```

## Transport architecture

```mermaid
flowchart LR
  subgraph IframePath["Iframe path (headed)"]
    S1["send()"] --> P1["parent.postMessage(\_\_rstest_dispatch\_\_)"]
    R1["dispatchRunnerLifecycle()"] --> P2["postMessage dispatch-rpc-request"]
    SN1["snapshot.sendRpcRequest()"] --> P3["postMessage dispatch-rpc-request + wait \_\_rstest_dispatch_response\_\_"]
  end

  subgraph TopLevelRunPath["Top-level page path (headless run)"]
    S2["send()"] --> D1["window.\_\_rstest_dispatch\_\_"]
    R2["dispatchRunnerLifecycle()"] --> D2["window.\_\_rstest_dispatch_rpc\_\_"]
    SN2["snapshot.sendRpcRequest()"] --> D3["window.\_\_rstest_dispatch_rpc\_\_"]
  end

  subgraph TopLevelCollectPath["Top-level page path (list collect)"]
    S3["send()"] --> C1["window.\_\_rstest_dispatch\_\_"]
  end
```

## Snapshot RPC sequence

```mermaid
sequenceDiagram
  participant Snap as snapshot.ts
  participant Runner as entry.ts runtime
  participant Container as browser-ui channel
  participant Host as host dispatch router

  Snap->>Runner: sendRpcRequest(method, args)

  alt top-level runner (headless run)
    Runner->>Host: __rstest_dispatch_rpc__(namespace=snapshot)
    Host-->>Runner: BrowserDispatchResponse
    Runner-->>Snap: result/error
  else iframe runner (headed)
    Runner->>Container: postMessage(dispatch-rpc-request)
    Container->>Host: rpc.dispatch(request)
    Host-->>Container: BrowserDispatchResponse
    Container-->>Runner: __rstest_dispatch_response__
    Runner-->>Snap: resolve/reject pending request
  end
```

List collect mode does not use the snapshot RPC namespace.

## Runtime invariants

- `entry.ts` is the only bootstrap entry and decides `collect` vs `run` mode.
- Runner lifecycle events (`file-ready`, `suite-start`, `suite-result`, `case-start`) go through the `runner` dispatch namespace.
- Snapshot file operations go through the `snapshot` dispatch namespace and never access filesystem directly in browser runtime.
- Console interception is per test file and must restore original console methods in `finally`.
