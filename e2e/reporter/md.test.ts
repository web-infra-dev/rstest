import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const normalizeStdout = (stdout: string) =>
  stdout
    .trimStart()
    .replace(/tool: "@rstest\/core@[^"]+"/g, 'tool: "@rstest/core@<version>"')
    .replace(/timestamp: ".*?"/g, 'timestamp: "<timestamp>"')
    .replace(
      / {2}"durationMs": \{\n {4}"total": \d+,\n {4}"build": \d+,\n {4}"tests": \d+\n {2}\}/,
      '  "durationMs": {\n    "total": 0,\n    "build": 0,\n    "tests": 0\n  }',
    )
    .replace(/"duration": \d+/g, '"duration": 0');

describe('md', () => {
  it('outputs markdown report', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'agent-md/index', '-c', './rstest.agentMd.config.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "fail",
        "counts": {
          "testFiles": 1,
          "failedFiles": 1,
          "tests": 1,
          "failedTests": 1,
          "passedTests": 0,
          "skippedTests": 0,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 0,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Failures

      ### [F01] fixtures/agent-md/index.test.ts :: agent-md > fails with diff

      details:

      \`\`\`json
      {
        "testPath": "fixtures/agent-md/index.test.ts",
        "project": "rstest",
        "fullName": "agent-md > fails with diff",
        "status": "fail",
        "duration": 0,
        "retryCount": 0,
        "errors": [
          {
            "type": "AssertionError",
            "message": "expected 2 to be 3 // Object.is equality",
            "expected": "3",
            "actual": "2",
            "stackFrames": []
          }
        ]
      }
      \`\`\`

      "
    `);
  });

  it('labels snapshot mismatch errors', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'agent-md/snapshotMismatch',
        '-c',
        './rstest.agentMd.snapshotMismatch.config.ts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "fail",
        "counts": {
          "testFiles": 1,
          "failedFiles": 1,
          "tests": 1,
          "failedTests": 1,
          "passedTests": 0,
          "skippedTests": 0,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 1,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Failures

      ### [F01] fixtures/agent-md/snapshotMismatch.test.ts :: agent-md > fails with snapshot mismatch

      details:

      \`\`\`json
      {
        "testPath": "fixtures/agent-md/snapshotMismatch.test.ts",
        "project": "rstest",
        "fullName": "agent-md > fails with snapshot mismatch",
        "status": "fail",
        "duration": 0,
        "retryCount": 0,
        "errors": [
          {
            "type": "SnapshotMismatchError",
            "message": "Snapshot \`agent-md > fails with snapshot mismatch 1\` mismatched",
            "expected": "{\\n  \\"a\\": 2,\\n}",
            "actual": "{\\n  \\"a\\": 1,\\n}",
            "stackFrames": []
          }
        ]
      }
      \`\`\`

      "
    `);
  });

  it('includes console output when enabled', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'agent-md/console',
        '-c',
        './rstest.agentMd.console.config.ts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "fail",
        "counts": {
          "testFiles": 1,
          "failedFiles": 1,
          "tests": 1,
          "failedTests": 1,
          "passedTests": 0,
          "skippedTests": 0,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 0,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Failures

      ### [F01] fixtures/agent-md/console.test.ts :: agent-md > fails with console output

      details:

      \`\`\`json
      {
        "testPath": "fixtures/agent-md/console.test.ts",
        "project": "rstest",
        "fullName": "agent-md > fails with console output",
        "status": "fail",
        "duration": 0,
        "retryCount": 0,
        "errors": [
          {
            "type": "AssertionError",
            "message": "expected 1 to be 2 // Object.is equality",
            "expected": "2",
            "actual": "1",
            "stackFrames": []
          }
        ]
      }
      \`\`\`

      codeFrame (error 1):

      \`\`\`text
       6 |     console.warn('hello from console.warn');
       7 |     console.error('hello from console.error');
       8 |     expect(1).toBe(2);
         |               ^
       9 |   });
      10 | });
      \`\`\`

      console:

      \`\`\`text
      [stdout] log: hello from console.log
      [stderr] warn: hello from console.warn
      [stderr] error: hello from console.error
      \`\`\`

      "
    `);
  });

  it('formats thrown errors', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'agent-md/throw', '-c', './rstest.agentMd.throw.config.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "fail",
        "counts": {
          "testFiles": 1,
          "failedFiles": 1,
          "tests": 1,
          "failedTests": 1,
          "passedTests": 0,
          "skippedTests": 0,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 0,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Failures

      ### [F01] fixtures/agent-md/throw.test.ts :: agent-md > fails with thrown error

      details:

      \`\`\`json
      {
        "testPath": "fixtures/agent-md/throw.test.ts",
        "project": "rstest",
        "fullName": "agent-md > fails with thrown error",
        "status": "fail",
        "duration": 0,
        "retryCount": 0,
        "errors": [
          {
            "type": "Error",
            "message": "boom",
            "stackFrames": []
          }
        ]
      }
      \`\`\`

      "
    `);
  });

  it('labels timeout errors', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'agent-md/timeout',
        '-c',
        './rstest.agentMd.timeout.config.ts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "fail",
        "counts": {
          "testFiles": 1,
          "failedFiles": 1,
          "tests": 1,
          "failedTests": 1,
          "passedTests": 0,
          "skippedTests": 0,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 0,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Failures

      ### [F01] fixtures/agent-md/timeout.test.ts :: agent-md > fails with timeout

      details:

      \`\`\`json
      {
        "testPath": "fixtures/agent-md/timeout.test.ts",
        "project": "rstest",
        "fullName": "agent-md > fails with timeout",
        "status": "fail",
        "duration": 0,
        "retryCount": 0,
        "errors": [
          {
            "type": "Error",
            "message": "test timed out in 20ms (no expect assertions completed)",
            "stackFrames": []
          }
        ]
      }
      \`\`\`

      "
    `);
  });

  it('prints failure list and truncates failure details', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'agent-md/truncated',
        '-c',
        './rstest.agentMd.truncated.config.ts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "fail",
        "counts": {
          "testFiles": 1,
          "failedFiles": 1,
          "tests": 5,
          "failedTests": 5,
          "passedTests": 0,
          "skippedTests": 0,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 0,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Failures

      Truncated failures: showing full details for first 2 of 5 failures.
      For failures beyond 2, only minimal fields are shown in the failure list. Use the repro command to rerun a specific failure for full details.

      ### Failure List

      - [F01] fixtures/agent-md/truncated.test.ts :: agent-md > truncated case 1
        - type: AssertionError
        - message: expected 1 to be 2 // Object.is equality
        - expected: 2
        - actual: 1
        - repro: pnpm exec rstest 'fixtures/agent-md/truncated.test.ts' --testNamePattern 'agent-md > truncated case 1'
      - [F02] fixtures/agent-md/truncated.test.ts :: agent-md > truncated case 2
        - type: AssertionError
        - message: expected 2 to be 3 // Object.is equality
        - expected: 3
        - actual: 2
        - repro: pnpm exec rstest 'fixtures/agent-md/truncated.test.ts' --testNamePattern 'agent-md > truncated case 2'
      - [F03] fixtures/agent-md/truncated.test.ts :: agent-md > truncated case 3
        - type: AssertionError
        - message: expected 3 to be 4 // Object.is equality
        - expected: 4
        - actual: 3
        - repro: pnpm exec rstest 'fixtures/agent-md/truncated.test.ts' --testNamePattern 'agent-md > truncated case 3'
      - [F04] fixtures/agent-md/truncated.test.ts :: agent-md > truncated case 4
        - type: AssertionError
        - message: expected 4 to be 5 // Object.is equality
        - expected: 5
        - actual: 4
        - repro: pnpm exec rstest 'fixtures/agent-md/truncated.test.ts' --testNamePattern 'agent-md > truncated case 4'
      - [F05] fixtures/agent-md/truncated.test.ts :: agent-md > truncated case 5
        - type: AssertionError
        - message: expected 5 to be 6 // Object.is equality
        - expected: 6
        - actual: 5
        - repro: pnpm exec rstest 'fixtures/agent-md/truncated.test.ts' --testNamePattern 'agent-md > truncated case 5'

      ### Failure Details (first 2)

      ### [F01] fixtures/agent-md/truncated.test.ts :: agent-md > truncated case 1

      repro:

      \`\`\`bash
      pnpm exec rstest 'fixtures/agent-md/truncated.test.ts' --testNamePattern 'agent-md > truncated case 1'
      \`\`\`

      details:

      \`\`\`json
      {
        "testPath": "fixtures/agent-md/truncated.test.ts",
        "project": "rstest",
        "fullName": "agent-md > truncated case 1",
        "status": "fail",
        "duration": 0,
        "retryCount": 0,
        "errors": [
          {
            "type": "AssertionError",
            "message": "expected 1 to be 2 // Object.is equality",
            "expected": "2",
            "actual": "1",
            "stackFrames": []
          }
        ]
      }
      \`\`\`

      ### [F02] fixtures/agent-md/truncated.test.ts :: agent-md > truncated case 2

      repro:

      \`\`\`bash
      pnpm exec rstest 'fixtures/agent-md/truncated.test.ts' --testNamePattern 'agent-md > truncated case 2'
      \`\`\`

      details:

      \`\`\`json
      {
        "testPath": "fixtures/agent-md/truncated.test.ts",
        "project": "rstest",
        "fullName": "agent-md > truncated case 2",
        "status": "fail",
        "duration": 0,
        "retryCount": 0,
        "errors": [
          {
            "type": "AssertionError",
            "message": "expected 2 to be 3 // Object.is equality",
            "expected": "3",
            "actual": "2",
            "stackFrames": []
          }
        ]
      }
      \`\`\`

      "
    `);
  });

  it('omits lists on non-focused passing runs', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', './rstest.agentMd.pass.config.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).not.toContain('## Tests');
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "pass",
        "counts": {
          "testFiles": 2,
          "failedFiles": 0,
          "tests": 14,
          "failedTests": 0,
          "passedTests": 13,
          "skippedTests": 1,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 0,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Failures

      No test failures reported.

      Note: all tests passed. Lists omitted for brevity.
      "
    `);
  });

  it('prints passed and skipped lists on focused passing runs', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'agent-md-pass', '-c', './rstest.agentMd.pass.config.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toMatchInlineSnapshot(`
      "---
      tool: "@rstest/core@<version>"
      timestamp: "<timestamp>"
      ---

      # Rstest Test Execution Report

      ## Summary

      \`\`\`json
      {
        "status": "pass",
        "counts": {
          "testFiles": 2,
          "failedFiles": 0,
          "tests": 14,
          "failedTests": 0,
          "passedTests": 13,
          "skippedTests": 1,
          "todoTests": 0
        },
        "durationMs": {
          "total": 0,
          "build": 0,
          "tests": 0
        },
        "snapshot": {
          "added": 0,
          "updated": 0,
          "unmatched": 0,
          "removed": 0,
          "unchecked": 0
        }
      }
      \`\`\`

      ## Tests

      ### Passed

      - fixtures/agent-md-pass/focusedSkip.test.ts :: agent-md-pass > passed case
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 1
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 2
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 3
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 4
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 5
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 6
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 7
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 8
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 9
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 10
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 11
      - fixtures/agent-md-pass/many.test.ts :: agent-md-pass > case 12

      ### Skipped

      - fixtures/agent-md-pass/focusedSkip.test.ts :: agent-md-pass > skipped case

      ## Failures

      No test failures reported.
      "
    `);
  });
});
