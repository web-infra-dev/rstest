---
name: verify
description: Behavioral verification rules for claiming a change works. Use before reporting any fix/feature as done, when tempted to conclude from typecheck or unit-test results alone, when deciding what evidence a change needs, or when a test result looks suspicious (stale build, flaky pass, snapshot churn).
metadata:
  internal: true
---

# Verify Behavior, Not Proxies

A change is verified only when you have **observed the real behavior change** — the actual CLI output, reporter output, or exit code — not when a proxy signal went green. This skill owns exactly one concern: **what counts as evidence**. How to run things lives in the `testing` skill; what work a change requires (including the Flip-and-Verify regression protocol) lives in the `development` skill — don't expect commands or checklists here.

## Forbidden proxies

None of these, alone, justify claiming a behavioral change works:

- **Typecheck / lint green.** Proves the types compose, not that the behavior changed.
- **Unit tests green.** They exercise source via the workspace runner, not the built CLI → runner → reporter pipeline users run.
- **"My new test passes."** A test that passes both before and after the fix proves nothing — it must flip (protocol: `development` → Flip-and-Verify).
- **"The code path is clearly hit."** Reading the code and reasoning that it must work is prediction, not observation.
- **Snapshot updated with `-u`.** Regeneration makes tests green by definition; green-after-update is not evidence (update policy: `testing` → Snapshot policy).
- **Build succeeded.** Compiling is not running.
- **A tool accepted your config.** Silently-ignored options look identical to working ones — prove the rule/option fires by observing it reject or change something (inject a violation, toggle the option).

If verification is genuinely impossible (needs real CI, a specific OS, a headed browser you can't run), say so explicitly instead of substituting a proxy.

## The observation loop

1. **Start from fresh build state.** E2E and fixture runs consume built output; if a result contradicts your expectation, suspect a stale or half-finished build before suspecting the code (rebuild procedure: `testing` → Rebuild before E2E).
2. **Drive the real binary on the smallest repro.** Run the actual `rstest` CLI the way a user would — an e2e fixture, not an import of internal functions (run forms: `testing` → Running tests).
3. **Observe the output, not the summary.** Read the reporter output for the specific behavior you changed, and check the exit code (`echo $?`) when the change affects pass/fail semantics.
4. **Observe both directions when feasible.** See the broken behavior without your change and the fixed behavior with it — a fix you never saw fail is unverified.

## What to observe, by change shape

| Change touches                      | Minimum real observation                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Core runtime / runner / pool        | A targeted e2e run plus its exit code, on a fixture that exercises the changed behavior      |
| Reporter / console output           | The actual stdout/stderr the CLI prints, not just assertion results                          |
| CLI flags / config options          | Two runs — with and without the option — confirming the behavior differs                     |
| Browser mode                        | A browser e2e run (headless is the default; see `testing` → Browser E2E)                     |
| Adapters (rsbuild / rslib / rspack) | A fixture run through the adapter, confirming the transformed config takes effect at runtime |
| Coverage providers                  | The emitted report content, not just "the run succeeded"                                     |
| Watch mode                          | An actual watch session reacting to a file change, not a one-shot run                        |
| Lint rules / hooks / gates          | The gate firing on an injected violation with the intended message, then passing when clean  |

## False-signal gotchas

- **A pass on re-run after a fail** may be flakiness, not a fix. Re-run the exact failing command; if results alternate with no code change, report it as flaky rather than fixed.
- **Inexplicable fixture behavior** is usually stale state, not logic — stale `dist`, persistent fixture output, shared cwd (mechanisms and cleanup: `testing`).
- **Absence of a failure is weak evidence.** "It didn't error" only counts if you confirmed the run actually reached the changed code path.
