import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File-watch latency makes the rerun timing slightly racy; retry like the other
// watch e2e suites.
rs.setConfig({ retry: 3 });

// EBUSY when rming the temp fixture dir mid-run on Windows (see
// watch/index.test.ts for the same skip).
describe.skipIf(process.platform === 'win32')(
  'module sharing under isolate: false (watch rebuild)',
  () => {
    it.for(['memory', 'disk', 'filtered'] as const)(
      'serves the rebuilt shared module value with %s output',
      async (output, { onTestFinished }) => {
        const fixturesTargetPath = `${__dirname}/fixtures-test-watch-sharing-${output}${
          process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''
        }`;

        const { fs } = await prepareFixtures({
          fixturesPath: `${__dirname}/fixtures/watch-sharing`,
          fixturesTargetPath,
        });

        const { cli } = await runRstestCli({
          command: 'rstest',
          args: [
            'watch',
            '--disableConsoleIntercept',
            '--trace',
            ...(output === 'disk' ? ['--dev.writeToDisk'] : []),
          ],
          onTestFinished,
          options: {
            nodeOptions: {
              cwd: fixturesTargetPath,
              env: {
                RSTEST_TEST_FILTER_DISK_ASSETS:
                  output === 'filtered' ? '1' : '',
              },
            },
          },
        });

        const expectCycle = async (marker: string) => {
          await cli.waitForStdout('Waiting for file changes...');
          expect(cli.stdout).toContain(`SHARED_MARKER=${marker}`);
          const tracePath = cli.stdout.match(
            /Perfetto trace file:\s*(.*\.json)/,
          )?.[1];
          expect(tracePath).toBeTruthy();
          const trace = JSON.parse(await readFile(tracePath!, 'utf8')) as {
            traceEvents: Array<{ name: string }>;
          };
          expect(trace.traceEvents.map(({ name }) => name)).toContain(
            'host:pool-run-test',
          );
          expect(
            trace.traceEvents.some(
              ({ name }) => name === 'host:get-assets-by-entry',
            ),
          ).toBe(output !== 'disk');
        };

        await expectCycle('ORIGINAL');

        // Edit the shared module: Rsbuild marks basic.test.ts affected and reruns
        // it on the same reused worker.
        cli.resetStd();
        fs.update(path.join(fixturesTargetPath, 'shared.ts'), (content) =>
          content.replace("'ORIGINAL'", "'UPDATED'"),
        );

        await expectCycle('UPDATED');
      },
    );
  },
);
