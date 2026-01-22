import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

rs.setConfig({
  retry: 3,
});

describe.skipIf(process.platform === 'win32')(
  'watch setup file changes',
  () => {
    it('should re-run all tests when setup file changes', async () => {
      const fixturesTargetPath = `${__dirname}/fixtures-test-setup${process.env.RSTEST_OUTPUT_MODULE ? '-module' : ''}`;

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures-setup`,
        fixturesTargetPath,
      });

      const { cli, expectLog } = await runRstestCli({
        command: 'rstest',
        args: ['watch', '--disableConsoleIntercept'],
        options: {
          nodeOptions: {
            cwd: fixturesTargetPath,
          },
        },
      });

      // initial run
      await cli.waitForStdout('Duration');
      expect(cli.stdout).toMatch('Tests 2 passed');
      expectLog('Running advanced test...');
      expectLog('Running basic test...');
      expect(cli.stdout).toMatch('[beforeAll] setup');
      expect(cli.stdout).toMatch('[afterAll] setup');
      expect(cli.stdout).not.toMatch('Test files to re-run:');

      const setupFilePath = path.join(fixturesTargetPath, 'rstest.setup.ts');

      // modify setup file
      cli.resetStd();
      fs.update(setupFilePath, (content) => {
        return content.replace(
          "console.log('[beforeAll] setup')",
          "console.log('[beforeAll] setup - modified')",
        );
      });

      await cli.waitForStdout('Duration');
      expect(cli.stdout).toMatch('Tests 2 passed');
      expectLog('Running advanced test...');
      expectLog('Running basic test...');
      expect(cli.stdout).toMatch('[beforeAll] setup - modified');

      cli.exec.kill();
    });
  },
);
