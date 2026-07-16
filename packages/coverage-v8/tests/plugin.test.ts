import { describe, expect, it } from '@rstest/core';
import { transformCoverage } from '../src/plugin';

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
