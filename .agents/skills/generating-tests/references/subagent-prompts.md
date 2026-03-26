# Subagent Prompt Templates

Full prompt templates for Generate mode subagents. Load this file when running Generate mode.

---

## Subagent A: The Archaeologist (git history)

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

---

## Subagent B: The Static Analyzer (source code)

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

---

## Subagent C: The Doc Analyst (documentation)

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
- Behaviors that clearly belong to upstream dependencies rather than the
  target module's own source code

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
