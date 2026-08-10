import { createRsbuild } from '@rsbuild/core';
import type { NormalizedCoverageOptions } from '@rstest/core';
import { describe, expect, it } from '@rstest/core';
import { pluginCoverage, transformCoverage } from '../src/plugin';
import { readInitialCoverage } from '../src/utils';

const options: NormalizedCoverageOptions = {
  enabled: true,
  exclude: [],
  provider: 'istanbul',
  reporters: [],
  reportsDirectory: 'coverage',
  clean: true,
  reportOnFailure: false,
  allowExternal: false,
};

describe('transformCoverage', () => {
  it('instruments untested files without a registered environment', async () => {
    const fixtures = [
      ['export const value: number = 1;', 'fixture.ts'],
      ['export const element = <div />;', 'fixture.tsx'],
      ['export const element = <div />;', 'fixture.jsx'],
    ] as const;

    const results = await Promise.all(
      fixtures.map(([code, filename]) =>
        transformCoverage('unregistered', code, filename, options),
      ),
    );

    for (const result of results) {
      expect(readInitialCoverage(result.code)).toBeTruthy();
    }
  });

  it('preserves explicit JSX parser settings for JavaScript files', async () => {
    const environmentName = 'explicit-jsx';
    const rsbuild = await createRsbuild({
      config: {
        environments: {
          [environmentName]: {
            tools: {
              swc: {
                jsc: {
                  parser: {
                    syntax: 'ecmascript',
                    jsx: true,
                  },
                },
              },
            },
          },
        },
        plugins: [pluginCoverage(options)],
      },
    });
    await rsbuild.initConfigs();

    const result = await transformCoverage(
      environmentName,
      'export const element = <div />;',
      'fixture.js',
      options,
    );

    expect(readInitialCoverage(result.code)).toBeTruthy();
  });
});
