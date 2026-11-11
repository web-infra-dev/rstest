import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('junit', async () => {
  const { cli, expectLog } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'junit', '--reporters', 'junit'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expectLog('<?xml version="1.0" encoding="UTF-8"?>', logs);

  expectLog('<failure', logs);
  expectLog('<skipped/>', logs);
});

it('junit reports a file that fails outside of its tests', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      '-c',
      './rstest.junit.fileError.config.mts',
      '--reporters',
      'junit',
    ],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const xml = cli.stdout;

  // A file that throws while loading has no test case of its own, so the
  // error is carried by a test case named after the file.
  expect(xml).toMatch(
    /<testsuite name="fixtures-junit[\\/]loadError\.test\.ts" tests="1" failures="0" errors="1" skipped="0"/,
  );
  expect(xml).toMatch(
    /<testcase name="fixtures-junit[\\/]loadError\.test\.ts" classname="fixtures-junit[\\/]loadError\.test\.ts" time="0">\s*<error message="failed &lt;while&gt; loading" type="Load&amp;Error">/,
  );

  // A failed `beforeAll` hook skips the tests of the file.
  expect(xml).toMatch(
    /<testsuite name="fixtures-junit[\\/]hookError\.test\.ts" tests="2" failures="0" errors="1" skipped="1"/,
  );
  expect(xml).toContain('<error message="beforeAll failed" type="Error">');

  expect(xml).toMatch(
    /<testsuites name="rstest tests" tests="3" failures="0" errors="2" skipped="1"/,
  );
  expect(xml).not.toContain('<failure');
});
