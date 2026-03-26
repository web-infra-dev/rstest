---
name: generating-tests
description: >
  Generates high-value missing tests and audits existing test quality.
  Use when the user wants to add tests, improve test coverage, write tests
  for a module, review test quality, find weak/duplicate/meaningless tests,
  or asks "补测试" / "审查测试".
---

# Test Generation & Audit

Two modes: **Generate** (discover and write missing tests) and **Audit** (find and fix problems in existing tests).

```
User task → "Add tests" / "Cover this module"  → Generate (Section 1)
          → "Review test quality" / "Fix tests" → Audit (Section 2)
```

---

## Preflight (shared by both modes)

### 1. Source ↔ Test mapping

Find the test counterpart for a target file (or vice versa). Try common patterns: same directory (`.test.*` / `.spec.*`), sibling `__tests__/`, mirrored `tests/` tree, or workspace-local test directories. Match both `.test` and `.spec` across JS/TS extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`). Prefer the file whose imports reference the target.

### 2. Convention discovery

Read 1–2 existing test files nearby to learn import style, framework usage (describe/it nesting, assertion patterns), helpers, fixtures, and naming conventions.

### 3. Test type classification

Determine **unit** (single module, mocked deps) vs **integration/e2e** (multi-module, real deps). This affects subagent scope and which audit rules apply.

### 4. Locate documentation (Generate mode only)

Check for `docs/`, `website/`, `README.md`, or package-level docs. If ambiguous or external, **ask the user to confirm** the documentation path. If no documentation exists, skip the Doc Analyst subagent.

### 5. Collect existing test inventory

Collect file-level and test-name-level information — **do not read file contents** at this stage.

- **Unit tests**: Use the project's test runner list mode if available, otherwise fall back to globbing test files and scanning test names.
- **E2E / integration tests** (if applicable): Check if the project has a separate e2e layer. If it exists, collect relevant test files. If not, skip.

### 6. Execution command

Detect the test run command from `package.json` scripts and runner config. Do not hardcode any specific runner.

---

## Section 1: Generate — Discover & Write Missing Tests

### Step 1: Identify target

Ask the user for the target file or directory if not provided. Run Preflight. For small single-file targets, skip subagents and analyze directly.

### Step 2: Discovery — dispatch subagents

Dispatch only the subagents needed:

- If the user requests a subset (e.g., "Doc Analyst only"), honor that.
- Default: A (Archaeologist) + B (Static Analyzer) always; C (Doc Analyst) only if docs exist.
- Without Static Analyzer, Step 2.5 verification becomes critical.

Use `Task` to dispatch concurrently.

#### Subagent A: The Archaeologist (git history)

Analyze git history to find historical bugs and missing regression tests. Return JSON with `sha`, `description`, `trigger`, `has_regression_test`, `evidence`.

See [references/subagent-prompts.md](references/subagent-prompts.md) for the full prompt template.

#### Subagent B: The Static Analyzer (source code)

Run the skill-bundled analysis script on the target file:

```bash
node <skill-root>/scripts/analyzeSource.cjs '<target-file>'
```

If the script fails (e.g., `typescript` not installed), fall back to a brief manual scan of exports and throw/reject statements.

The script outputs JSON with `exports` and `throws`. Feed this + test inventory to the subagent. See [references/subagent-prompts.md](references/subagent-prompts.md) for the full prompt.

#### Subagent C: The Doc Analyst (documentation)

Only if documentation was found. Scope reduction: if >20 doc files, filter by target module name first.

Extract **distinct mechanisms** (not every default value). Focus on throw paths, fallback/recovery, caveats, and branch-worthy behaviors. Compare against both unit and e2e test inventory.

See [references/subagent-prompts.md](references/subagent-prompts.md) for the full prompt template.

### Step 2.5: Verify candidate findings

Subagent output is **candidates, not truth**. Verify before synthesis:

1. **Source existence**: Confirm each behavior exists in the target source (not upstream).
2. **E2e coverage** (if applicable): Check if already covered by e2e tests.
3. **Testability filter**: Separate behaviors better suited for e2e from unit test gaps.

Only verified findings proceed to Step 3.

### Step 3: Synthesize & propose

Apply deduplication in two passes:

1. **Cross-subagent dedup**: Merge duplicate findings across subagents. Prefer Doc Analyst descriptions. Separate `docs_drift` findings into their own section.
2. **Mechanism-level dedup**: Group behaviors that share the same code path into one test proposal.

Present using the **Generate Mode Checkpoint** in [references/checkpoint-format.md](references/checkpoint-format.md).

**⛔ MANDATORY STOP**: Do NOT proceed to Step 4 until the user has replied with their selection.

### Step 4: Write tests

For each approved scenario:

1. Follow conventions from Preflight — do not invent new patterns
2. One focused `it()` per scenario
3. Test the mechanism, not every input variant
4. Place tests in the correct file per project structure

### Step 5: Auto-healing loop

```
Loop (max 3 iterations):
  1. Run tests
  2. Exit 0 → done
  3. Exit != 0 → diagnose from stdout/stderr:
     - Syntax/import errors → fix test file
     - Assertion failures → use diff to fix expected values
     - Snapshot mismatch → review diff; only update if agent-written
     - Timeout → simplify async or increase timeout
     - Unrelated failures → ignore
  4. Apply fix (test file only — never modify source)
  5. Loop
```

After 3 failures, stop and report to user.

---

## Section 2: Audit — Find & Fix Test Quality Issues

### Step 1: Identify scope

Collect test files (`.test.*`, `.spec.*`) in scope. Run Preflight for each. For large scopes (>10 files), prioritize recently changed files first.

### Step 2: Dispatch audit subagents

For each file or batch, dispatch with the audit rules from [references/audit-rules.md](references/audit-rules.md).

Feed static analysis output (if available) and test inventory. Apply Layer 1+2 for all tests; Layer 3 only for unit tests with clear source mapping.

### Step 3: Present audit report

Present using the **Audit Mode Checkpoint** in [references/checkpoint-format.md](references/checkpoint-format.md).

**⛔ MANDATORY STOP**: Do NOT proceed to Step 4 until the user has replied with their selection.

### Step 4: Apply fixes

1. Auto-fixable → apply directly
2. Non-auto-fixable → propose and confirm
3. Run tests to verify

---

## Guardrails

- **Mandatory checkpoint** — present formatted report and wait for user selection before any write action. Never skip or auto-select.
- **Never modify source code** — only test files. Report source bugs to the user.
- **Never add dependencies** — use only what the project already has.
- **Follow project conventions** — use the project's test runner, mock API, and coding standards. Do not assume any specific framework.
- **Error = high confidence** — only flag as `error` with unambiguous local evidence. Use `warning` for heuristic findings.

## References

- [references/checkpoint-format.md](references/checkpoint-format.md) — Checkpoint report table format (Generate + Audit)
- [references/audit-rules.md](references/audit-rules.md) — Complete audit rule catalog (load in Audit mode)
- [references/subagent-prompts.md](references/subagent-prompts.md) — Full subagent prompt templates (load in Generate mode)
