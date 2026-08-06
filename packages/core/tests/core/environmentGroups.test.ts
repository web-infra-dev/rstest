import { getEnvironmentKey } from '../../src/core/environmentGroups';

describe('getEnvironmentKey', () => {
  it('should ignore property order', () => {
    // The key decides both entry grouping and worker reuse affinity, so two
    // configs that differ only in property order must not split a project or
    // shed each other's worker.
    expect(
      getEnvironmentKey({
        name: 'jsdom',
        options: { url: 'http://localhost', pretendToBeVisual: true },
      }),
    ).toBe(
      getEnvironmentKey({
        name: 'jsdom',
        options: { pretendToBeVisual: true, url: 'http://localhost' },
      }),
    );
  });

  it('should distinguish different options', () => {
    expect(getEnvironmentKey({ name: 'jsdom' })).not.toBe(
      getEnvironmentKey({ name: 'jsdom', options: { url: 'http://a.dev' } }),
    );
  });

  it('should distinguish resolved environment modules', () => {
    const testEnvironment = { name: 'jsdom' } as const;
    const moduleReference = {
      name: 'jsdom',
      packageName: 'jsdom',
      resolvedPath: '/project-a/node_modules/jsdom/lib/api.js',
    } as const;

    expect(getEnvironmentKey(testEnvironment, moduleReference)).not.toBe(
      getEnvironmentKey(testEnvironment, {
        ...moduleReference,
        resolvedPath: '/project-b/node_modules/jsdom/lib/api.js',
      }),
    );
    expect(getEnvironmentKey(testEnvironment, moduleReference)).not.toBe(
      getEnvironmentKey(testEnvironment, {
        ...moduleReference,
        bundlePath: '/tmp/project-a/environment.mjs',
      }),
    );
  });
});
