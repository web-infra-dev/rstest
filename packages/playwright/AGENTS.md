# @rstest/playwright

Playwright fixture integration for Rstest. Provides Node-side Playwright browser automation fixtures and Playwright-style assertions for tests running in Rstest workers.

## Do

- Keep this package independent from Rsbuild-specific dev/build helpers
- Treat Playwright as a peer dependency
- Reuse `@rstest/core` runtime APIs instead of duplicating test runner behavior
- Keep browser/context/page/request lifecycle cleanup deterministic
- Use JSDoc comments for public API types and functions

## Don't

- Don't depend on `@rsbuild/core`
- Don't couple this package to Rstest browser mode internals
- Don't add global configuration support until the config transport design is settled
- Don't try to match the full Playwright Test API in one step

## Commands

```bash
pnpm --filter @rstest/playwright build
pnpm --filter @rstest/playwright test
pnpm --filter @rstest/playwright typecheck
```
