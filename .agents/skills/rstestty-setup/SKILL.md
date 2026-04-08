---
name: rstestty-setup
description: 'Extract step vocabulary and code templates from existing tests to bootstrap the Gauge step library for agent-native test generation.'
metadata:
  internal: true
---

<command-name>rstestty-setup</command-name>

# rstestty-setup: Bootstrap Step Library

Extract recurring test patterns from existing test files using ast-grep, then generate a Gauge step library (atomic steps + concepts).

## Prerequisites

- **ast-grep** (`sg`) must be installed and available on PATH
- Before starting, verify: `sg --version`
- If not available, install it automatically: `npm i -g @ast-grep/cli`
- Verify again after install. If still failing, stop and report the error to the user.

## Input

- **Optional prompt**: directory path or description of which tests to extract from (e.g., "packages/core/tests", "e2e/reporter", "all tests under src/")
- **No prompt**: scan the entire project's test files to discover extraction targets

## Output directory convention

The step library is written **alongside the test source**, not at a fixed project-root `steps/` path. Determine the output directory from the extraction scope:

1. **Package-scoped extraction** (e.g., `packages/core/tests`) → output to `packages/core/steps/` and `packages/core/steps/concepts/`
2. **Subdirectory extraction** (e.g., `packages/core/tests/reporter`) → still output to the package root `packages/core/steps/` (steps are shared across the package)
3. **Project-root extraction** (e.g., `e2e/` or whole project) → output to `<project-root>/steps/` and `<project-root>/steps/concepts/`

The key rule: **steps live as a sibling of the `tests/` directory** within the same package or project scope. This allows `/rstestty-gen` to discover them by walking up from the test target.

## Workflow

### 1. Determine extraction scope

**If user provided a prompt:**
- Interpret the scope — it can be a directory path, a glob pattern, a package name, or a natural language description
- Locate the corresponding test files

**If no scope specified:**
- Discover test files across the project (look for common test patterns: `*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`, `e2e/`, etc.)
- Report the discovered test distribution and let the user confirm or narrow the scope

### 2. Extract atomic patterns with ast-grep

Use `sg` to structurally scan the target test files. Run multiple ast-grep passes to identify recurring patterns:

**Setup patterns** — scan for repeated initialization code:
```bash
sg -p 'rs.spyOn($OBJ, $METHOD)' --json <target-dir>
sg -p 'beforeEach(() => { $$$ })' --json <target-dir>
sg -p 'beforeAll(() => { $$$ })' --json <target-dir>
```

**Action patterns** — scan for repeated operation calls:
```bash
sg -p 'await $FN($$$ARGS)' --json <target-dir>
```

**Assertion patterns** — scan for repeated expect shapes:
```bash
sg -p 'expect($ACTUAL).toBe($EXPECTED)' --json <target-dir>
sg -p 'expect($ACTUAL).toContain($EXPECTED)' --json <target-dir>
sg -p 'expect($ACTUAL).toMatchInlineSnapshot($$$SNAP)' --json <target-dir>
```

**Strategy for pattern discovery:**

1. Start broad — run generic patterns like `expect($A).$METHOD($B)` to see what assertion shapes exist
2. Drill down — for each high-frequency shape, run a more specific pattern to extract the fixed vs. variable parts
3. The ast-grep metavariables (`$VAR`, `$$$ARGS`) directly correspond to step `<param>` placeholders
4. Count matches per pattern across files to rank by frequency

Use `sg --json` output to get structured match data including file paths, match counts, and captured metavariable values.

### 3. Discover concepts via co-occurrence analysis

Concepts are **reusable building blocks** — commonly recurring groups of atomic steps, like helper functions. They make specs more concise by encapsulating multi-step patterns (setup phases, action sequences) into single lines.

**Understanding the two vocabulary layers:**
- **Atomic steps** = single operations — "Spy on console log", "Build mock test results", "Assert output contains X"
- **Concepts** = reusable groups of atomic steps — "Setup reporter with console capture", "Trigger reporter onTestRunEnd with X results"

Specs contain a mix of concepts and atomic steps. Concepts encapsulate recurring multi-step patterns; atomic steps provide precision for one-off operations and assertions.

**Step 1: Extract all `it()` / `test()` blocks:**
```bash
sg -p 'it($NAME, async () => { $$$ })' --json <target-dir>
sg -p 'it($NAME, () => { $$$ })' --json <target-dir>
sg -p 'test($NAME, async () => { $$$ })' --json <target-dir>
```

**Step 2: For each test block**, record which atomic steps (from step 2) appear inside it. Build a co-occurrence matrix.

**Step 3: Identify concept candidates** — groups of 2+ atomic steps that co-occur as a **partial sub-sequence** across multiple test blocks. Focus on recurring **phases** (setup groups, action groups), not entire test flows.

Key distinction: a concept should encapsulate a **reusable phase**, not a complete init→action→assert flow. If a candidate concept contains both setup and assertion steps, split it.

**Step 4: Name concepts as reusable operations.** The concept name should describe **what the step group does as a reusable action**, not the full test intent (that's the scenario heading's job).

```
Atomic steps found recurring together as a setup phase:
  - Spy on console "log" and capture output
  - Create JUnitReporter with rootPath "/test/root"

GOOD concept name (reusable operation):
  "Setup JUnitReporter with console capture"

BAD concept name (full test intent — too broad for a concept):
  "JUnitReporter should produce XML containing <text>"

Another recurring group (action phase):
  - Build mock test results with status "pass"
  - Build mock file result from test results
  - Call reporter onTestRunEnd with results

GOOD concept name:
  "Trigger reporter onTestRunEnd with <status> results"
```

**Step 5: Check concept coverage.** After identifying co-occurrence-based concepts, review the remaining atomic steps. If a group of 2+ atomic steps recurs as a coherent sub-sequence, propose it as a concept. Not every scenario needs to be a single concept line — scenarios are composed of concepts + atomic steps.

### 4. Present candidates to user

Present **concepts first** (reusable building blocks), then atomic steps. This ordering reflects that concepts encapsulate the most common recurring patterns.

**Concepts (reusable building blocks) — recurring step groups:**
```
| # | Concept (reusable operation) | Expands to | Used in test blocks |
|---|----------------------------|-----------|-------------------|
| 1 | Setup JUnitReporter with console capture | 2 atomic steps | 9 |
| 2 | Trigger reporter onTestRunEnd with <status> results | 3 atomic steps | 7 |
```

**Atomic steps — individual operations (used in concepts and directly in specs):**
```
| # | Step Pattern | Matches | Files | In concepts |
|---|-------------|---------|-------|------------|
| 1 | Spy on console <method> to capture output | 45 | 12 | concept #1 |
| 2 | Assert captured output contains <text> | 20 | 5 | — (used directly) |
| 3 | Build mock duration | 15 | 8 | concept #2 |
```

Atomic steps not in any concept are normal — they are used directly in specs for one-off or assertion operations.

**Wait for user feedback.** The user may:
- Rename concepts to better express intent
- Merge, split, or dissolve concepts
- Adjust which atomic steps belong to which concept
- Promote orphan atomic steps to new concepts

Iterate until the user confirms both the concept list and step list.

### 5. Generate files

**Step definition files** → `<OUTPUT_DIR>/*.ts`:

```ts
import { defineStep } from '@rstest/gauge';

defineStep('Capture console <method> output', (method) =>
  `const logs: string[] = [];
rs.spyOn(console, ${JSON.stringify(method)}).mockImplementation((...args) => {
  logs.push(args.join(' '));
});
onTestFinished(() => { rs.resetAllMocks(); });`
);
```

**Concept files** → `<OUTPUT_DIR>/concepts/*.md`:

```markdown
# Setup VerboseReporter with console capture

* Capture console "log" output
* Create VerboseReporter with rootPath "/test/root"

# Trigger reporter onTestRunEnd with <status> results

* Build mock test results with status <status>
* Build mock file result from test results
* Call reporter onTestRunEnd with results
```

Concept files use Gauge concept format: `#` heading is the concept pattern (a reusable operation, not a full test intent), `*` lines are the atomic steps it expands to. Parameters in the concept heading flow through to the atomic steps via `<param>` substitution.

### 6. Validation

After writing files:
- Verify step `.ts` files compile (no syntax errors)
- Verify step patterns are unique (no two steps match the same text)
- Verify every atomic step referenced in concept files has a matching `defineStep`
- Report: total atomic steps, total concepts, grouped by category

## Key principles

- **Two vocabulary layers** — atomic steps are single operations, concepts are reusable groups of atomic steps. Specs contain a mix of both: concepts for recurring multi-step patterns, atomic steps for one-off operations and assertions.
- **Concepts are reusable building blocks, not complete test flows** — a concept should encapsulate a recurring phase (setup, action), not an entire init→action→assert sequence. If a concept contains both setup and assertion, it's too big — split it.
- **Name concepts as reusable operations** — a concept name should describe what the step group does as a repeatable action, not the full test intent. Bad: "Reporter should produce output containing X" (that's a scenario heading). Good: "Setup reporter with console capture", "Trigger reporter onTestRunEnd with X results".
- **ast-grep is the source of truth for pattern extraction** — do not manually read files to guess patterns; use `sg` for structural matching
- **Metavariables map to step params** — `$VAR` in ast-grep → `<var>` in step pattern → function parameter in code template
- **Parameters must be data values, never code expressions** — a step parameter should be a string, number, or identifier (e.g., `"hello"`, `"log"`, `"3"`). If a parameter would contain code syntax like dots, parentheses, or brackets (e.g., `logs.join('\n')`), the step is too generic. Split it into domain-specific steps instead.
- **English step patterns** for broad compatibility
- **Keep templates close to existing code** — map directly to helpers and patterns already used in the codebase, do not invent new abstractions
- **Parameterize only what varies** — if a metavariable has the same value in all matches, hardcode it in the template
- **Prefer fewer, higher-quality steps** over exhaustive coverage — a pattern matched <3 times is probably not worth extracting as an atomic step (but may still be part of a concept)
