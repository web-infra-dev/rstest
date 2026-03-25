# Audit Rules Reference

Complete rule catalog for the test audit mode. Rules are organized by detection difficulty: Layer 1 (grep-level) → Layer 2 (single-file semantic) → Layer 3 (cross-file semantic).

## Severity Definitions

- **error**: Near-certain broken or useless test. High confidence, unambiguous local evidence.
- **warning**: Meaningful quality weakness or coverage gap. May require judgment.
- **info**: Maintainability improvement. Low urgency.

## Deduplication

When multiple rules fire on the same test, report only the most specific one:

- TST-003 (empty body) supersedes TST-004 (no assertion) — do not report both
- Specific async misuse (TST-011, TST-012) supersedes generic no-assertion (TST-004)
- One cross-file gap per behavior family, not separate findings for each sub-branch

## Layer 1: Grep-Level Detection

These rules can be detected by text pattern matching. Low false-positive rate, though some (TST-063) require light semantic judgment.

### TST-001: `.only` committed

- **Severity**: error
- **Auto-fixable**: Yes
- **Detect**: `it.only`, `test.only`, `describe.only` in test files
- **Why**: Silently disables all other tests in the suite. CI may pass with only one test running.
- **Fix**: Remove `.only`

### TST-002: `.skip` / `.todo` left on real behavior

- **Severity**: warning
- **Auto-fixable**: Partial (can remove `.skip`, but the test may need updating)
- **Detect**: `.skip`, `.todo`, `xit`, `xtest`, `xdescribe` — especially when the test name describes real feature behavior
- **Why**: Known gap remains unprotected. Skipped tests rot over time.
- **Fix**: Either implement the test or remove it with a tracking issue

### TST-003: Empty or placeholder test body

- **Severity**: error
- **Auto-fixable**: Partial
- **Detect**: Test callback with empty body, comment-only body, or only setup calls with no `expect`
- **Why**: Gives false sense of coverage. The test always passes regardless of behavior.
- **Note**: If this fires, do NOT also report TST-004 for the same test.

```typescript
// ❌ Bad
it('parses config', () => {});
it('validates input', () => {
  // TODO
});

// ✅ Good
it('parses config', () => {
  expect(parseConfig('key=val')).toEqual({ key: 'val' });
});
```

### TST-004: No assertion in test body

- **Severity**: error
- **Auto-fixable**: No (need to understand what to assert)
- **Detect**: Test body has no `expect()`, no snapshot call, no spy assertion, no `toThrow`. Body is non-empty (otherwise TST-003 applies).
- **Why**: Test runs code but proves nothing. Passes even if return value is completely wrong.

```typescript
// ❌ Bad — runs code but proves nothing
it('returns user', () => {
  getUser(1);
});

// ✅ Good
it('returns user', () => {
  expect(getUser(1)).toEqual({ id: 1, name: 'Alice' });
});
```

### TST-010: Missing `await` on async assertion

- **Severity**: error
- **Auto-fixable**: Yes (add `await`)
- **Detect**: `expect(…).resolves` or `expect(…).rejects` without `await` or `return` prefix
- **Why**: The assertion is not awaited — test passes regardless of resolved/rejected value.

```typescript
// ❌ Bad — promise assertion floats
expect(fetchUser('bad')).rejects.toThrow('not found');

// ✅ Good
await expect(fetchUser('bad')).rejects.toThrow('not found');
```

### TST-013: Real sleep/delay in tests

- **Severity**: warning
- **Auto-fixable**: Partial
- **Detect**: `setTimeout`, `sleep(`, `delay(`, `await new Promise(r => setTimeout` in test files (outside of utility definitions)
- **Why**: Makes tests slow and timing-dependent. Use fake timers or waitFor patterns instead.

### TST-063: Unused imports or fixtures

- **Severity**: info
- **Auto-fixable**: Yes
- **Detect**: Imported symbols not referenced in test body; destructured fixture params not used
- **Why**: Clutter and misleading dependency signals.
- **Note**: Requires light semantic analysis — not purely grep. May miss complex re-export patterns.

### TST-065: Debug residue

- **Severity**: info
- **Auto-fixable**: Yes
- **Detect**: `console.log`, `console.debug`, `debugger`, commented-out `expect` lines in test files
- **Why**: Noise from debugging sessions left behind.

---

## Layer 2: Single-File Semantic Analysis

These rules require reading and understanding one test file's structure.

### TST-005: Assertion hidden in conditional branch

- **Severity**: warning
- **Auto-fixable**: Partial
- **Detect**: `expect()` only appears inside `if`, `catch`, `.then()`, callback, or loop body that may not execute
- **Why**: Test can pass without any assertion running.

```typescript
// ❌ Bad — if save() succeeds, no assertion runs
try {
  await save(data);
} catch (e) {
  expect(e.code).toBe('INVALID');
}

// ✅ Good — assertion always runs
await expect(save(data)).rejects.toThrow('INVALID');
```

### TST-011: Wrong async throw pattern

- **Severity**: error
- **Auto-fixable**: Partial
- **Detect**: `expect(async () => …).toThrow()` — `toThrow` is for synchronous throws, not rejected promises
- **Why**: `toThrow` catches sync exceptions. An async function returns a promise, so `toThrow` sees no throw.

```typescript
// ❌ Bad — toThrow does not catch async rejections
expect(async () => await login('bad')).toThrow();

// ✅ Good
await expect(login('bad')).rejects.toThrow();
```

### TST-012: try/catch error test without fail path

- **Severity**: error
- **Auto-fixable**: Partial
- **Detect**: `try { … } catch { expect(…) }` pattern where the try block has no `expect.assertions()`, no `throw` after the try, and no assertion before catch
- **Why**: If the code does NOT throw, the test still passes — the catch block is simply skipped.

```typescript
// ❌ Bad — passes silently when fn() doesn't throw
try {
  fn();
} catch (e) {
  expect(e.message).toBe('bad');
}

// ✅ Good — expect.assertions guarantees the catch ran
expect.assertions(1);
try {
  fn();
} catch (e) {
  expect(e.message).toBe('bad');
}

// ✅ Better — use the idiomatic pattern
expect(() => fn()).toThrow('bad');
```

### TST-014: Fake timers not restored

- **Severity**: warning
- **Auto-fixable**: Yes (add `afterEach(() => vi.useRealTimers())`)
- **Detect**: `vi.useFakeTimers()` or `vi.setSystemTime()` without corresponding `vi.useRealTimers()` in afterEach/afterAll/finally
- **Why**: Leaks fake timer state into subsequent tests.

### TST-020: Global/env mutation not restored

- **Severity**: warning
- **Auto-fixable**: Partial (can add cleanup in afterEach)
- **Detect**: Direct writes to `process.env`, `globalThis`, `Date.now`, `Math.random`, or module-level mutable state without cleanup in `afterEach`/`afterAll`
- **Why**: Leaks state into later tests, causing order-dependent flakiness.

```typescript
// ❌ Bad — env mutation leaks
it('uses prod mode', () => {
  process.env.NODE_ENV = 'production';
  expect(getMode()).toBe('prod');
});

// ✅ Good — save and restore
it('uses prod mode', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    expect(getMode()).toBe('prod');
  } finally {
    process.env.NODE_ENV = prev;
  }
});
```

### TST-022: Spies/mocks not cleared or restored

- **Severity**: warning
- **Auto-fixable**: Yes (add `afterEach(() => vi.restoreAllMocks())`)
- **Detect**: `vi.spyOn`, `.mockReturnValue`, `.mockImplementation` used at describe-level or shared across tests, without `restoreAllMocks`/`clearAllMocks` in afterEach
- **Why**: Mock state leaks across tests — call counts accumulate, implementations persist.
- **Note**: Local `vi.fn()` created and consumed within a single `it()` block is fine — only flag when mocks are shared across tests or attached to real modules via `vi.spyOn`.

### TST-030: Weak truthiness assertion

- **Severity**: warning
- **Auto-fixable**: Partial (needs understanding of expected value)
- **Detect**: `toBeTruthy()`, `toBeFalsy()`, `toBeDefined()`, `not.toBeNull()`, `not.toBeUndefined()` on values where a specific shape/value is expected
- **Why**: Many incorrect values still pass. `toBeTruthy()` accepts `1`, `"wrong"`, `[]`, `{}` — all truthy but potentially wrong.
- **Exception**: When existence/definedness IS the actual contract (e.g., checking optional config was provided), this is acceptable. Do not flag in those cases.

```typescript
// ❌ Bad — passes even if result is "unexpected string"
expect(result).toBeTruthy();

// ✅ Good — asserts the actual expected value
expect(result).toEqual({ status: 'ok', data: [] });

// ✅ Also acceptable — when existence is the contract
expect(config.optionalPlugin).toBeDefined();
```

### TST-033: Snapshot-only assertion

- **Severity**: warning
- **Auto-fixable**: Partial
- **Detect**: Test body contains only `toMatchSnapshot()` or `toMatchInlineSnapshot()` with no other `expect` calls
- **Why**: Snapshots are brittle for behavioral testing. A snapshot change is often rubber-stamped without review.
- **Exception**: Snapshot-only is acceptable for tests whose primary contract IS the serialized output (e.g., code generators, formatters, printer output). Do not flag in those cases.

### TST-035: Multiple unrelated behaviors in one test

- **Severity**: warning
- **Auto-fixable**: No (requires manual split)
- **Detect**: Single `it()` that: calls the subject multiple times with different inputs, has assertions on unrelated properties, or spans create/update/delete lifecycle
- **Why**: When it fails, you don't know which behavior broke. Split into focused tests.

### TST-040: Mocking the unit under test

- **Severity**: error (only when confidence is high)
- **Auto-fixable**: Partial
- **Detect**: In `foo.test.ts`, `vi.mock('../foo')` or mocking the exact exported symbol that the test's `expect()` calls verify.
- **Why**: You're not testing real code — you're testing your own mock.
- **Note**: Downgrade to warning if the mock is a partial mock (`vi.mock('../foo', async () => { const actual = await vi.importActual('../foo'); ... })`) — partial mocks may be intentional for isolating specific exports.

### TST-043: Dead or unasserted spy

- **Severity**: info
- **Auto-fixable**: Yes (remove unused spy)
- **Detect**: `vi.spyOn(…)` or `vi.fn()` assigned to a variable that is never referenced in an `expect()` call or used as a mock implementation
- **Why**: Noise. Creates false impression that something is being verified.

### TST-060: Generic or misleading test name

- **Severity**: warning
- **Auto-fixable**: Partial (can suggest better names)
- **Detect**: Test names matching patterns: `works`, `should work`, `test 1`, `test2`, `handles case`, `basic`, `default`, `correct`, single-word names
- **Why**: When this test fails, the name gives zero diagnostic information.

```typescript
// ❌ Bad
it('works', () => { … });
it('test 1', () => { … });
it('handles case', () => { … });

// ✅ Good
it('returns null when queue is empty', () => { … });
it('retries up to maxRetries then throws', () => { … });
```

### TST-061: Duplicate tests that should use `it.each`

- **Severity**: info
- **Auto-fixable**: Partial (can refactor to `it.each`)
- **Detect**: Multiple adjacent `it()` blocks with near-identical structure differing only in literal values
- **Why**: Duplication makes tests harder to extend and maintain.

---

## Layer 3: Cross-File Semantic Analysis

These rules require reading both the source file and its test file. **Always use warning severity** (never error) because cross-file analysis involves heuristic judgment.

**Scope guard**: Only apply Layer 3 rules when:

- The test file has a clear primary source subject (unit-style test)
- The source↔test mapping is confident (imports match)

Skip Layer 3 for integration/e2e tests that exercise multiple modules, or when the primary subject cannot be identified.

### TST-050: Happy-path-only testing

- **Severity**: warning
- **Auto-fixable**: No (need to write new tests)
- **Detect**: Source has multiple `if/else`, `switch`, guard returns, ternary branches. Test file only exercises one success scenario.
- **Why**: Most bugs live in branches, not the happy path.
- **How to check**: Count branch points in source. Compare with distinct test scenarios. Flag when source has ≥3 branches but tests cover only 1.

### TST-051: Explicit throw/reject paths untested

- **Severity**: warning
- **Auto-fixable**: No
- **Detect**: Source contains `throw new Error(…)`, `Promise.reject(…)`, `assert(…)`, or explicit error-return branches. No corresponding `toThrow`, `rejects.toThrow`, or error-case test exists.
- **Why**: Error paths silently regress. These are often the most important behaviors to protect.
- **How to check**: List all throw/reject statements in source with their messages. Search test file for matching error messages or `.toThrow` assertions.

### TST-052: Boundary values untested

- **Severity**: warning
- **Auto-fixable**: No
- **Detect**: Source uses comparisons (`>`, `>=`, `<`, `<=`, `=== 0`, `.length`), array index bounds, or numeric thresholds. Tests only use "middle" values, never edge values.
- **Why**: Off-by-one bugs are among the most common defects.
- **How to check**: Find comparison expressions in source. Check if test inputs include boundary values (0, -1, empty, max, max+1, etc.).

### TST-053: Nullish/empty input guards untested

- **Severity**: warning
- **Auto-fixable**: No
- **Detect**: Source checks `!x`, `x == null`, `x === undefined`, `x.length === 0`, `!x.length`, empty string/array guards. Tests never pass `null`, `undefined`, `''`, or `[]`.
- **Why**: These guards exist because the inputs can happen. If untested, guard regressions go unnoticed.

### TST-054: Incomplete variant/switch-case coverage

- **Severity**: warning
- **Auto-fixable**: No
- **Detect**: Source branches on enum, union type, tag field, or string literal (`switch (kind)`, `if (type === 'a') … else if (type === 'b')`). Tests only cover a subset of the variants.
- **Why**: Untested variants will break silently when the code changes.

### TST-055: Catch/fallback/retry logic untested

- **Severity**: warning
- **Auto-fixable**: No
- **Detect**: Source has `catch`, fallback values, retry loops, default providers, recovery paths. Test mocks never simulate the failure that triggers these paths.
- **Why**: Resilience logic is critical but invisible when it works. It must be tested explicitly.

### TST-056: Nondeterministic dependency not controlled

- **Severity**: warning
- **Auto-fixable**: No
- **Detect**: Source depends on `Date.now()`, `Math.random()`, UUIDs, timestamps, locale-sensitive formatting, or `process.env` values. Tests assert on exact output values without stubbing/mocking these sources.
- **Why**: Tests may pass locally but fail in different timezones, locales, or environments. Or worse, they pass today and fail tomorrow.
- **How to check**: Find nondeterministic calls in source. Check if test file uses `vi.useFakeTimers()`, `vi.spyOn(Math, 'random')`, or env setup for those values.

### TST-034: Bare `toThrow()` when source has distinct errors

- **Severity**: warning
- **Auto-fixable**: Partial (can add error message matcher)
- **Detect**: Test uses `toThrow()` with no argument, but source function throws 2+ different errors with distinct messages/types.
- **Why**: `toThrow()` accepts ANY error — including wrong errors. The test passes even if the function throws for the wrong reason.

```typescript
// ❌ Bad — source throws "invalid email" and "email taken", test accepts either
expect(() => validateEmail('')).toThrow();

// ✅ Good — asserts the specific error
expect(() => validateEmail('')).toThrow('invalid email');
```

### TST-041: Mocks only simulate success, never failure

- **Severity**: warning
- **Auto-fixable**: No
- **Detect**: Source handles dependency failures (try/catch around external calls, `.catch()`, error status checks). All mock setups in tests return success responses only.
- **Why**: Error handling code is untested. When the dependency fails in production, the error path may be broken.
