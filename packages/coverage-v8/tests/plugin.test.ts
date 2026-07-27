import { createRsbuild } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { pluginCoverage, transformCoverage } from '../src/plugin';

describe('transformCoverage', () => {
  it('selects the SWC parser from the filename', async () => {
    const [tsResult, tsxResult, jsxResult] = await Promise.all([
      transformCoverage(
        'unregistered',
        'export const cast = (value: unknown) => <number>value;',
        'fixture.ts',
      ),
      transformCoverage(
        'unregistered',
        'export const element = <div />;',
        'fixture.tsx',
      ),
      transformCoverage(
        'unregistered',
        'export const element = <div />;',
        'fixture.jsx',
      ),
    ]);

    expect(tsResult.map).toBeTruthy();
    expect(tsxResult.map).toBeTruthy();
    expect(jsxResult.map).toBeTruthy();
  });
});

describe('coverage-v8 plugin', () => {
  it('limits generated chunks to 512 KiB by default', async () => {
    const rsbuild = await createRsbuild({
      config: {
        plugins: [pluginCoverage()],
      },
    });

    const [config] = await rsbuild.initConfigs();

    expect(config?.optimization?.splitChunks).toMatchObject({
      maxSize: 512 * 1024,
      chunks: 'all',
    });
  });

  it('allows tools.rspack to override the coverage default', async () => {
    const rsbuild = await createRsbuild({
      config: {
        plugins: [pluginCoverage()],
        tools: {
          rspack: {
            optimization: {
              splitChunks: {
                maxSize: 1024 * 1024,
                chunks: 'async',
              },
            },
          },
        },
      },
    });

    const [config] = await rsbuild.initConfigs();

    expect(config?.optimization?.splitChunks).toMatchObject({
      maxSize: 1024 * 1024,
      chunks: 'async',
    });
  });
});
