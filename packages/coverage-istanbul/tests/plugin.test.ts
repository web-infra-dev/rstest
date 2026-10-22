import { createRsbuild } from '@rsbuild/core';
import type { NormalizedCoverageOptions } from '@rstest/core';
import { describe, expect, it } from '@rstest/core';
import { pluginCoverage, transformCoverage } from '../src/plugin';
import { getSourceMappingURL, readInitialCoverage } from '../src/utils';

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

  it.for([false, 'some', 'all'] as const)(
    'preserves coverage source maps despite format.comments=%s',
    async (comments) => {
      const environmentName = `comments-${comments}`;
      const rsbuild = await createRsbuild({
        config: {
          environments: {
            [environmentName]: {
              tools: {
                swc: {
                  minify: true,
                  jsc: {
                    preserveAllComments: false,
                    minify: {
                      compress: false,
                      mangle: false,
                      format: { comments },
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

      const inlineUrl = `data:application/json;base64,${Buffer.from(
        JSON.stringify({ version: 3 }),
      ).toString('base64')}`;
      for (const [comment, url] of [
        ['//# sourceMappingURL=fixture.js.map', 'fixture.js.map'],
        ['/*# sourceMappingURL=fixture.js.map */', 'fixture.js.map'],
        [`//# sourceMappingURL=${inlineUrl}`, inlineUrl],
      ]) {
        const result = await transformCoverage(
          environmentName,
          `export const value = 1;\n${comment}`,
          'fixture.js',
          options,
        );
        expect(getSourceMappingURL(result.code)).toBe(url);
        expect(readInitialCoverage(result.code)).toBeTruthy();
      }
    },
  );

  it('excludes ignored functions from initial coverage', async () => {
    const result = await transformCoverage(
      'unregistered',
      `/* istanbul ignore next */
export function ignored(value: number) { return value + 1; }
export function kept(value: number) { return value; }`,
      'ignored.ts',
      options,
    );
    const coverage = readInitialCoverage(result.code)!;
    expect(Object.values(coverage.fnMap).map(({ name }) => name)).toEqual([
      'kept',
    ]);
    expect(
      Object.values(coverage.statementMap).map(({ start }) => start.line),
    ).toEqual([3]);
    expect(Object.values(coverage.f)).toEqual([0]);
    expect(Object.values(coverage.s)).toEqual([0]);
  });

  it.for(['if', 'else'] as const)(
    'excludes the ignored %s branch from initial coverage',
    async (branch) => {
      const result = await transformCoverage(
        'unregistered',
        `export function kept(value: number) {
/* istanbul ignore ${branch} */
if (value > 0) {
return value;
} else {
return 0;
}
}`,
        'ignored-branch.ts',
        options,
      );
      const coverage = readInitialCoverage(result.code)!;
      expect(
        Object.values(coverage.statementMap).map(({ start }) => start.line),
      ).toEqual([3, branch === 'if' ? 6 : 4]);
      expect(Object.values(coverage.branchMap)).toMatchObject([
        { type: 'if', locations: [expect.any(Object)] },
      ]);
      expect(Object.values(coverage.b)).toEqual([[0]]);
    },
  );

  it('keeps initial coverage objects isolated between files and from the host', async () => {
    const coverages = await Promise.all(
      ['first.ts', 'second.ts'].map(async (filename) => {
        const result = await transformCoverage(
          'unregistered',
          'export function value(input: number) { return input > 0 ? input : 0; }',
          filename,
          options,
        );
        return readInitialCoverage(result.code);
      }),
    );
    const [first, second] = coverages;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    const firstPrototype = Object.getPrototypeOf(first);
    expect(firstPrototype).not.toBe(Object.getPrototypeOf(second));
    expect(firstPrototype).not.toBe(Object.prototype);

    const secondJson = JSON.stringify(second);
    Object.defineProperty(firstPrototype, 'toJSON', {
      configurable: true,
      value: () => 'polluted',
    });
    try {
      expect(JSON.stringify(first)).toBe('"polluted"');
      expect(JSON.stringify(second)).toBe(secondJson);
      expect(JSON.stringify({ value: 1 })).toBe('{"value":1}');
    } finally {
      Reflect.deleteProperty(firstPrototype, 'toJSON');
    }
  });
});
