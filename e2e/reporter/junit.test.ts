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

it('junit reports the cause chain of an error', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      '-c',
      './rstest.errorCause.config.mts',
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

  const file = String.raw`fixtures-cause[\\/]errorCause\.test\.ts`;
  expect(cli.stdout).toMatch(
    new RegExp(
      [
        '<failure message="Failed to load user" type="Error">Failed to load user',
        String.raw`at loadUser \(${file}:19:11\)`,
        'Caused by: TypeError: fetch failed',
        String.raw`at request \(${file}:11:11\)`,
        'Caused by: Error: Database connection refused',
        String.raw`at connect \(${file}:4:9\)</failure>`,
      ].join('\n'),
    ),
  );
});
