# Candidate bugs from the harness doc work

> Working notes, not for merge. Surfaced 2026-07-22 while writing the subsystem architecture docs (base: `b0b23abb`, v0.11.3). Verify against current source before filing.

## 1. Trace double-finalize on browser-only non-watch runs

The browser-only fast path's `traceController.shutdown` re-invokes `finalize` after `finalizeRunCycle` already ran it. `finalize` has no re-entry guard — only `if (!events.length) return` at `packages/core/src/utils/trace.ts:353`, and the event buffer is never cleared — so the second pass writes a new timestamped `.rstest/trace-<stamp>.json` + `.summary.md` pair alongside the first and reprints the summary to stdout.

Repro shape: `rstest run --trace` on a browser-only project (non-watch). Expected: one trace pair, one summary print.

## 2. `rstest init` silently overwrites existing files

In `packages/core/src/cli/init/browser/create.ts`:

- `getUniqueBaseName` dedupes the example base name by probing the **component** file only, so a pre-existing `tests/Counter.test.tsx` without a sibling `tests/Counter.tsx` keeps the base `Counter` and the existing test file is overwritten.
- The generated `rstest.browser.config.mts` has no overwrite guard at all — an existing config file is silently replaced.

Repro shape: run `rstest init` (browser) twice in a project that has a test file but no matching component, or that already has `rstest.browser.config.mts`.

## 3. `rstest list --json` emits no JSON on the collect-error path — fixed (uncommitted)

When any per-file collect or globalSetup error occurred, `listTests` printed ANSI `FAIL` / `Unhandled Error` blocks and returned before the listing/JSON stage, so a `--json` caller got human-formatted ANSI on stdout and no structured output.

Fixed here (uncommitted): the error path now emits `{ errors: [{ file?, name, message, stack }] }` to stdout/file and suppresses the ANSI blocks when JSON goes to stdout (`packages/core/src/core/listTests.ts:696`).
