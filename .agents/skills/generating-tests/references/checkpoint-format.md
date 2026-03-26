# Checkpoint Report Format

Both Generate and Audit modes **must** produce a checkpoint report before taking any action (writing tests or applying fixes). The agent **must stop and wait for user selection** — proceeding without explicit approval is forbidden.

## Quantity Control

- **Generate mode**: Report only `high` and `medium` priority findings. Do not include low-priority items. If findings were excluded, mention the count (e.g., "5 low-priority items omitted").
- **Audit mode**: Report all `error` and `warning` findings. Collapse `info` findings into a single summary line (e.g., "Also found 6 info-level items: 3× TST-061, 2× TST-063, 1× TST-065") — do not give them individual rows. If the user asks for details, expand them.

---

## Generate Mode Checkpoint

### Header

```
## 🧪 Missing Test Report: <target-file-or-module>

Analyzed by: Archaeologist (git) | Static Analyzer (source) | Doc Analyst (docs)
Test inventory: N existing tests in <test-file>
```

### Findings Table

| #   | Priority | Missing Behavior                                                      | Source Evidence                                     | Why This Needs a Test                                                                         | Found By     |
| --- | -------- | --------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------ |
| 1   | high     | `publicDir.name=''` should throw                                      | `defaultConfig.ts:371` — `throw new Error(...)`     | Explicit throw path — silent regression if removed; docs promise this validation              | doc + static |
| 2   | high     | `loader='auto'` fallback from native to jiti when native import fails | `loadConfig.ts:143-167` — `catch → retry with jiti` | Fallback logic — if native loader fails, must degrade gracefully; untested = silent breakage  | doc          |
| 3   | medium   | `server.host=true` normalizes to `'0.0.0.0'`                          | `defaultConfig.ts:344-349` — `if (host === true)`   | Simple value mapping — low regression risk but documented behavior should have basic coverage | doc          |

Column definitions:

- **#**: Sequential number for user selection
- **Priority**: `high` or `medium` (see priority guide below)
- **Missing Behavior**: What the test should verify — one sentence, specific and actionable
- **Source Evidence**: `file:line` + the key code construct (branch, throw, condition)
- **Why This Needs a Test**: Explain _why_ this gap matters — what breaks silently without it
- **Found By**: Which subagent(s) discovered this: `doc`, `static`, `history`, or combined like `doc + static`

### Priority Guide

- **high**: error/throw paths, fallback/recovery logic, security boundaries, historical bug regressions, behaviors with explicit caveats in docs
- **medium**: happy-path value mappings, simple normalization, straightforward config defaults, branch variants of already-tested mechanisms

### Already Covered Section

After the findings table, list behaviors that are already tested:

```
Already covered (no action needed):
  - "parses config from .ts file": covers config file loading
  - "addPlugins appends to list": covers basic plugin registration
```

### Docs Drift Section (if applicable)

```
Docs drift (documentation describes behavior not found in current source):
  - docs/en/config/server.md § "Legacy Mode": source no longer has legacy mode branch
```

### User Prompt

End with exactly:

```
Please select which items to generate tests for:
- Reply with numbers (e.g., "1, 2, 5") to select specific items
- Reply "all" to generate all
- Reply "high" to generate high-priority only
- Reply "skip" to abort
```

---

## Audit Mode Checkpoint

### Header

```
## 🔍 Test Audit Report: <scope>

Files audited: N test files, M test cases
Rules applied: Layer 1 (grep) + Layer 2 (semantic) + Layer 3 (cross-file)
```

### Findings Table

| #   | Severity   | Rule    | Fixable | Location                          | Problem                              | Evidence & Explanation                                                                                   | Suggested Fix                                   |
| --- | ---------- | ------- | ------- | --------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | 🔴 error   | TST-004 | no      | `rsbuild.test.ts:45`              | No assertion in test body            | `it('loads config', () => { loadConfig('/path'); });` — runs code but proves nothing                     | Add `expect()` assertion on return value        |
| 2   | 🔴 error   | TST-011 | partial | `snapshot.test.ts:78`             | Wrong async throw pattern            | `expect(async () => await save(d)).toThrow();` — `toThrow` cannot catch async rejections                 | Change to `await expect(...).rejects.toThrow()` |
| 3   | 🟡 warning | TST-051 | no      | `pluginManager.test.ts` (missing) | 3 throw paths in source, none tested | `pluginManager.ts:27` throw "webpack plugin", `:45` throw "invalid plugin", `:89` throw "duplicate name" | Write error-path tests for each distinct throw  |

Column definitions:

- **#**: Sequential number for user selection
- **Severity**: `🔴 error` (must fix) / `🟡 warning` (should fix)
- **Rule**: Rule ID from audit-rules.md (e.g., TST-004)
- **Fixable**: `yes` (auto-fixable) / `partial` (needs review) / `no` (manual)
- **Location**: `file:line` of the problematic test (or "missing" for coverage gaps)
- **Problem**: One-line summary of what is wrong
- **Evidence & Explanation**: The actual offending code + why it is a problem
- **Suggested Fix**: Concrete action — not vague advice

### Info Summary

After the table, collapse info-level findings into one line:

```
ℹ️ Also found N info-level items: X× TST-061 (duplicate tests), Y× TST-063 (unused imports), Z× TST-065 (debug residue)
```

### Summary Stats

```
Summary: X errors, Y warnings — A auto-fixable, B need manual review
```

### User Prompt

End with exactly:

```
Please select which items to fix:
- Reply with numbers (e.g., "1, 2, 5") to select specific items
- Reply "all" to fix all
- Reply "errors" to fix errors only
- Reply "skip" to abort
```

---

## Formatting Rules

1. **Use Markdown tables** — keep each cell single-line; use inline code for file paths and code snippets
2. **Every column must be filled** — no empty cells; use "—" if not applicable
3. **Source evidence must include actual code** — not just file:line references; show the code construct so the reader can judge without opening the file
4. **"Why" / "Explanation" must answer: what breaks if we ignore this?** — not just restate the rule
5. **Keep each row self-contained** — the reader should understand the finding without looking at other rows or files
6. **Number rows sequentially** starting from 1 — these numbers are the selection interface
