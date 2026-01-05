import type { Rstest, RstestUtilities } from '../../types';

export type { Assertion } from '../../types/expect';
export type { Mock } from '../../types/mock';

declare global {
  var RSTEST_API: Rstest | undefined;
}

const check = (name: keyof Rstest) => {
  if (!globalThis.RSTEST_API?.[name]) {
    throw new Error(
      `Rstest API '${name}' is not registered yet, please make sure you are running in a rstest environment.`,
    );
  }
};

const wrapRstestAPI = <T extends keyof Omit<Rstest, 'rstest' | 'rs'>>(
  name: T,
): Rstest[T] => {
  const fn = (...args: Parameters<Rstest[T]>) => {
    check(name);
    return globalThis.RSTEST_API![name].call(
      globalThis.RSTEST_API![name],
      // @ts-expect-error
      ...args,
    );
  };

  return new Proxy(fn, {
    get(_target, key, receiver) {
      // Don't throw error on property access when RSTEST_API is not initialized.
      // This allows React Fast Refresh to safely iterate over exports without triggering errors.
      // The actual check happens when the API is called (in `fn`).
      if (!globalThis.RSTEST_API?.[name]) {
        return Reflect.get(fn, key, receiver);
      }
      return Reflect.get(globalThis.RSTEST_API[name], key, receiver);
    },
  }) as Rstest[T];
};

const wrapRstestUtilitiesAPI = <T extends keyof Pick<Rstest, 'rstest' | 'rs'>>(
  name: T,
): Rstest[T] => {
  return new Proxy({} as Rstest[T], {
    get(_target, key, receiver) {
      check(name);
      return Reflect.get(globalThis.RSTEST_API?.[name] || {}, key, receiver);
    },
  });
};

export const expect: Rstest['expect'] = wrapRstestAPI('expect');
export const assert: Rstest['assert'] = wrapRstestAPI('assert');
export const it: Rstest['it'] = wrapRstestAPI('it');
export const test: Rstest['test'] = wrapRstestAPI('test');
export const describe: Rstest['describe'] = wrapRstestAPI('describe');
export const beforeAll: Rstest['beforeAll'] = wrapRstestAPI('beforeAll');
export const afterAll: Rstest['afterAll'] = wrapRstestAPI('afterAll');
export const beforeEach: Rstest['beforeEach'] = wrapRstestAPI('beforeEach');
export const afterEach: Rstest['afterEach'] = wrapRstestAPI('afterEach');
export const rstest: RstestUtilities = wrapRstestUtilitiesAPI('rstest');
export const rs: RstestUtilities = wrapRstestUtilitiesAPI('rs');
export const onTestFinished: Rstest['onTestFinished'] =
  wrapRstestAPI('onTestFinished');
export const onTestFailed: Rstest['onTestFailed'] =
  wrapRstestAPI('onTestFailed');
