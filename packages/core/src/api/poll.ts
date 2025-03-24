/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/master/packages/vitest/src/integrations/chai/poll.ts
 *
 * Copyright (c) 2021-Present Vitest Team
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { Assertion } from '@vitest/expect';
import * as chai from 'chai';
import type { RstestExpect, TestCase } from '../types';

// these matchers are not supported because they don't make sense with poll
const unsupported = [
  // .poll is meant to retry matchers until they succeed, and
  // snapshots will always succeed as long as the poll method doesn't throw an error
  // in this case using the `rstest.waitFor` method is more appropriate
  'matchSnapshot',
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
  'toThrowErrorMatchingSnapshot',
  'toThrowErrorMatchingInlineSnapshot',
  // toThrow will never succeed because we call the poll callback until it doesn't throw
  'throws',
  'Throw',
  'throw',
  'toThrow',
  'toThrowError',
  // these are not supported because you can call them without `.poll`,
  // we throw an error inside the rejects/resolves methods to prevent this
  // rejects,
  // resolves
];

export function createExpectPoll(expect: RstestExpect): RstestExpect['poll'] {
  return function poll(fn, options = {}) {
    const { interval = 50, timeout = 1000, message } = options;
    // @ts-expect-error private poll access
    const assertion = expect(null, message).withContext({
      poll: true,
    }) as Assertion;
    // biome-ignore lint/style/noParameterAssign: reassigning
    fn = fn.bind(assertion);
    // TODO: flag rstest
    const test = chai.util.flag(assertion, 'vitest-test') as
      | TestCase
      | undefined;
    if (!test) {
      throw new Error('expect.poll() must be called inside a test');
    }
    const proxy: any = new Proxy(assertion, {
      get(target, key, receiver) {
        const assertionFunction = Reflect.get(target, key, receiver);

        if (typeof assertionFunction !== 'function') {
          return assertionFunction instanceof chai.Assertion
            ? proxy
            : assertionFunction;
        }

        if (key === 'assert') {
          return assertionFunction;
        }

        if (typeof key === 'string' && unsupported.includes(key)) {
          throw new SyntaxError(
            `expect.poll() is not supported in combination with .${key}(). Use rstest.waitFor() if your assertion condition is unstable.`,
          );
        }

        return function (this: any, ...args: any[]) {
          const STACK_TRACE_ERROR = new Error('STACK_TRACE_ERROR');
          const promise = () =>
            new Promise<void>((resolve, reject) => {
              let intervalId: any;
              // biome-ignore lint/style/useConst: <explanation>
              let timeoutId: any;
              let lastError: any;
              // TODO: use timeout manager
              const check = async () => {
                try {
                  chai.util.flag(assertion, '_name', key);
                  const obj = await fn();
                  chai.util.flag(assertion, 'object', obj);
                  resolve(await assertionFunction.call(assertion, ...args));
                  clearTimeout(intervalId);
                  clearTimeout(timeoutId);
                } catch (err) {
                  lastError = err;
                  if (!chai.util.flag(assertion, '_isLastPollAttempt')) {
                    intervalId = setTimeout(check, interval);
                  }
                }
              };
              timeoutId = setTimeout(() => {
                clearTimeout(intervalId);
                chai.util.flag(assertion, '_isLastPollAttempt', true);
                const rejectWithCause = (cause: any) => {
                  reject(
                    copyStackTrace(
                      new Error(`Matcher did not succeed in ${timeout}ms`, {
                        cause,
                      }),
                      STACK_TRACE_ERROR,
                    ),
                  );
                };
                check()
                  .then(() => rejectWithCause(lastError))
                  .catch((e) => rejectWithCause(e));
              }, timeout);
              check();
            });
          let awaited = false;
          test.onFinished ??= [];
          test.onFinished.push(() => {
            if (!awaited) {
              const negated = chai.util.flag(assertion, 'negate') ? 'not.' : '';
              const name = chai.util.flag(assertion, '_poll.element')
                ? 'element(locator)'
                : 'poll(assertion)';
              const assertionString = `expect.${name}.${negated}${String(key)}()`;
              const error = new Error(
                `${assertionString} was not awaited. This assertion is asynchronous and must be awaited; otherwise, it is not executed to avoid unhandled rejections:\n\nawait ${assertionString}\n`,
              );
              throw copyStackTrace(error, STACK_TRACE_ERROR);
            }
          });
          let resultPromise: Promise<void> | undefined;
          // only .then is enough to check awaited, but we type this as `Promise<void>` in global types
          // so let's follow it
          return {
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then(onFulfilled, onRejected) {
              awaited = true;
              resultPromise ||= promise();
              return resultPromise.then(onFulfilled, onRejected);
            },
            catch(onRejected) {
              resultPromise ||= promise();
              return resultPromise.catch(onRejected);
            },
            finally(onFinally) {
              resultPromise ||= promise();
              return resultPromise.finally(onFinally);
            },
            [Symbol.toStringTag]: 'Promise',
          } satisfies Promise<void>;
        };
      },
    });
    return proxy;
  };
}

function copyStackTrace(target: Error, source: Error) {
  if (source.stack !== undefined) {
    target.stack = source.stack.replace(source.message, target.message);
  }
  return target;
}
