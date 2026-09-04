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
});
