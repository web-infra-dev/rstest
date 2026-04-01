import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputPath = join(__dirname, '.tmp', 'rstest-report.json');

const parseJsonReport = (output: string) => {
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`Cannot find JSON report in output:\n${output}`);
  }
  return JSON.parse(output.slice(jsonStart));
};

describe('json reporter', () => {
  it('should print structured JSON to stdout', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'junit', '--reporter', 'json'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();

    expect(cli.exec.process?.exitCode).toBe(1);

    const report = parseJsonReport(cli.stdout);

    expect(report.tool).toBe('rstest');
    expect(report.status).toBe('fail');
    expect(report.summary).toEqual({
      testFiles: 1,
      failedFiles: 1,
      tests: 3,
      failedTests: 1,
      passedTests: 1,
      skippedTests: 1,
      todoTests: 0,
    });
    expect(report.files[0].testPath).toBe('fixtures/junit.test.ts');
    expect(report.tests[0].testPath).toBe('fixtures/junit.test.ts');
    expect(report.tests[0].fullName).toBe('Junit test > should pass');
    expect(report.tests[1].errors[0].message).toContain("expected 'hi' to be");
  });

  it('should write JSON report to file', async ({ onTestFinished }) => {
    fs.rmSync(outputPath, { force: true });

    onTestFinished(() => {
      fs.rmSync(outputPath, { force: true });
      fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'junit', '-c', './rstest.jsonReporter.config.mts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();

    expect(cli.exec.process?.exitCode).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);

    const report = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

    expect(report.status).toBe('fail');
    expect(report.durationMs.tests).toBeGreaterThan(0);
    expect(report.files).toHaveLength(1);
    expect(report.tests).toHaveLength(3);
    expect(report.tests[2].status).toBe('skip');
  });
});
