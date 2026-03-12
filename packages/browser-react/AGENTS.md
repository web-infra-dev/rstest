# @rstest/browser-react

React component testing support for Rstest browser mode. Provides `render`, `renderHook`, `cleanup`, and `act` utilities for testing React components in a real browser environment.

## Do

- Support React 17, 18, and 19 — ensure code works across all versions
- Use `act()` for all render/unmount/state update operations
- Keep this package focused on React rendering lifecycle only
- Use JSDoc comments for public API functions

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

# Run tests
pnpm --filter @rstest/browser-react test
```

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
