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
  'watch custom environment',
  () => {
    it('should re-run all tests when custom environment file changes', async () => {
      const fixturesTargetPath = `${__dirname}/fixtures-test-custom-environment${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures-custom-environment`,
        fixturesTargetPath,
      });

      const { cli } = await runRstestCli({
        command: 'rstest',
        args: ['watch', '--disableConsoleIntercept'],
        options: {
          nodeOptions: {
            cwd: fixturesTargetPath,
          },
        },
      });

      await cli.waitForStdout('Duration');
      expect(cli.stdout).toMatch('Tests 1 passed');
      expect(cli.stdout).not.toMatch('Test files to re-run:');

      const environmentPath = path.join(
        fixturesTargetPath,
        'test-environment.mjs',
      );

      cli.resetStd();
      fs.update(environmentPath, (content) => {
        return content.replace("'initial'", "'modified'");
      });
      fs.update(path.join(fixturesTargetPath, 'index.test.ts'), (content) => {
        return content.replace("'initial'", "'modified'");
      });

      await cli.waitForStdout('Duration');
      expect(cli.stdout).toMatch('Tests 1 passed');

      cli.resetStd();
      fs.delete(environmentPath);

      await cli.waitForStderr('Failed to resolve testEnvironment');

      cli.exec.kill();
    });
  },
);
