---
name: rstestty-gen
description: 'Generate Gauge-style test spec for intent review, then expand to test code. Accepts optional prompt for test target; defaults to git-diffed src files.'
metadata:
  internal: true
---

<command-name>rstestty-gen</command-name>

# rstestty-gen: Generate Tests via Gauge Spec

Two-phase test generation: first produce a Gauge-style spec for human intent review, then deterministically expand + agent-assemble into test code.

## Input

- **With prompt**: user describes what to test (e.g., "test the retry logic", "write tests for the new parser")
- **No prompt**: analyze `git diff` of changed src files to infer what needs testing

## Prerequisites

- Step library must exist (run `/rstestty-setup` first if it doesn't)
- If step library is missing or empty, inform the user and stop

## Step library discovery

The step library is **not** at a fixed path. Locate it by searching for a `steps/` directory containing `.ts` step definition files:

1. **Explicit path in prompt** — if the user specifies a steps directory (e.g., "using steps from packages/core/steps"), use that directly
2. **Near the test target** — look for a sibling `steps/` directory relative to the test target's package root (e.g., for `packages/core/tests/reporter/`, check `packages/core/steps/`)
3. **Walk up** — from the test target directory, walk up looking for a `steps/` directory containing `*.ts` files
4. **Project root** — fall back to `<project-root>/steps/`

Once found, set `STEPS_DIR` to the resolved path. Concepts are always at `<STEPS_DIR>/concepts/`.

## Workflow

### Phase 1: Generate Gauge Spec

#### 1. Determine test target

**If user provided a prompt:**
- Parse the instruction to identify the feature/behavior to test
- Read relevant source code files for context

**If no prompt (default: git diff mode):**
- Run `git diff --name-only HEAD` (or `git diff --name-only main...HEAD` for branch comparison)
- Filter to source files only (exclude tests, configs, docs)
- Read the changed files to understand what behavior changed
- Infer what test scenarios are needed

#### 2. Load step library and concepts

- Resolve `STEPS_DIR` using the discovery rules above
- Read all `<STEPS_DIR>/concepts/*.md` files — concepts are reusable building blocks (commonly recurring step groups)
- Read all `<STEPS_DIR>/*.ts` files — atomic step patterns (single operations and assertions)
- Understand the two vocabulary layers:
  - **Concepts** = reusable building blocks that group commonly recurring atomic steps (like helper functions)
  - **Atomic steps** = single operations (the lowest-level actions and assertions)
- Both concepts and atomic steps can appear in specs — concepts make scenarios more concise, atomic steps provide precision

#### 3. Read existing test context

- Check if related tests already exist for the feature
- Read existing tests to understand conventions (file structure, helper usage, test framework patterns)
- Identify what's already covered vs. what's missing

#### 4. Compose Gauge spec — intent-first

**The spec's audience is the human reviewer.** Every scenario should read as a behavioral statement, not as pseudo-code.

**Composition method — intent-first, not step-first:**

For each scenario:
1. Ask: "What behavior is this scenario verifying?" → write that as the scenario name (`##` heading)
2. Break the scenario into logical phases: setup → action → assertion
3. For each phase, check if an existing concept covers that group of steps → use it
4. Use atomic steps directly when they are self-explanatory on their own
5. If a recurring group of steps has no concept → write `[NEW CONCEPT]` and sketch the expansion below the spec

A scenario is a **mix of concepts and atomic steps**. The `##` heading is the intent; the steps below are the behavioral description.

**CRITICAL: Use concept names, never their expansion.** When a concept exists that covers a group of steps, write the concept's `#` heading pattern as a single `*` line in the spec. Do NOT manually expand the concept into its constituent atomic steps. If you find yourself writing 2+ consecutive atomic steps that match a concept's expansion, replace them with the concept name.

```markdown
# Feature name

## Scenario A
* Setup reporter with "default options"        ← concept (reusable init)
* Trigger reporter with "pass" test result      ← concept (reusable action)
* Assert output contains "·"                    ← atomic step

## Scenario B
* Setup reporter with "summary disabled"        ← concept
* Trigger reporter with "pass" test result      ← concept
* Assert output does not contain "Tests:"       ← atomic step
```

**Good vs. bad spec:**

Bad (concept exists but was manually expanded into atomic steps):
```markdown
## Pass marker
* Create mock output stream
* Create DotReporter with default options
* Build mock test result with status "pass"
* Call reporter onTestCaseResult with first test result
* Assert dot output contains "·"
```

Good (concepts referenced by name, atomic step only for the unique assertion):
```markdown
## Pass marker
* Setup DotReporter with "default options"
* Trigger reporter with "pass" test result
* Assert dot output contains "·"
```

Rules for spec composition:
- Each `##` scenario should test **one specific behavior** — the heading IS the intent
- Scenarios can contain **both concepts and atomic steps** — use concepts for recurring multi-step groups, atomic steps for one-off operations
- **Always reference concepts by their `#` heading pattern** — never manually inline a concept's atomic steps into the spec. The expansion happens in Phase 2, not in the spec.
- Steps should use exact patterns from concept files or the step library
- **Step parameters must be plain data values** (strings, numbers, identifiers) — never code expressions
- If a group of steps recurs across scenarios and has no concept, write `[NEW CONCEPT]` with:
  - The concept name with `<param>` placeholders (describes the reusable operation, not the full intent)
  - An `Expands to:` block listing the atomic steps it decomposes into
- If an expansion needs an atomic step that doesn't exist, mark it as `[NEW STEP]` inside the expansion

#### 4.5. Self-check before presenting spec

Before presenting the spec to the user, review every scenario:
1. Scan for consecutive atomic steps (2+ in a row)
2. For each group, check if any loaded concept's expansion matches those steps
3. If a match is found, replace the atomic steps with the concept name
4. If no concept matches but the pattern appears in multiple scenarios, propose it as `[NEW CONCEPT]`

#### 5. Present spec for review — CHECKPOINT

Output the spec to the user with:
- The full Gauge spec (intent-level, concise)
- A `[NEW CONCEPT]` section showing proposed concept definitions with their expansions
- A note on any `[NEW STEP]` entries inside expansions that would need to be added to the step library
- A summary: N scenarios, K new concepts needed, J new steps needed

**Wait for user response.** The user may:

- **Approve**: "ok", "looks good", "go ahead" → proceed to Phase 2
- **Request changes**: "add a scenario for X", "remove the third scenario", "also check error case" → modify the spec and present again
- **Reject**: "actually, don't test this" → stop

**Loop** on feedback until the user explicitly approves. Do not proceed to Phase 2 without clear confirmation.

---

### Phase 2: Expand and Assemble

#### 6. Parse and expand spec

Write the confirmed spec to a temporary file, then run the `gauge-expand` CLI:

```bash
# Write spec to temp file
cat > /tmp/spec.md << 'SPEC'
<the confirmed spec content>
SPEC

# Expand spec → JSON with code fragments (use resolved STEPS_DIR)
pnpm exec gauge-expand --spec /tmp/spec.md --steps <STEPS_DIR> --concepts <STEPS_DIR>/concepts/
```

The CLI outputs a JSON `ExpandedSpec` with code fragments for each step. If expansion fails (e.g., a step pattern has no match), it reports which step is unmatched.

For any `[NEW CONCEPT]` entries that were approved:
- Expand them manually: resolve each atomic step in the concept's expansion to its code fragment
- For any `[NEW STEP]` entries inside expansions, write the agent-authored code fragment directly

For approved new concepts and steps, flag them as candidates for `/rstestty-setup` to formalize later.

#### 7. Assemble test file

Take the expanded code fragments and assemble a complete test file. The agent handles:

- **Imports**: test framework, helpers, dependencies
- **Test structure**: `describe` / `it` / `test` wrapping appropriate to the project's conventions
- **Variable scoping**: ensure variables are accessible across steps within a scenario
- **Async handling**: `async`/`await` where needed
- **Setup/teardown**: `beforeEach`, `afterEach`, cleanup logic as needed

Follow conventions from existing tests in the same directory.

#### 8. Output result

- Write the generated test file
- Show the file path and a brief summary to the user
- If new steps were used, remind the user to run `/rstestty-setup` to formalize them

## Key principles

- **Scenario heading is the intent** — the `##` heading describes WHAT behavior is being tested. The steps below describe HOW, using a mix of concepts (reusable groups) and atomic steps (one-off operations). A human reviewer reads the heading for intent and scans the steps for correctness.
- **Concepts are reusable building blocks, not complete test flows** — a concept should encapsulate a commonly recurring group of steps (e.g., "Setup reporter with X", "Trigger reporter with Y test result"), not an entire init→action→assert flow. If a concept contains both setup and assertion, it's too big — split it.
- **Spec is the checkpoint, code is the deliverable** — the spec exists for review, the test file is what enters the repo
- **Never skip the review checkpoint** — always wait for explicit user confirmation before generating code
- **Vocabulary constraint** — strongly prefer existing concepts; `[NEW CONCEPT]` proposals are normal when entering a new test domain, but should decrease over time as the concept library grows
- **Match existing conventions** — generated tests should look like they belong in the existing test directory
- **Spec is ephemeral** — do not write the spec to a file unless the user asks; it lives in the conversation only
