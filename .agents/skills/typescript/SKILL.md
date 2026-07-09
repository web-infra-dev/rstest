---
name: typescript
description: 'TypeScript anti-slop guardrails. Use when writing or reviewing .ts, .tsx, and .mts files. Covers patterns that Biome, tsc, and rslint do not catch.'
metadata:
  internal: true
---

# TypeScript Anti-Slop Guardrails

Skip formatting and lint rules — tooling handles those. This skill targets patterns that produce valid-looking but poor-quality code.

When in doubt, **copy the local pattern in the file you are editing** rather than importing a style from elsewhere.

## 1. No Restating Comments

Comments that repeat what the next line does are noise. Only comment **why**, never **what**.

```typescript
// wrong
// Set the current file path
context.setFilePath(filePath);
// Initialize the reporter
const reporter = new Reporter(config);

// right — let code speak; comment only non-obvious intent
// Force sequential execution — parallel runs corrupt shared fixture state
context.setFilePath(filePath);
const reporter = new Reporter(config);
```

Also avoid: section-header comments inside functions (`// --- Validate ---`), JSDoc that adds nothing beyond the signature, temporal markers (`// added for`, `// Phase 1`).

## 2. No Unnecessary Defensive Code

Do not add runtime checks that the type system already guarantees. Trust the types.

```typescript
// wrong — param is already typed string
function resolvePattern(pattern: string): string {
  if (typeof pattern !== 'string') {
    throw new Error('pattern must be a string');
  }
  return glob(pattern);
}

// right — trust the type system
function resolvePattern(pattern: string): string {
  return glob(pattern);
}
```

Also avoid: redundant `?? []` / `|| {}` on fields that are always initialized (normalize once at construction instead), null checks on values you just produced, `try/catch` around code that cannot throw.

## 3. Minimize `as`

Treat `as` as a last resort, not a way to silence errors. If you need `as`, the types are probably wrong.

```typescript
// wrong — casting to escape a type error
const name = (config as any).testName;

// right — narrow or fix the type
if ('testName' in config) {
  const name = config.testName;
}
```

- Never `as any` or `as unknown as X` unless at a proven interop seam or test-only partial mock.
- If control flow already proved the type, the cast is redundant — remove it.
- When a cast is truly needed, add a one-line comment explaining why.

## 4. Minimize `any`

`noExplicitAny` is **off** in this repository, so self-police. Prefer `unknown` + narrowing, or a generic, before reaching for `any`. Never let `any` leak into exported APIs, config types, or cross-package contracts.

## 5. No One-Use Abstractions

Do not extract a function, class, or type that is used exactly once, unless it genuinely improves readability at the call site.

```typescript
// wrong — called once, five lines away
function formatTestName(name: string): string {
  return name.replace(/\.test$/, '');
}
// ... later:
const display = formatTestName(file);

// right — inline it
const display = file.replace(/\.test$/, '');
```

Also avoid: interfaces with single implementations, factory functions that create one thing, options objects with 10 optional fields for features that don't exist yet.

**Threshold:** extract when used in 3+ places, or when the extraction meaningfully shortens a complex function.

## 6. No Catch-and-Rethrow Without Context

If a `catch` block doesn't add information or recover, delete the `try/catch`.

```typescript
// wrong — catches and rethrows with just a message rewrite
try {
  await loadConfig(path);
} catch (error) {
  throw new Error(
    `Failed to load: ${error instanceof Error ? error.message : error}`,
  );
}

// right — use cause to preserve the chain
try {
  await loadConfig(path);
} catch (error) {
  throw new Error(`Failed to load config at ${path}`, { cause: error });
}

// also right — just don't catch if you add nothing
await loadConfig(path);
```

Also avoid: bare rethrow (`catch (e) { throw e; }`), empty catch blocks, catch blocks that only `console.log`.

## 7. Single Source of Truth — Prevent Drift

When two declarations describe the same thing — types, constants, defaults, validation rules — one must derive from the other. Duplicating independently causes **drift**: they match today, diverge silently tomorrow. Derive via `extends`, `Pick`, `ReturnType`, `typeof`, `satisfies`, or simply importing the canonical definition.

## 8. Search Before Creating Utilities

Before writing a helper function, search the codebase. If it exists, import it. If it exists but isn't exported, export it. Don't create a second `isObject()` or `normalizeSlashes()`.

## 9. No Over-Engineered Types

- Don't introduce deep conditional types, mapped types, or template literal types unless they clearly reduce complexity.
- Don't create a reusable utility type for one call site.
- Prefer the smallest type shape that explains the contract.
- This repository uses both `type` and `interface` — follow nearby code.

## Repository Conventions

- Use `import type` for type-only imports.
- Public config properties: use JSDoc with `@default`.
- Preserve existing file-local patterns unless there is a clear bug or maintenance win.
