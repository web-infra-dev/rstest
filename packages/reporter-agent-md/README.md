# @rstest/reporter-agent-md

LLM-friendly Markdown reporter for Rstest.

This reporter is designed for code agents and automated environments. It outputs a structured Markdown report that is easy for LLMs to parse while still being readable for humans.

## Install

```bash
npm install @rstest/reporter-agent-md
```

## Usage

Use the helper to switch reporters based on agent detection.

```ts
import { defineConfig } from '@rstest/core';
import { createReporters } from '@rstest/reporter-agent-md';

export default defineConfig(async () => {
  return {
    reporters: await createReporters({
      includeConsole: false,
      includeCodeFrame: true,
      codeFrameLinesAbove: 2,
      codeFrameLinesBelow: 2,
    }),
  };
});
```

If you want full control, you can call `detectAgent()` and `createMdReporter()` yourself:

```ts
import { defineConfig } from '@rstest/core';
import { createMdReporter, detectAgent } from '@rstest/reporter-agent-md';

export default defineConfig(async () => {
  const { isAgent } = await detectAgent();

  return {
    reporters: isAgent
      ? [createMdReporter({ preset: 'compact' })]
      : ['default'],
  };
});
```

## Options

```ts
export type AgentMdReporterOptions = {
  preset?: 'normal' | 'compact' | 'full';
  includeEnv?: boolean;
  includeSnapshotSummary?: boolean;
  includeRepro?: boolean;
  reproMode?: 'file' | 'file+name';
  includeUnhandledErrors?: boolean;
  maxFailures?: number;
  includeFailureListWhenTruncated?: boolean;
  includeCodeFrame?: boolean;
  codeFrameLinesAbove?: number;
  codeFrameLinesBelow?: number;
  includeFullStackFrames?: boolean;
  maxStackFrames?: number;
  includeCandidateFiles?: boolean;
  maxCandidateFiles?: number;
  includeConsole?: boolean;
  maxConsoleLogsPerTestPath?: number;
  maxConsoleCharsPerEntry?: number;
  stripAnsi?: boolean;
};
```

## Local testing (simulate agent)

This package uses `@vercel/detect-agent`, which honors the `AI_AGENT` environment variable.
It also treats `OPENCODE=1` as agent mode.

```bash
AI_AGENT="local-test" npx rstest

# Or with OpenCode flag
OPENCODE=1 npx rstest
```

Or with a specific test file:

```bash
AI_AGENT="local-test" npx rstest path/to/file.test.ts
```

## Exports

- `detectAgent()`: returns the agent detection result
- `createMdReporter(options)`: returns a reporter instance
- `createReporters(options)`: returns `['default']` for human runs, or `[createMdReporter]` for agent runs
