import { afterEach, describe, expect, it } from '@rstest/core';
import { createLazyPrepareStackTrace } from '../../../src/runtime/worker/lazyPrepareStackTrace';

describe('createLazyPrepareStackTrace', () => {
  const originalPrepareStackTrace = Error.prepareStackTrace;

  afterEach(() => {
    Error.prepareStackTrace = originalPrepareStackTrace;
  });

  const createInstaller = (
    formatter: NonNullable<typeof Error.prepareStackTrace>,
  ) => {
    let installCount = 0;
    const install = () => {
      installCount += 1;
      Error.prepareStackTrace = formatter;
      return Error.prepareStackTrace;
    };
    return { install, getCount: () => installCount };
  };

  it('installs only when the first stack is formatted', () => {
    const { install, getCount } = createInstaller(
      (error) => `mapped:${error.message}`,
    );
    Error.prepareStackTrace = createLazyPrepareStackTrace(install);

    expect(getCount()).toBe(0);
    expect(new Error('first').stack).toBe('mapped:first');
    expect(new Error('second').stack).toBe('mapped:second');
    expect(getCount()).toBe(1);
  });

  it('keeps a user wrapper installed after it', () => {
    const { install } = createInstaller((error) => `mapped:${error.message}`);
    Error.prepareStackTrace = createLazyPrepareStackTrace(install);

    // A user library captures the runtime formatter and wraps it, exactly as
    // it would after the worker has started.
    const previous = Error.prepareStackTrace!;
    const wrapper: NonNullable<typeof Error.prepareStackTrace> = (
      error,
      stack,
    ) => `wrapped(${previous(error, stack)})`;
    Error.prepareStackTrace = wrapper;

    expect(new Error('first').stack).toBe('wrapped(mapped:first)');
    expect(Error.prepareStackTrace).toBe(wrapper);
    expect(new Error('second').stack).toBe('wrapped(mapped:second)');
    expect(Error.prepareStackTrace).toBe(wrapper);
  });

  it('retries after the first install throws', () => {
    let attempts = 0;
    const install = () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('install failed');
      }
      Error.prepareStackTrace = (error) => `mapped:${error.message}`;
      return Error.prepareStackTrace;
    };
    Error.prepareStackTrace = createLazyPrepareStackTrace(install);

    expect(() => new Error('first').stack).toThrow('install failed');
    expect(attempts).toBe(1);

    expect(new Error('second').stack).toBe('mapped:second');
    expect(attempts).toBe(2);
  });

  it('does not install when a user replaces the formatter outright', () => {
    const { install, getCount } = createInstaller(
      (error) => `mapped:${error.message}`,
    );
    Error.prepareStackTrace = createLazyPrepareStackTrace(install);
    Error.prepareStackTrace = (error) => `user:${error.message}`;

    expect(new Error('first').stack).toBe('user:first');
    expect(getCount()).toBe(0);
  });
});
