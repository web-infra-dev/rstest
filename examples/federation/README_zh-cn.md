# Module Federation 示例

[English](./README.md)

一个基于 React 的 Module Federation 项目案例，使用 Rspack 构建，并通过 Rstest 的 `federation` 兼容模式进行测试。

## 目录结构

### component-app

通过 Module Federation 暴露 UI 组件（`Button`、`Dialog`、`Logo`、`ToolTip`）。它是一个纯粹的 `remote`，同时提供浏览器构建（`dist/`）和面向 Node 的构建（`dist-node/`）用于服务端消费。

### main-app

上层 App，通过 HTTP 消费 `component-app`，并通过本地 CommonJS 路径消费 `node-local-remote`。它是一个纯粹的 `host`。

### node-local-remote

一个最小化的 Node 端 remote，直接从磁盘上构建出的 `remoteEntry.js` 消费，无需启动 HTTP 服务。

## 如何使用

- `pnpm install`
- `pnpm run start`

执行完上述命令后，打开浏览器访问 `http://localhost:3002`，并打开 DevTools 的 Network 面板查看资源加载详情。

## 测试

- `pnpm run test` 会运行 `main-app`（jsdom 环境的 host，消费两个 remote）和 `component-app`（基于本地 remote 的 Node SSR）的 Rstest 测试。
- 两个项目都在 `rstest.config.ts` 中开启了 `federation: true`，并通过 `@module-federation/rstest` 插件配置 Module Federation。
