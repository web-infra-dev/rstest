/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/e8ce94cfb5520a8b69f9071cc5638a53129130d6/packages/vitest/src/integrations/snapshot/chai.ts
 */
import type { Assertion, ChaiPlugin } from '@vitest/expect';
import { equals, iterableEquality, subsetEquality } from '@vitest/expect';
import {
  SnapshotClient,
  addSerializer,
  stripSnapshotIndentation,
} from '@vitest/snapshot';
import type { TestCase } from '../../types';
import { getTaskNameWithPrefix } from '../../utils';

let _client: SnapshotClient;

export function getSnapshotClient(): SnapshotClient {
  if (!_client) {
    _client = new SnapshotClient({
      isEqual: (received, expected) => {
        return equals(received, expected, [iterableEquality, subsetEquality]);
      },
    });
  }
  return _client;
}

function recordAsyncExpect(
  _test: any,
  promise: Promise<any>,
  assertion: string,
  error: Error,
): Promise<any> {
  const test = _test as TestCase | undefined;
  // record promise for test, that resolves before test ends
  if (test && promise instanceof Promise) {
    // if promise is explicitly awaited, remove it from the list
    // biome-ignore lint/style/noParameterAssign: reassigning
    promise = promise.finally(() => {
      if (!test.promises) {
        return;
      }
      const index = test.promises.indexOf(promise);
      if (index !== -1) {
        test.promises.splice(index, 1);
      }
    });

    // record promise
    if (!test.promises) {
      test.promises = [];
    }
    test.promises.push(promise);

    let resolved = false;
    test.onFinished ??= [];
    test.onFinished.push(() => {
      if (!resolved) {
        const processor =
          (globalThis as any).__vitest_worker__?.onFilterStackTrace ||
          ((s: string) => s || '');
        const stack = processor(error.stack);
        console.warn(
          [
            `Promise returned by \`${assertion}\` was not awaited. `,
            'Rstest currently auto-awaits hanging assertions at the end of the test.',
            'Please remember to await the assertion.\n',
            stack,
          ].join(''),
        );
      }
    });

    return {
      // biome-ignore lint/suspicious/noThenProperty: promise
      then(onFulfilled, onRejected) {
        resolved = true;
        return promise.then(onFulfilled, onRejected);
      },
      catch(onRejected) {
        return promise.catch(onRejected);
      },
      finally(onFinally) {
        return promise.finally(onFinally);
      },
      [Symbol.toStringTag]: 'Promise',
    } satisfies Promise<any>;
  }

  return promise;
}

function createAssertionMessage(
  util: Chai.ChaiUtils,
  assertion: Assertion,
  hasArgs: boolean,
) {
  const not = util.flag(assertion, 'negate') ? 'not.' : '';
  const name = `${util.flag(assertion, '_name')}(${hasArgs ? 'expected' : ''})`;
  const promiseName = util.flag(assertion, 'promise');
  const promise = promiseName ? `.${promiseName}` : '';
  return `expect(actual)${promise}.${not}${name}`;
}

function getError(expected: () => void | Error, promise: string | undefined) {
  if (typeof expected !== 'function') {
    if (!promise) {
      throw new Error(
        `expected must be a function, received ${typeof expected}`,
      );
    }

    // when "promised", it receives thrown error
    return expected;
  }

  try {
    expected();
  } catch (e) {
    return e;
  }

  throw new Error("snapshot function didn't throw");
}

function getTestNames(test: TestCase) {
  return {
    filepath: test.filePath,
    name: getTaskNameWithPrefix(test),
    // testId: test.id,
  };
}

export const SnapshotPlugin: ChaiPlugin = (chai, utils) => {
  function getTest(assertionName: string, obj: object) {
    const test = utils.flag(obj, 'vitest-test');
    if (!test) {
      throw new Error(`'${assertionName}' cannot be used without test context`);
    }
    return test as TestCase;
  }

  for (const key of ['matchSnapshot', 'toMatchSnapshot']) {
    utils.addMethod(
      chai.Assertion.prototype,
      key,
      function (
        this: Record<string, unknown>,
        properties?: object,
        message?: string,
      ) {
        utils.flag(this, '_name', key);
        const isNot = utils.flag(this, 'negate');
        if (isNot) {
          throw new Error(`${key} cannot be used with "not"`);
        }
        const expected = utils.flag(this, 'object');
        const test = getTest(key, this);
        if (typeof properties === 'string' && typeof message === 'undefined') {
          // biome-ignore lint/style/noParameterAssign: reassigning
          message = properties;
          // biome-ignore lint/style/noParameterAssign: reassigning
          properties = undefined;
        }
        const errorMessage = utils.flag(this, 'message');
        getSnapshotClient().assert({
          received: expected,
          message,
          isInline: false,
          properties,
          errorMessage,
          ...getTestNames(test),
        });
      },
    );
  }

  utils.addMethod(
    chai.Assertion.prototype,
    'toMatchFileSnapshot',
    function (this: Assertion, file: string, message?: string) {
      utils.flag(this, '_name', 'toMatchFileSnapshot');
      const isNot = utils.flag(this, 'negate');
      if (isNot) {
        throw new Error('toMatchFileSnapshot cannot be used with "not"');
      }
      const error = new Error('resolves');
      const expected = utils.flag(this, 'object');
      const test = getTest('toMatchFileSnapshot', this);
      const errorMessage = utils.flag(this, 'message');

      const promise = getSnapshotClient().assertRaw({
        received: expected,
        message,
        isInline: false,
        rawSnapshot: {
          file,
        },
        errorMessage,
        ...getTestNames(test),
      });

      return recordAsyncExpect(
        test,
        promise,
        createAssertionMessage(utils, this, true),
        error,
      );
    },
  );

  utils.addMethod(
    chai.Assertion.prototype,
    'toMatchInlineSnapshot',
    function __INLINE_SNAPSHOT__(
      this: Record<string, unknown>,
      properties?: object,
      inlineSnapshot?: string,
      message?: string,
    ) {
      utils.flag(this, '_name', 'toMatchInlineSnapshot');
      const isNot = utils.flag(this, 'negate');
      if (isNot) {
        throw new Error('toMatchInlineSnapshot cannot be used with "not"');
      }
      const test = getTest('toMatchInlineSnapshot', this);
      // TODO
      //   const isInsideEach = test.each || test.suite?.each;
      //   if (isInsideEach) {
      //     throw new Error(
      //       'InlineSnapshot cannot be used inside of test.each or describe.each',
      //     );
      //   }
      const expected = utils.flag(this, 'object');
      const error = utils.flag(this, 'error');
      if (typeof properties === 'string') {
        // biome-ignore lint/style/noParameterAssign: reassigning
        message = inlineSnapshot;
        // biome-ignore lint/style/noParameterAssign: reassigning
        inlineSnapshot = properties;
        // biome-ignore lint/style/noParameterAssign: reassigning
        properties = undefined;
      }
      if (inlineSnapshot) {
        // biome-ignore lint/style/noParameterAssign: reassigning
        inlineSnapshot = stripSnapshotIndentation(inlineSnapshot);
      }
      const errorMessage = utils.flag(this, 'message');

      getSnapshotClient().assert({
        received: expected,
        message,
        isInline: true,
        properties,
        inlineSnapshot,
        error,
        errorMessage,
        ...getTestNames(test),
      });
    },
  );
  utils.addMethod(
    chai.Assertion.prototype,
    'toThrowErrorMatchingSnapshot',
    function (this: Record<string, unknown>, message?: string) {
      utils.flag(this, '_name', 'toThrowErrorMatchingSnapshot');
      const isNot = utils.flag(this, 'negate');
      if (isNot) {
        throw new Error(
          'toThrowErrorMatchingSnapshot cannot be used with "not"',
        );
      }
      const expected = utils.flag(this, 'object');
      const test = getTest('toThrowErrorMatchingSnapshot', this);
      const promise = utils.flag(this, 'promise') as string | undefined;
      const errorMessage = utils.flag(this, 'message');
      getSnapshotClient().assert({
        received: getError(expected, promise),
        message,
        errorMessage,
        ...getTestNames(test),
      });
    },
  );
  utils.addMethod(
    chai.Assertion.prototype,
    'toThrowErrorMatchingInlineSnapshot',
    function __INLINE_SNAPSHOT__(
      this: Record<string, unknown>,
      inlineSnapshot: string,
      message: string,
    ) {
      const isNot = utils.flag(this, 'negate');
      if (isNot) {
        throw new Error(
          'toThrowErrorMatchingInlineSnapshot cannot be used with "not"',
        );
      }
      const test = getTest('toThrowErrorMatchingInlineSnapshot', this);
      // TODO
      //   const isInsideEach = test.each || test.suite?.each;
      //   if (isInsideEach) {
      //     throw new Error(
      //       'InlineSnapshot cannot be used inside of test.each or describe.each',
      //     );
      //   }
      const expected = utils.flag(this, 'object');
      const error = utils.flag(this, 'error');
      const promise = utils.flag(this, 'promise') as string | undefined;
      const errorMessage = utils.flag(this, 'message');

      if (inlineSnapshot) {
        // biome-ignore lint/style/noParameterAssign: reassigning
        inlineSnapshot = stripSnapshotIndentation(inlineSnapshot);
      }

      getSnapshotClient().assert({
        received: getError(expected, promise),
        message,
        inlineSnapshot,
        isInline: true,
        error,
        errorMessage,
        ...getTestNames(test),
      });
    },
  );
  utils.addMethod(chai.expect, 'addSnapshotSerializer', addSerializer);
};
