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

The default entry (`src/index.ts`) registers auto-cleanup via `beforeEach`; `@rstest/browser-react/pure` skips it. Keep that split — users who opt into `pure` manage cleanup themselves. The `beforeEach`-not-`afterEach` choice is deliberate and its rationale is commented in `src/index.ts`.

For React version differences, follow the feature-detection pattern in `src/act.ts` (`React.act ?? React.unstable_act`) rather than assuming a specific React patch — `React.act` only stabilized in 18.3.1.
