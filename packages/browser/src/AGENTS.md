# Browser mode host architecture

This document is architecture-only and focuses on browser mode scheduling in `@rstest/browser` host-side modules.

## Module topology

```mermaid
flowchart LR
  subgraph Host["@rstest/browser host (Node.js)"]
    IDX["index.ts\nrunBrowserTests()"]
    HC["hostController.ts\nrunBrowserController()"]
    RT["createBrowserRuntime()"]
    DR["dispatchCapabilities.ts + dispatchRouter.ts\nnamespace router"]
    RL["runSession.ts\nRunSessionLifecycle"]
    SR["sessionRegistry.ts\nRunnerSessionRegistry"]
    WP["watchRerunPlanner.ts"]
    LS["headlessLatestRerunScheduler.ts"]
  end

  subgraph UI["@rstest/browser-ui container (headed path)"]
    UR["useRpc() / birpc"]
    CH["core/channel.ts\nforwardDispatchRpcRequest()"]
    MH["main.tsx message listener\nforward lifecycle callbacks"]
  end

  subgraph Runner["runner runtime (src/client/entry.ts)"]
    MSG["runner lifecycle messages"]
    RPC["dispatch-rpc-request"]
  end

  IDX --> HC
  HC --> RT
  HC --> DR
  HC --> WP
  WP --> LS
  HC --> RL
  RL --> SR

  UR <--> HC
  MSG --> MH
  MH --> UR
  RPC --> CH
  CH --> UR

  HC -."headless bridge:\nexposeFunction(\_\_rstest_dispatch\_\_, \_\_rstest_dispatch_rpc\_\_)".-> Runner
```

## Headed transport path

Primary dispatch request direction is `Runner -> Container -> Host -> Router -> Handler`.
`Host -> Container` in this path is bootstrap setup and callback delivery, not router request initiation.
`dispatchRouter` handles inbound request routing only; outbound response delivery is a transport reply.

### Bootstrap control plane

```mermaid
sequenceDiagram
  participant Host as browser hostController
  participant Container as browser-ui container

  Host->>Container: open container and establish birpc
  Host->>Container: provide BrowserHostConfig
  Container-->>Host: getTestFiles and rerun requests
```

### Runtime dispatch RPC data plane

```mermaid
sequenceDiagram
  participant Runner as client iframe runner
  participant Container as browser-ui channel
  participant Host as browser hostController
  participant Router as browser dispatchRouter
  participant Handler as namespace handler

  Runner->>Container: postMessage runner lifecycle
  Container->>Host: forward lifecycle callbacks (onTest*)

  Runner->>Container: postMessage dispatch rpc request
  Container->>Host: rpc.dispatch(request)
  Host->>Router: routing inbound request
  Router->>Handler: resolve namespace handler
  Handler->>Host: execute host capability work
  Host-->>Handler: capability result or error
  Handler-->>Router: return handler result
  Router-->>Host: routing done, response payload
  Host-->>Container: transport reply payload
  Container-->>Runner: transport reply to runner
```

## Headless transport path

Primary dispatch request direction is `Runner -> Host -> Router -> Handler`.
`Host -> Runner` in this path is bridge registration, not router request initiation.
`dispatchRouter` handles inbound request routing only; outbound response delivery is a transport reply.

### Bootstrap control plane

```mermaid
sequenceDiagram
  participant Host as browser hostController
  participant Runner as client top level runner

  Host->>Runner: exposeFunction __rstest_dispatch__
  Host->>Runner: exposeFunction __rstest_dispatch_rpc__
```

### Runtime dispatch RPC data plane

```mermaid
sequenceDiagram
  participant Runner as client top level runner
  participant Host as browser hostController
  participant Router as browser dispatchRouter
  participant Handler as namespace handler

  Runner->>Host: __rstest_dispatch__ lifecycle
  Host->>Host: forward lifecycle callbacks

  Runner->>Host: __rstest_dispatch_rpc__ request
  Host->>Router: routing inbound request
  Router->>Handler: resolve namespace handler
  Handler->>Host: execute host capability work
  Host-->>Handler: capability result or error
  Handler-->>Router: return handler result
  Router-->>Host: routing done, response payload
  Host-->>Runner: transport reply payload
```
