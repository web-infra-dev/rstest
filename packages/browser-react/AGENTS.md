# @rstest/browser-react

React component testing support for Rstest browser mode. Provides `render`, `renderHook`, `cleanup`, and `act` utilities for testing React components in a real browser environment.

## Do

- Support React 18 and 19 only — React 17 is intentionally not supported (the package statically imports `react-dom/client`, which does not exist under React 17)
- Use `act()` for all render/unmount/state update operations
- Keep this package focused on React rendering lifecycle only
- Use JSDoc comments for public API functions

## Don't

- Don't add DOM query utilities (users should use `@testing-library/dom`)
- Don't add dependencies beyond React peer deps
- Don't add React 17 compatibility shims; widen peer deps only after discussion
- Don't use React version-specific APIs without fallbacks across the supported range (18.x–19.x)

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

Good — use feature detection across the supported range:

```typescript
// src/act.ts
// `React.act` was stabilized in React 18.3.1; 18.0.0 – 18.3.0 only expose `React.unstable_act`.
const _act = ((React as Record<string, unknown>).act ??
  (React as Record<string, unknown>).unstable_act) as
  ((callback: () => unknown) => Promise<void>) | undefined;
```

Bad — assume a specific React patch:

```typescript
import { act } from 'react'; // Breaks React 18.0.0 – 18.3.0
```
