---
name: generating-tests
description: 'Generates high-value missing tests and audits existing test quality. Use when the user wants to add tests, improve test coverage, review test quality, or find weak/duplicate/meaningless tests.'
metadata:
  internal: true
---

# Test Generation & Audit

Two modes: **Generate** (discover and write missing tests) and **Audit** (find and fix problems in existing tests).

```
User task → What do they want?
    ├─ "Add tests" / "Cover this module" / "补测试"
    │   └─ Mode: Generate (Section 1)
    │
    └─ "Review test quality" / "审查测试" / "Fix bad tests"
        └─ Mode: Audit (Section 2)
```

---

## Preflight (shared by both modes)

Before entering either mode, resolve these three things:

### 1. Source ↔ Test mapping

Given a target file, find its test counterpart (or vice versa). Try in order:

1. Same directory: `foo.ts` → `foo.test.ts`
2. Sibling `__tests__/`: `src/foo.ts` → `src/__tests__/foo.test.ts`
3. Mirror `tests/` tree: `src/core/foo.ts` → `tests/core/foo.test.ts`
4. Package-level: `packages/core/src/foo.ts` → `packages/core/tests/**/foo.test.ts`

If multiple matches exist, prefer the one whose imports reference the target. If no test file exists (Generate mode), note that a new file will be created.

### 2. Convention discovery

Read 1–2 existing test files in the same directory to learn:

- Import style and test framework usage (describe/it nesting, assertion patterns)
- Helper functions, fixtures, and shared setup patterns
- File naming conventions

### 3. Test type classification

Determine whether the target tests are **unit** (single module, mocked dependencies) or **integration/e2e** (multi-module, real dependencies). This affects:

- Generate mode: scope of analysis and mock expectations
- Audit mode: Layer 3 cross-file rules only apply to unit-style tests with a clear primary subject

### 4. Collect existing test inventory

Use `rstest list` to get a structured view of existing tests:

```bash
# JSON output with file, name, location for each test case
pnpm rstest list --json '<target-test-file>'

# With line/column locations
pnpm rstest list --json --printLocation '<target-test-file>'

# List only test files in scope (no individual cases)
pnpm rstest list --filesOnly '<directory>'
```

This is more reliable than grep-matching `it(` patterns — it handles `it.each`, dynamic names, and nested suites correctly.

### 5. Execution command

Use the `testing` skill to determine the correct run command. Do **not** hardcode `pnpm rstest` — the command varies by package, e2e vs unit, and working directory.

---

## Section 1: Generate — Discover & Write Missing Tests

### Step 1: Identify target

Ask the user for the target file or directory if not provided. Run Preflight to resolve mapping, conventions, and test type.

For **small single-file targets**, you may skip subagents and perform analysis directly. Use subagents when the scope involves multiple files or when git history analysis would benefit from isolation.

### Step 2: Discovery — dispatch two subagents in parallel

Use the `Task` tool to dispatch both subagents concurrently.

#### Subagent A: The Archaeologist (git history)

Prompt the subagent with:

```
Analyze the git history of <target-file> to find historical bugs and regression-worthy scenarios.

1. Run: git log --follow --oneline --all -- '<target-file>' | head -40
2. For commits that look like bug fixes (keywords: fix, bug, regression, patch, revert, edge case),
   run: git show <sha> -- '<target-file>'
3. For each bug fix found, extract:
   - What was broken (the bug)
   - What input/state triggered it
   - Whether a regression test already exists (search existing test files)

Return a JSON array:
[
  {
    "sha": "<short sha>",
    "description": "<what was broken>",
    "trigger": "<input/condition that caused it>",
    "has_regression_test": true/false,
    "evidence": "<relevant code snippet, max 5 lines>"
  }
]
```

#### Subagent B: The Static Analyzer (source code analysis)

First, run the analysis script to get a deterministic inventory of exports and error paths:

```bash
node .agents/skills/generating-tests/scripts/analyzeSource.cjs '<target-file>'
```

This outputs JSON with `exports` (all public symbols with kind/name/line) and `throws` (all throw/reject statements with line/message/expression). Use this output instead of reading the full source file — it saves tokens and is more accurate than manual counting.

Then prompt the subagent with:

```
Here is the static analysis output for <target-file>:
<paste JSON from analyzeSource.cjs>

And here is the existing test inventory from `rstest list --json`:
<paste JSON from rstest list>

Your tasks:
1. For each export in the analysis output, check if it has corresponding tests. Mark tested/untested.
2. For each throw/reject, check if there is a corresponding toThrow/rejects.toThrow test. Mark tested/untested.
3. Read the source file briefly to identify additional behaviors not captured by the script:
   branches, boundary checks, nullish guards, switch/case variants.
   (Focus on the areas around untested exports and throws — don't read the entire file.)

Return a JSON array:
[
  {
    "behavior": "<description>",
    "location": "<file:line>",
    "tested": true/false,
    "existing_test": "<test name if tested, null otherwise>",
    "priority": "high|medium|low"
  }
]

Priority guide: high = error paths + historical bugs, medium = branches + boundaries, low = happy path variants.
```

### Step 3: Synthesize & propose

Collect results from both subagents. Deduplicate by root cause (one finding per behavior, not per detection method). Present a prioritized list to the user:

```
Found N missing test scenarios for <target>:

High priority:
  [1] <description> — <reason: historical bug / untested error path / ...>
  [2] ...

Medium priority:
  [3] ...

Already covered (no action needed):
  - <existing test name>: covers <behavior>
```

**Wait for user approval** before proceeding. The user may select all, pick specific numbers, or skip.

### Step 4: Write tests

For each approved scenario, generate the test code. Before writing:

1. **Follow conventions** discovered in Preflight — do not invent new patterns
2. **One focused `it()` per scenario** — do not combine behaviors
3. Place new tests in the correct file following the project's structure
4. When editing `.ts`/`.tsx` files, follow the `typescript` skill guidelines

### Step 5: Auto-healing loop

After writing, run the tests and fix failures automatically.

```
Loop (max 3 iterations):
  1. Run the test using the command determined in Preflight
  2. If exit code 0 → done, report success
  3. If exit code != 0 → parse both stdout and stderr
  4. Diagnose failure type from the structured md reporter output:

     Failure type           │ Signal                              │ Fix strategy
     ───────────────────────┼─────────────────────────────────────┼──────────────────────────
     Syntax/transform error │ stderr: SyntaxError, parse error    │ Fix syntax in test file
     Import/module error    │ "Cannot find module", "not exported"│ Fix import path or name
     AssertionError + diff  │ type: "AssertionError", diff block  │ Use diff to fix assertion
     SnapshotMismatchError  │ type: "SnapshotMismatchError"       │ Review diff; only -u if
                            │                                     │ agent wrote the snapshot
     TypeError/ReferenceError│ type in error details              │ Read candidateFiles, fix
     Timeout                │ message contains "timed out"        │ Simplify async or ↑ timeout
     Mock hoisting error    │ "hoisted", factory errors           │ Fix vi.mock placement
     Unrelated pre-existing │ failures in tests the agent didn't  │ Ignore — not our problem
                            │ write or modify                     │

  5. Apply fix (edit test file only — never modify source code)
  6. Loop back to step 1
```

After 3 failed iterations, stop and present the md reporter output to the user with a diagnosis summary.

**Note**: rstest auto-detects agent environments and switches to `md` reporter, which outputs structured Markdown with JSON details blocks, diff blocks, code frames, and reproduction commands. Parse these sections to diagnose failures. Also check stderr for errors that occur before the reporter runs (syntax errors, module resolution failures).

---

## Section 2: Audit — Find & Fix Test Quality Issues

### Step 1: Identify scope

Ask the user for the target test file or directory if not provided. Collect all `.test.ts` / `.test.tsx` / `.spec.ts` files in scope. Run Preflight for each file.

For large scopes (>10 files), prioritize: recently changed files first, then files with known failures, then the rest. Batch small files together.

### Step 2: Run audit — dispatch subagents per file (or batch)

For each test file (or batch of small files), dispatch a subagent with the audit rules.

Prompt each Audit subagent with:

```
Audit the test file <test-file> against the rules in references/audit-rules.md.

Test type: <unit|integration> (from Preflight)
- If integration: apply only Layer 1 and Layer 2 rules. Skip Layer 3.
- If unit: apply all three layers. For Layer 3, use the analysis script output below.

Static analysis of <source-file> (from scripts/analyzeSource.cjs):
<paste JSON output>

Existing test inventory (from rstest list --json):
<paste JSON output>

For each violation found, report:
- rule_id: <e.g., TST-004>
- severity: error | warning | info
- location: <file:line>
- description: <what's wrong>
- suggestion: <how to fix>
- auto_fixable: true/false
- evidence: <the offending code snippet, max 3 lines>

Dedupe: report one finding per root cause. If TST-003 (empty body) fires, do not also report TST-004 (no assertion) for the same test.
```

### Step 3: Present audit report

Collect and merge all subagent results. Present grouped by severity:

```
Audit results for <scope> (X files, Y test cases):

🔴 Errors (must fix):
  - <file>:<line> [TST-004] No assertion in test body
  - <file>:<line> [TST-010] Missing await on async expect

🟡 Warnings (should fix):
  - <file>:<line> [TST-030] Weak assertion: toBeTruthy() on structured return value
  - <file>:<line> [TST-051] Source throws 3 distinct errors, none tested

🔵 Info (consider fixing):
  - <file>:<line> [TST-061] 4 similar tests could use it.each
```

**Wait for user approval** before applying fixes.

### Step 4: Apply fixes

For approved fixes:

1. Apply auto-fixable changes directly via `edit_file`
2. For non-auto-fixable warnings, propose the fix and let the user confirm
3. After all edits, run the tests (using the `testing` skill) to confirm nothing broke

---

## Guardrails

- **Never modify source code** — only test files. If a test failure reveals a source bug, report it to the user.
- **Never add dependencies** — use only what the project already has.
- **Mimic existing conventions** — always read nearby test files before writing.
- **Propose before acting** — always show the plan and wait for user confirmation before generating or modifying tests.
- **Error severity = high confidence** — only flag as `error` when evidence is local and unambiguous. Use `warning` for cross-file heuristic findings.
- **Use sibling skills** — use `testing` for execution commands, `typescript` for code quality in test files.

## Audit Rule Reference

The complete rule catalog is in [references/audit-rules.md](references/audit-rules.md). Load it when running audit mode.
