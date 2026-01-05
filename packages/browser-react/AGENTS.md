# @rstest/browser-react

React component testing support for Rstest browser mode. Provides `render`, `renderHook`, `cleanup`, and `act` utilities for testing React components in a real browser environment.

## Module structure

- `src/index.ts` — Default entry with auto-cleanup via `beforeEach`
- `src/pure.tsx` — Pure exports without auto-cleanup (for manual control)
- `src/act.ts` — React `act()` wrapper with `IS_REACT_ACT_ENVIRONMENT` management

## Commands

```bash
# Build
pnpm --filter @rstest/browser-react build
pnpm --filter @rstest/browser-react dev     # Watch mode

# Typecheck
pnpm --filter @rstest/browser-react typecheck

# Run tests
pnpm --filter @rstest/browser-react test
```

## Exports

### Default entry (`@rstest/browser-react`)

- `render` — Render a React component
- `renderHook` — Test React hooks
- `cleanup` — Cleanup mounted components
- `act` — Wrap state updates

Auto-registers `beforeEach(cleanup)` for automatic cleanup.

### Pure entry (`@rstest/browser-react/pure`)

Same exports plus:

- `configure` — Configure render behavior (e.g., `reactStrictMode`)

No auto-cleanup, user must call `cleanup()` manually.

## Usage with @testing-library/dom

This package provides React rendering utilities. For DOM queries (`getByRole`, `getByText`, etc.), users can optionally install `@testing-library/dom`:

```typescript
import { render } from '@rstest/browser-react'
import { screen } from '@testing-library/dom'

test('example', async () => {
  await render(<Button>Click me</Button>)
  expect(screen.getByRole('button')).toBeTruthy()
})
```

## Do

- Keep this package focused on React rendering lifecycle
- Use `act()` for all render/unmount operations
- Support React 17, 18, and 19

## Don't

- Don't add DOM query utilities (users can use @testing-library/dom)
- Don't add dependencies beyond React peer deps
- Don't break compatibility with older React versions without discussion

## Key files

- `src/pure.tsx` — Core implementation
- `src/act.ts` — React act wrapper
- `src/index.ts` — Auto-cleanup entry
