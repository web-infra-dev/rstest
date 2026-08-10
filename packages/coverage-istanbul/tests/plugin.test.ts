import type { NormalizedCoverageOptions } from '@rstest/core';
import { describe, expect, it } from '@rstest/core';
import { transformCoverage } from '../src/plugin';
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
});
