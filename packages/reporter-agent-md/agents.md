# agents.md (packages/reporter-agent-md)

Package: `@rstest/reporter-agent-md` (LLM-friendly Markdown reporter for Rstest).
This file is guidance for code agents working specifically in `packages/reporter-agent-md/`.

If you are editing other parts of the monorepo, also follow the repo root `AGENTS.md`.

## Quick index

- Implementation: `packages/reporter-agent-md/src/reporter.ts`
- Stack parsing + sourcemap mapping: `packages/reporter-agent-md/src/stack.ts`
- Code frame rendering: `packages/reporter-agent-md/src/codeFrame.ts`
- Public API surface: `packages/reporter-agent-md/src/index.ts`
- Usage docs + local agent simulation: `packages/reporter-agent-md/README.md`
- E2E coverage for this reporter: `e2e/reporter/agentMd.test.ts`

## Commands

Prefer package-scoped commands and file-scoped checks.
Always wrap file paths in single quotes in shell commands.

### Build / dev

```bash
pnpm --filter '@rstest/reporter-agent-md' build
pnpm --filter '@rstest/reporter-agent-md' dev
pnpm --filter '@rstest/reporter-agent-md' typecheck
```

### Test this reporter (via e2e)

This package does not currently ship a local unit-test suite; validate behavior via `e2e/`.

```bash
pnpm e2e

cd 'e2e' && pnpm rstest 'reporter/agentMd.test.ts'
cd 'e2e' && pnpm rstest 'reporter/agentMd.test.ts' --testNamePattern 'suite > test name'
```

### Local agent-mode simulation

This reporter uses `@vercel/detect-agent` and also treats `OPENCODE=1` as agent mode.

```bash
AI_AGENT='local-test' npx rstest
OPENCODE=1 npx rstest

AI_AGENT='local-test' npx rstest 'path/to/file.test.ts'
```

### File-scoped checks

```bash
pnpm biome check --write 'packages/reporter-agent-md/src/reporter.ts'
pnpm tsc --noEmit --project 'packages/reporter-agent-md/tsconfig.json'
```

## Output format contract

The reporter prints a Markdown document to stdout.
Keep output consistent and machine-parsable:

- Use stable section headings and fenced code blocks.
- Keep JSON blocks valid JSON (no trailing commas, no comments).
- Avoid non-deterministic ordering (Map/Object ordering should not depend on runtime iteration order).
- Do not emit ANSI control sequences unless explicitly requested (default is `stripAnsi: true`).

### Front matter

- A YAML front matter block exists at the top.
- It may include a timestamp, but avoid adding other volatile data.

### Failure payload schema

The `details` JSON for each failure is a contract; if you change it, update `packages/reporter-agent-md/README.md` and the e2e assertions.
Key fields used by agents:

- `testPath` (string, workspace-relative)
- `fullName` (string, formatted as `suite > test`)
- `errors[].message` / `errors[].diff`
- `errors[].topFrame` (file/line/column)
- `candidateFiles[]` (ranked list)
- `repro` command format (see below)

## Repro command rules

Repro commands must be copy/paste-safe in common shells:

- Always quote the test path and `--testNamePattern` value if it contains spaces/special chars.
- Prefer package-manager-specific commands via `package-manager-detector` when possible.
- Preserve the ability to run from the repo root.

Implementation reference: `quoteShellValue()`, `quoteShellPath()`, `buildReproCommand()` in `packages/reporter-agent-md/src/reporter.ts`.

## Paths, stacks, and sourcemaps

- Stack parsing happens in `packages/reporter-agent-md/src/stack.ts`.
- Do not regress the filtering rules:
  - ignore node internals and common vendor frames
  - hide frames inside `@rstest/core` and `@rstest/reporter-agent-md` by default
- Path formatting must prefer workspace-relative paths when under `process.cwd()`.
- When sourcemaps are available, mapped paths may be URL-like; guard `new URL()` usage.

## Do

- Keep diffs small and focused; prefer extending existing helpers over adding parallel logic.
- Keep the runtime bundle minimal (this package is used in CI/agent contexts).
- Prefer `import type` for types; keep TS types close to usage.
- Prefer `node:` specifiers for Node built-ins.
- When adding an option:
  - define it in `packages/reporter-agent-md/src/types.ts`
  - add a default in `defaultOptions` in `packages/reporter-agent-md/src/reporter.ts`
  - consider adding it to presets in `presetOptions`
  - document it in `packages/reporter-agent-md/README.md`

## Don't

- Do not edit generated output in `packages/reporter-agent-md/dist/`.
- Do not add new dependencies without discussion.
- Do not change output keys casually; schema drift breaks downstream tooling.
- Do not rely on global mutable state that persists across test runs.

## Code style

- Language: TypeScript, ESM (`"type": "module"`).
- Formatting: Biome/Prettier (single quotes, 2 spaces, LF).
- Imports:
  - keep type-only imports as `import type { ... } from '...'`
  - let Biome organize imports; do not hand-sort unless necessary

## Error handling

- Never throw strings; throw `Error`.
- Best-effort reporting is preferred:
  - if parsing fails, still print a minimal failure entry
  - avoid crashing the reporter on malformed stack frames
- When truncating output, keep the truncation explicit (e.g. `... [truncated]`).

## PR checklist (package-local)

- `pnpm --filter '@rstest/reporter-agent-md' typecheck` is green
- Biome formatting applied for touched TS files
- `cd 'e2e' && pnpm rstest 'reporter/agentMd.test.ts'` is green
- Output still renders as valid Markdown and JSON blocks parse cleanly
