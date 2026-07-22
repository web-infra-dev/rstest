# @rstest/browser-react

React component testing support for Rstest browser mode. Provides `render`, `renderHook`, `cleanup`, and `act` utilities for testing React components in a real browser environment.

## Do

- Support React 18 and 19 only — React 17 is intentionally not supported (the package statically imports `react-dom/client`, which does not exist under React 17)
- Use `act()` for all render/unmount/state update operations
- Keep this package focused on React rendering lifecycle only

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

# Lint
pnpm --filter @rstest/browser-react lint
```

## Entry contract

The default entry (`src/index.ts`) registers auto-cleanup via `beforeEach`; `@rstest/browser-react/pure` skips it. Keep that split — users who opt into `pure` manage cleanup themselves. Keep the cleanup in `beforeEach`, not `afterEach` — running it before the next test means the DOM can still be inspected after a test failure.

## Good and bad examples

### Handling React version differences

Good — use feature detection across the supported range:

```typescript
// `React.act` was stabilized in React 18.3.1; 18.0.0 – 18.3.0 only expose `React.unstable_act`.
const _act = ((React as Record<string, unknown>).act ??
  (React as Record<string, unknown>).unstable_act) as
  ((callback: () => unknown) => Promise<void>) | undefined;
```

Bad — assume a specific React patch:

```typescript
import { act } from 'react'; // Breaks React 18.0.0 – 18.3.0
```
