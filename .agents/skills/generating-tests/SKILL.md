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

Before entering either mode, resolve these things:

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

### 4. Locate documentation (Generate mode only)

Find documentation that describes the target module's user-facing behavior. Try in order:

1. **Same repo**: Check for `docs/`, `website/`, `README.md`, or a doc directory referenced in the repo root README
2. **Package-level**: Check `packages/<name>/README.md` or a `docs/` folder within the package
3. **External repo**: If the README or docs link to an external documentation repository, note the URL

If documentation is found automatically, proceed. If the location is ambiguous or external, **ask the user to confirm** the documentation path or URL before dispatching the Doc Analyst.

If no documentation exists for the target, skip the Doc Analyst subagent entirely.

### 5. Collect existing test inventory

Collect test coverage — **do not read file contents at this stage**, only collect file-level and test-case-name-level information:

**Unit tests**: Use the project's test runner to list existing tests. Detect the runner from `package.json` scripts or config files, then use the appropriate list command:

- rstest / vitest: `npx rstest list --filesOnly '<dir>'` or `npx vitest list --json '<file>'`
- jest: `npx jest --listTests` or parse test files with grep
- Other runners: fall back to `grep -r "it\(\\|test\(" --include='*.test.*' '<dir>' -l`

**E2E / integration tests (if applicable)**: Check whether the project has a separate e2e or integration test layer (e.g., `e2e/`, `tests/integration/`, `test/e2e/`, or similar). If such a directory exists, collect a file-level list of relevant test files and fixture directories. If the project has no e2e layer, skip this — not every project has one.

When e2e coverage exists, both layers feed into subagent prompts. If a behavior appears covered by e2e, it should not be reported as a missing unit test unless there is a specific reason to also test it at the unit level.

### 6. Execution command

Determine the correct test run command by inspecting `package.json` scripts and the project's test runner configuration. Do **not** hardcode any specific runner command — the command varies by project, runner, package, and working directory.

---

## Section 1: Generate — Discover & Write Missing Tests

### Step 1: Identify target

Ask the user for the target file or directory if not provided. Run Preflight to resolve mapping, conventions, and test type.

For **small single-file targets**, you may skip subagents and perform analysis directly. Use subagents when the scope involves multiple files or when git history analysis would benefit from isolation.

### Step 2: Discovery — dispatch subagents

Dispatch only the subagents needed for the user's request and the target scope:

- If the user explicitly requests a subset (e.g., "Doc Analyst only"), honor that — skip the others.
- Default: dispatch A (Archaeologist) and B (Static Analyzer) always; dispatch C (Doc Analyst) only if documentation was found in Preflight step 4.
- When running without the Static Analyzer, doc-sourced findings cannot be validated against source code — Step 2.5 (verification) becomes especially important.

Use the `Task` tool to dispatch selected subagents concurrently.

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

And here is the existing test inventory:
<paste test inventory from Preflight step 5>

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

#### Subagent C: The Doc Analyst (documentation-driven discovery)

Only dispatch this subagent if documentation was located in Preflight step 4.

Prompt the subagent with:

```
Read the documentation at <doc-path-or-url> that covers <target-module>.

SCOPE REDUCTION: If the doc directory contains many files (>20), first scan
filenames and section headings to identify only the files relevant to the
target module. Do not read every doc file — focus on the ones whose path or
title matches the target package/module name.

Extract **distinct user-facing mechanisms** described in the docs. Focus on:
- Error/throw paths and explicit validation rules
- Fallback, retry, and recovery behaviors
- Caveats, warnings, or "gotchas" explicitly called out
- Behaviors with dedicated code branches/mechanisms
- API usage examples with specific arguments/options

Do NOT extract:
- Trivial default values ("default is X") unless the default involves a
  distinct branch or conditional logic
- Simple value pass-through that is likely covered by snapshot or e2e tests
- Behaviors that clearly belong to upstream dependencies (e.g., bundler
  internals) rather than the target module's own source code

Then compare with the existing test inventory:
<paste unit test inventory from Preflight step 5>
<if e2e/integration test list was collected in Preflight, paste it here>

For each documented behavior, determine if a corresponding test exists.
If the project has e2e tests, check both unit AND e2e layers — if covered
by e2e, mark as tested.

Additionally, verify that each documented behavior still exists in the current
source. If a documented behavior cannot be matched to any function, branch,
or code path in the current source, mark it as "docs_drift".

When multiple documented behaviors appear to target the same source function
or adjacent line range, assign them the same "mechanism_group" string so
they can be deduplicated downstream.

Return a JSON array:
[
  {
    "documented_behavior": "<what the docs say>",
    "doc_location": "<doc-file section heading or path:section>",
    "tested": true/false,
    "test_layer": "<unit | e2e | none>",
    "status": "missing_test | docs_drift",
    "existing_test": "<test name if tested, null otherwise>",
    "mechanism_group": "<shared group label, or null if unique>",
    "recommended_test_layer": "unit | e2e",
    "priority": "high | medium"
  }
]

Priority guide:
- high: error/throw paths, fallback/recovery logic, security boundaries,
  behaviors with explicit caveats in the docs
- medium: happy-path value mappings, simple normalization, straightforward
  config defaults

Do NOT include source file line numbers — source location mapping is handled
separately by the Static Analyzer. Only report documentation locations.
```

### Step 2.5: Verify candidate findings

Subagent output is **candidate findings, not verified truth**. Before synthesis, verify each candidate:

1. **Source existence check**: For each "missing test" finding, confirm the behavior actually exists in the target module's source code. If the behavior belongs to an upstream dependency or a different package, discard it.
2. **E2e coverage check** (if the project has e2e tests): For findings marked `test_layer: "none"`, do a quick check against e2e fixture names and test file names. If a matching e2e test exists, mark as covered.
3. **Testability filter**: For findings with `recommended_test_layer: "e2e"`, do not include them in a unit test gap report — note them separately as "better suited for e2e".

Only verified high-confidence findings proceed to Step 3. Discard or group unverifiable items separately as "needs manual review".

This step is especially important when running without the Static Analyzer (e.g., Doc Analyst only mode), since there is no source-grounded cross-check.

### Step 3: Synthesize & propose

Collect results from all subagents. Before presenting to the user, apply deduplication in two passes:

#### Pass 1: Cross-subagent dedup

When the same behavior appears in multiple subagent results (e.g., Doc Analyst reports an untested throw path that Static Analyzer also found via `throws`), **merge into one finding**. Prefer the Doc Analyst's description (more user-facing) and tag the source as `doc + static` or `doc + history`. Do not present the same behavior twice from different subagents.

For Doc Analyst findings with `status: "docs_drift"`, separate them into a dedicated **Docs Drift** section in the report — these are not missing tests but documentation accuracy issues to flag to the user.

#### Pass 2: Mechanism-level dedup — test mechanisms, not enumerations

When multiple documented/discovered behaviors share the same underlying code path, **group them and propose one test for the mechanism**, not one test per input variant.

How to identify shared mechanisms:

1. Read the source to check if multiple behaviors flow through the same function or branch
2. If N options are all processed by the same normalization function (e.g., `normalizePaths` handles multiple path-type config fields), propose **one test for the mechanism** + a brief note that it covers the other options
3. If N API options all go through the same validation/merge logic, test the logic once with a representative input

Example — BAD (enumerate every option):

```
[1] path placeholder in optionA — doc
[2] path placeholder in optionB — doc
[3] path placeholder in optionC — doc
[4] path placeholder in optionD — doc
[5] path placeholder in optionE — doc
```

Example — GOOD (test the mechanism):

```
[1] path placeholder replacement in path-type options — doc
    (covers optionA, optionB, optionC, optionD, optionE — all use normalizePaths)
```

Present the deduplicated findings using the **Generate Mode Checkpoint** format defined in [references/checkpoint-format.md](references/checkpoint-format.md). Load the format reference and follow it exactly — Markdown table with all required columns, Already Covered section, Docs Drift section (if applicable), and the user selection prompt.

**⛔ MANDATORY STOP**: Do NOT proceed to Step 4 (writing tests) until the user has replied with their selection. This checkpoint is not optional — the agent must present the table and wait. No exceptions.

### Step 4: Write tests

For each approved scenario, generate the test code. Before writing:

1. **Follow conventions** discovered in Preflight — do not invent new patterns
2. **One focused `it()` per scenario** — do not combine behaviors
3. **Test the mechanism, not every input** — if one test exercises a shared code path, don't add near-identical tests for each variant that uses that path. When a single assertion proves the mechanism works, additional variants are noise.
4. Place new tests in the correct file following the project's structure
5. When editing `.ts`/`.tsx` files, follow the project's TypeScript conventions

### Step 5: Auto-healing loop

After writing, run the tests and fix failures automatically.

```
Loop (max 3 iterations):
  1. Run the test using the command determined in Preflight
  2. If exit code 0 → done, report success
  3. If exit code != 0 → parse both stdout and stderr
  4. Diagnose failure type from the test output:

     Failure type           │ Signal                              │ Fix strategy
     ───────────────────────┼─────────────────────────────────────┼──────────────────────────
     Syntax/transform error │ stderr: SyntaxError, parse error    │ Fix syntax in test file
     Import/module error    │ "Cannot find module", "not exported"│ Fix import path or name
     AssertionError + diff  │ type: "AssertionError", diff block  │ Use diff to fix assertion
     SnapshotMismatchError  │ type: "SnapshotMismatchError"       │ Review diff; only -u if
                            │                                     │ agent wrote the snapshot
     TypeError/ReferenceError│ type in error details              │ Read candidateFiles, fix
     Timeout                │ message contains "timed out"        │ Simplify async or ↑ timeout
     Mock hoisting error    │ "hoisted", factory errors           │ Fix mock placement
     Unrelated pre-existing │ failures in tests the agent didn't  │ Ignore — not our problem
                            │ write or modify                     │

  5. Apply fix (edit test file only — never modify source code)
  6. Loop back to step 1
```

After 3 failed iterations, stop and present the test output to the user with a diagnosis summary.

Parse both stdout and stderr to diagnose failures. Check stderr for errors that occur before the reporter runs (syntax errors, module resolution failures).

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

Existing test inventory (from Preflight step 5):
<paste test inventory>

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

Collect and merge all subagent results. Present findings using the **Audit Mode Checkpoint** format defined in [references/checkpoint-format.md](references/checkpoint-format.md). Load the format reference and follow it exactly — Markdown table with all required columns (Severity, Rule, Fixable, Location, Problem, Evidence & Explanation, Suggested Fix), info summary line, stats, and the user selection prompt.

**⛔ MANDATORY STOP**: Do NOT proceed to Step 4 (applying fixes) until the user has replied with their selection. This checkpoint is not optional — the agent must present the table and wait. No exceptions.

### Step 4: Apply fixes

For approved fixes:

1. Apply auto-fixable changes directly via `edit_file`
2. For non-auto-fixable warnings, propose the fix and let the user confirm
3. After all edits, run the tests to confirm nothing broke

---

## Guardrails

- **Mandatory checkpoint** — both modes require a formatted checkpoint report (see [references/checkpoint-format.md](references/checkpoint-format.md)) before any write action. The agent must stop and wait for user selection. Skipping the checkpoint or auto-selecting is forbidden.
- **Never modify source code** — only test files. If a test failure reveals a source bug, report it to the user.
- **Never add dependencies** — use only what the project already has.
- **Mimic existing conventions** — always read nearby test files before writing.
- **Propose before acting** — always show the plan and wait for user confirmation before generating or modifying tests.
- **Error severity = high confidence** — only flag as `error` when evidence is local and unambiguous. Use `warning` for cross-file heuristic findings.
- **Follow project conventions** — use the project's test runner, mock API, and coding standards. Do not assume any specific framework.

## Audit Rule Reference

The complete rule catalog is in [references/audit-rules.md](references/audit-rules.md). Load it when running audit mode.
