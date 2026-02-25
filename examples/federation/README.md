# react-webpack-MF

[中文](./README_zh-cn.md)

A complete Webpack Module Federation Case with React.

# project directory

## lib-app

Removed in this simplified example.

## component-app

It exposes UI components to `main-app` via Module Federation.

It is a pure `remote`.

## main-app

The top-level app, which depends on `component-app`.

It is a pure host.

# how to use

- `pnpm install`
- `pnpm run start`

After running these commands, open your browser at `http://localhost:3002` and open the DevTools network tab to see resource loading details.

[Best practices, rules and more interesting information here](../../playwright-e2e/README.md)
