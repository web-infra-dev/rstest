# Module Federation example

A Module Federation case with React, built with Rsbuild and tested with Rstest's `federation` compatibility mode.

## Project directory

### component-app

Exposes UI components (`Button`, `Dialog`, `Logo`, `ToolTip`) via Module Federation. It is a pure `remote`, with both a browser build (`dist/`) and a Node-targeted build (`dist-node/`) for server-side consumption.

### main-app

The top-level app, which consumes `component-app` over HTTP and `node-local-remote` via a local CommonJS path. It is a pure `host`.

### node-local-remote

A minimal Node-targeted remote consumed directly from its built `remoteEntry.js` on disk, without an HTTP server.

## How to use

- `pnpm install`
- `pnpm run start`

After running these commands, open your browser at `http://localhost:3002` and open the DevTools network tab to see resource loading details.

## Testing

- `pnpm run test` runs the Rstest suites of `main-app` (jsdom host consuming both remotes) and `component-app` (Node SSR against the local remote).
- Both projects enable `federation: true` in `rstest.config.ts` and configure Module Federation through the `@module-federation/rstest` plugin.
