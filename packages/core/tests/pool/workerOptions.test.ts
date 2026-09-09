import { assertWorkerEnvironmentOptions } from '../../src/pool/workerOptions';

describe('assertWorkerEnvironmentOptions', () => {
  it('accepts structured-cloneable environment options', () => {
    expect(() =>
      assertWorkerEnvironmentOptions({
        html: '<!doctype html>',
        url: 'https://example.com',
        includeNodeLocations: true,
      }),
    ).not.toThrow();
  });

  it('rejects function-valued environment options before dispatch', () => {
    expect(() =>
      assertWorkerEnvironmentOptions({
        beforeParse: () => {},
      }),
    ).toThrow(
      'Node worker pools require `testEnvironment.options` to be structured-cloneable',
    );
  });

  it('rejects values that change shape across Bun fork IPC', () => {
    const originalBunVersion = process.versions.bun;
    process.versions.bun = originalBunVersion ?? '1.0.0';

    try {
      expect(() =>
        assertWorkerEnvironmentOptions(
          { metadata: new Map([['key', 'value']]) },
          'vmForks',
        ),
      ).toThrow('Bun fork pools require');
    } finally {
      if (originalBunVersion === undefined) {
        Reflect.deleteProperty(process.versions, 'bun');
      } else {
        process.versions.bun = originalBunVersion;
      }
    }
  });

  it('keeps structured-clone values for Bun VM threads', () => {
    const originalBunVersion = process.versions.bun;
    process.versions.bun = originalBunVersion ?? '1.0.0';

    try {
      expect(() =>
        assertWorkerEnvironmentOptions(
          { metadata: new Map([['key', 'value']]) },
          'vmThreads',
        ),
      ).not.toThrow();
    } finally {
      if (originalBunVersion === undefined) {
        Reflect.deleteProperty(process.versions, 'bun');
      } else {
        process.versions.bun = originalBunVersion;
      }
    }
  });
});
