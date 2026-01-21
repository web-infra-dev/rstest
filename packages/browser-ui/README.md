# @rstest/browser-ui

Prebuilt browser container UI for Rstest's browser mode (experimental) testing. This package provides the visual interface that displays test files, execution status, and results when running tests in browser mode.

## Tech stack

- **React 19** - UI framework
- **Tailwind CSS v4** - Styling
- **Ant Design v5** - UI components (Tree, etc.)
- **Lucide React** - Icons
- **birpc** - RPC communication with host

## Development

### Commands

```bash
# Start dev server
pnpm --filter @rstest/browser-ui dev

# Build for production
pnpm --filter @rstest/browser-ui build

# Type check
pnpm --filter @rstest/browser-ui typecheck
```

### Developing with browser mode (experimental) projects

When developing the UI, you can use a local dev server instead of the prebuilt assets:

1. Start the dev server:

   ```bash
   pnpm --filter @rstest/browser-ui dev
   ```

   The dev server runs at `http://localhost:7392/` by default.

2. In any browser mode (experimental) project, set the environment variable to use the local dev server:

   ```bash
   RSTEST_CONTAINER_DEV_SERVER=http://localhost:7392/ pnpm test
   ```

   This tells Rstest to load the container UI from your local dev server instead of the prebuilt assets, enabling hot reload for UI changes.

## License

MIT
