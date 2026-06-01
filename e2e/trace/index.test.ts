import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureRoot = join(__dirname, 'fixtures');

describe('performance trace', () => {
  it('records host-side spans', async () => {
    await rm(join(fixtureRoot, '.rstest'), { recursive: true, force: true });

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'basic.test.ts', '--trace'],
      options: {
        nodeOptions: {
          cwd: fixtureRoot,
        },
      },
    });

    await expectExecSuccess();

    const tracePath = cli.stdout.match(
      /Perfetto trace file:\s*(.*\.json)/,
    )?.[1];
    expect(tracePath).toBeTruthy();

    const trace = JSON.parse(await readFile(tracePath!, 'utf-8')) as {
      traceEvents: Array<{ name: string; cat?: string }>;
    };
    const hostEventNames = trace.traceEvents
      .filter((event) => event.cat === 'host')
      .map((event) => event.name);

    expect(hostEventNames).toContain('host:get-rsbuild-stats');
    expect(hostEventNames).toContain('host:build-task');
    expect(hostEventNames).toContain('host:get-assets-by-entry');
    expect(hostEventNames).toContain('host:pool-run-test');
  });
});
