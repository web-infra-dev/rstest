# Repository guidelines

## Project structure & module organization

- Root tooling (e.g., `pnpm-workspace.yaml`, `rstest.config.ts`) configures the monorepo. Run all commands from the repository root unless noted.
- Implementation code lives in `packages/core/src`, organized by feature. Unit tests sit beside their domain in `packages/core/tests` with mirrored folder names.
- Examples and integration scenarios reside in `examples/`, while end-to-end scripts live under `e2e/`. Keep assets local to the package they support.
- The `e2e/` folder packages contains the integration test cases.

## Build, Test, and development commands

- `pnpm install` — install all workspace dependencies.
- `pnpm typecheck` runs type checking.
- `pnpm build` compiles all buildable workspaces (excluding examples and test fixtures).
- `pnpm e2e` enters `e2e/` and runs the integration suite with its local `pnpm test` command.
- `pnpm test` runs unit tests for all Rstest projects.
- `pnpm format` formats sources with Prettier and normalizes headings.
- `pnpm lint` executes Biome, the spelling check, and `pnpm lint:type`.
- `pnpm lint:type` runs `rslint` for additional lint coverage.

## Coding style & naming conventions

- Favor explicit, type-safe interfaces—lean on TypeScript's generics, `readonly`, and discriminated unions instead of loose `any` usage.
- Use `camelCase` for variables/functions, `PascalCase` for exported classes/types, and `SCREAMING_SNAKE_CASE` only for shared constants.
- Keep modules focused: one primary export per file, co-locate helper utilities when they are private to that feature.
- Prefer pure functions and deterministic utilities; isolate side effects near I/O boundaries.
- Document externally consumed APIs with concise TSDoc blocks and include representative usage snippets when behavior is non-obvious.

## Testing guidelines

### Test organization

- **Unit tests** live in `packages/core/tests` with folder structure mirroring `packages/core/src`
- **Integration tests** (e2e) live in `e2e/` directory with feature-based organization
- Test files use `.test.ts` or `.test.tsx` extension
- Each domain/feature should have corresponding test coverage in both unit and integration layers

### Unit testing

- Unit tests focus on testing individual functions, classes, and modules in isolation
- Use descriptive test names that explain the expected behavior
- Group related tests using `describe` blocks
- Use `beforeEach`/`afterEach` for test setup and cleanup
- Mock external dependencies using `rs.fn()` and `rs.mock()`
- Test files should import from `@rstest/core`: `import { describe, expect, it, beforeEach, afterEach, rs } from '@rstest/core'`

**Example unit test structure:**

```ts
import { beforeEach, describe, expect, it, rs } from '@rstest/core';
import { functionToTest } from '../../src/utils/helper';

describe('functionToTest', () => {
  beforeEach(() => {
    // Setup before each test
  });

  it('should handle normal case correctly', () => {
    expect(functionToTest('input')).toBe('expected');
  });

  it('should handle edge case', () => {
    expect(() => functionToTest(null)).toThrow('error message');
  });
});
```

### Integration testing (E2E)

- E2E tests validate complete workflows and feature interactions
- Organize tests by feature areas (e.g., `cli/`, `dom/`, `test-api/`, `lifecycle/`)
- Tests can spawn child processes to test CLI commands and configurations
- Use realistic test scenarios that mirror actual user workflows
- Include both happy path and error scenarios

**Example e2e test structure:**

```ts
import { describe, expect, it } from '@rstest/core';

describe('Feature Name', () => {
  it('should work correctly in normal scenario', () => {
    // Test implementation with realistic data
  });

  it('should handle error conditions appropriately', () => {
    // Test error scenarios
  });
});
```

### Test data and fixtures

- Keep test fixtures close to their tests (co-located)
- Use meaningful test data that represents real-world scenarios
- For complex test setups, use `test.extend` to create reusable test contexts
- Use inline snapshots (`toMatchInlineSnapshot`) for output validation when appropriate

### Async testing

- Use `async/await` consistently for asynchronous tests
- Test both successful and error cases for async operations
- Use appropriate timeouts for long-running operations

### Testing commands

- `pnpm test` - Run all unit tests
- `pnpm e2e` - Run all integration tests
- `pnpm typecheck` - Validate TypeScript types
- `pnpm lint` - Run linting and code quality checks

### Test quality standards

- Aim for meaningful test coverage, not just high percentage
- Each test should have a single, clear purpose
- Tests should be deterministic and not flaky
- Use descriptive assertion messages when helpful
- Tests should run quickly; isolate expensive operations

## Commit & pull request guidelines

- Adopt Conventional Commits (`type(scope): title`) as seen in `git log`—`feat`, `fix`, `docs`, and `chore` are common.
- Each PR should: explain the motivation, list notable changes, include testing evidence (`pnpm --filter @rstest/core test` output), and reference related issues.
- Keep diffs focused; split large efforts into reviewable chunks and ensure lint/tests pass before requesting review.
