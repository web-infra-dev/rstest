import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import type { Rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import {
  checkFallback,
  failSlowBuild,
  fastBuilt,
  fastStarted,
  slowBuilt,
  slowFailed,
  waitForMarker,
} from './markers';

const timingReport = process.env.RSTEST_DISPATCH_TIMING_REPORT;
const fastReported = fastStarted + '.reported';

export default defineConfig({
  performance: { buildCache: false },
  reporters: timingReport
    ? [
        ['json', { outputPath: timingReport }],
        {
          onTestFileResult({ project }) {
            if (project === 'fast') writeFileSync(fastReported, '');
          },
        },
      ]
    : process.env.RSTEST_CHECK_DISPATCH_REPORTER === '1'
      ? [
          'default',
          {
            onTestRunStart({ files }) {
              if (
                !existsSync(slowBuilt) ||
                existsSync(fastStarted) ||
                files
                  .map(({ project }) => project)
                  .sort()
                  .join(',') !== 'fast,slow'
              ) {
                throw new Error(
                  'Expected the full selection before the first test',
                );
              }
              console.log('Run-start selection verified');
            },
          },
        ]
      : ['default'],
  projects: [
    {
      name: 'fast',
      include: ['fast.test.ts'],
      tools: {
        rspack(config) {
          config.plugins.push({
            apply(compiler: Rspack.Compiler) {
              compiler.hooks.done.tap('MarkFastBuildReady', () => {
                writeFileSync(fastBuilt, '');
              });
            },
          });
        },
      },
    },
    {
      name: 'slow',
      include: ['slow.test.ts'],
      tools: {
        rspack(config) {
          config.plugins.push({
            apply(compiler: Rspack.Compiler) {
              compiler.hooks.beforeCompile.tapPromise(
                'WaitForFastProject',
                async () => {
                  if (checkFallback) {
                    // Keep the builds staggered even if the fast compiler starts late.
                    await waitForMarker(fastBuilt);
                    await setTimeout(400);
                    return;
                  }
                  if (timingReport) {
                    await waitForMarker(fastReported);
                    await setTimeout(400);
                  } else {
                    await waitForMarker(fastStarted);
                  }
                  if (failSlowBuild) {
                    throw new Error(
                      'Slow project compilation failed after fast dispatch',
                    );
                  }
                },
              );
              compiler.hooks.done.tap('MarkSlowBuildReady', () => {
                writeFileSync(slowBuilt, '');
              });
              compiler.hooks.failed.tap(
                { name: 'MarkSlowBuildFailure', stage: 1000 },
                () => {
                  writeFileSync(slowFailed, '');
                },
              );
            },
          });
        },
      },
    },
  ],
});
