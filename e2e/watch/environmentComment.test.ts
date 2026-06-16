import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

rs.setConfig({
  retry: 3,
});

const getRerunSection = (stdout: string): string => {
  const match = stdout.match(/Test files to re-run.*?:\n([\s\S]*?)\n\n/);
  return match?.[1] ?? '';
};

describe.skipIf(process.platform === 'win32')(
  'watch environment comments',
  () => {
    it('should honor environment comments', async () => {
      const fixturesTargetPath = `${__dirname}/fixtures-test-environment-comment${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures-environment-comment`,
        fixturesTargetPath,
      });

      const { cli } = await runRstestCli({
        command: 'rstest',
        args: ['watch', '--disableConsoleIntercept'],
        options: {
          nodeOptions: {
            env: { DEBUG: 'rstest' },
            cwd: fixturesTargetPath,
          },
        },
      });

      await cli.waitForStdout('Tests 2 passed');
      expect(cli.stdout).toMatch(
        'Run all tests in project(rstest-environment-1).',
      );
      expect(cli.stdout).toMatch(
        'Run all tests in project(rstest-environment-2).',
      );
      if (!cli.stdout.includes('Waiting for file changes...')) {
        await cli.waitForStdout('Waiting for file changes...');
      }

      cli.resetStd();
      fs.update(path.join(fixturesTargetPath, 'src/index.ts'), (content) => {
        return content.replace("'initial'", "'initial' as const");
      });

      await cli.waitForStdout('Test files to re-run');
      await cli.waitForStdout('Tests 2 passed');

      const rerunSection = getRerunSection(cli.stdout);
      expect(rerunSection).toMatch('index.test.ts');
      expect(rerunSection).not.toMatch('node.test.ts');

      cli.exec.kill();
    });
  },
);
