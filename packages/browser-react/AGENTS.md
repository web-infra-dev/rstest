# @rstest/browser-react

React component testing support for Rstest browser mode. Provides `render`, `renderHook`, `cleanup`, and `act` utilities for testing React components in a real browser environment.

## Do

- Support React 17, 18, and 19 — ensure code works across all versions
- Use `act()` for all render/unmount/state update operations
- Keep this package focused on React rendering lifecycle only
- Use JSDoc comments for public API functions
- Default to small, focused diffs

## Don't

- Don't add DOM query utilities (users should use `@testing-library/dom`)
- Don't add dependencies beyond React peer deps
- Don't break compatibility with older React versions without discussion
- Don't use React version-specific APIs without fallbacks

## Commands

```bash
# Build
pnpm --filter @rstest/browser-react build
pnpm --filter @rstest/browser-react dev     # Watch mode

# Type check single file
pnpm tsc --noEmit src/pure.tsx

# Format single file
pnpm prettier --write src/pure.tsx

# Run tests
pnpm --filter @rstest/browser-react test
```

Note: Prefer file-scoped commands for faster feedback during development.

## Project structure

- `src/index.ts` — Default entry with auto-cleanup via `beforeEach`
- `src/pure.tsx` — Core implementation (render, renderHook, cleanup, configure)
- `src/act.ts` — React `act()` wrapper with `IS_REACT_ACT_ENVIRONMENT` management

## Good and bad examples

### Handling React version differences

Good — use feature detection with fallback:

```typescript
// src/act.ts
const _act = (React as Record<string, unknown>).act as
  | ((callback: () => unknown) => Promise<void>)
  | undefined;

export const act: ActFunction =
  typeof _act !== 'function'
    ? async (callback) => {
        await callback();
      } // React 17 fallback
    : async (callback) => {
        await _act(callback);
      }; // React 18+
```

Bad — assume specific React version:

```typescript
import { act } from 'react'; // Breaks React 17
```

## Exports

### Default entry (`@rstest/browser-react`)

- `render` — Render a React component, returns `RenderResult`
- `renderHook` — Test React hooks, returns `RenderHookResult`
- `cleanup` — Cleanup mounted components
- `act` — Wrap state updates

Auto-registers `beforeEach(cleanup)` for automatic cleanup.

### Pure entry (`@rstest/browser-react/pure`)

Same exports plus:

- `configure` — Configure render behavior (e.g., `reactStrictMode`)

No auto-cleanup — user must call `cleanup()` manually.

## Key types

```typescript
interface RenderResult {
  container: HTMLElement;
  baseElement: HTMLElement;
  unmount: () => Promise<void>;
  rerender: (ui: ReactNode) => Promise<void>;
  asFragment: () => DocumentFragment;
}

interface RenderOptions {
  container?: HTMLElement;
  baseElement?: HTMLElement;
  wrapper?: JSXElementConstructor<{ children: ReactNode }>;
}
```

## When stuck

- Ask clarifying questions or propose a plan
- Check React version compatibility before making changes
- Reference `@testing-library/react` for API design inspiration
