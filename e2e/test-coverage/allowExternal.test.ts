import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { coverageProviders } from './providers';

const configByProvider = {
  istanbul: 'rstest.config.ts',
  v8: 'rstest.v8.config.ts',
} as const;

for (const provider of coverageProviders) {
  describe(`coverage allowExternal (${provider})`, () => {
    it('excludes external files by default', async () => {
      const config = configByProvider[provider];
      const { expectExecSuccess, cli } = await runRstestCli({
        command: 'rstest',
        args: ['run', '-c', config],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures/allow-external'),
          },
        },
      });

      await expectExecSuccess();

      const logs = cli.stdout.split('\n').filter(Boolean);

      // internal file should be in coverage
      expect(
        logs.find((log) => log.includes('internal.ts') && log.includes('|')),
      ).toBeTruthy();

      // external file (helper.ts) should NOT be in coverage
      expect(
        logs.find((log) => log.includes('helper.ts') && log.includes('|')),
      ).toBeFalsy();
    });

    it('includes external files when enabled from CLI', async () => {
      const config = configByProvider[provider];
      const { expectExecSuccess, cli } = await runRstestCli({
        command: 'rstest',
        args: ['run', '-c', config, '--coverage.allowExternal'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures/allow-external'),
          },
        },
      });

      await expectExecSuccess();

      const logs = cli.stdout.split('\n').filter(Boolean);

      // internal file should be in coverage
      expect(
        logs.find((log) => log.includes('internal.ts') && log.includes('|')),
      ).toBeTruthy();

      // external file (helper.ts) SHOULD be in coverage
      expect(
        logs.find((log) => log.includes('helper.ts') && log.includes('|')),
      ).toBeTruthy();
    });
  });
}
