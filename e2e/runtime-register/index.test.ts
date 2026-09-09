import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { onTestFinished as onRstestFinished } from '@rstest/core';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const registerFixtureDir = join(__dirname, 'fixtures');
const nativeFixtureDir = join(__dirname, 'fixtures-native');

const runFixture = async (
  cwd: string,
  onTestFinished: typeof onRstestFinished,
) => {
  const { expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run'],
    onTestFinished,
    options: {
      nodeOptions: {
        cwd,
      },
    },
  });

  await expectExecSuccess();
};

describe('runtime node register behavior', () => {
  it('should preserve node register hooks and execArgv inside workers', async ({
    onTestFinished,
  }) => {
    await runFixture(registerFixtureDir, onTestFinished);
  });

  it('should preserve native node semantics for late-loaded TypeScript files', async ({
    onTestFinished,
  }) => {
    await runFixture(nativeFixtureDir, onTestFinished);
  });
});
