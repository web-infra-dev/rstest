import { test } from '@rstest/core';

test('uncaughtException', async () => {
  // Reject a promise
  Promise.reject('reject error');

  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('preserves object rejection details', async () => {
  Promise.reject({
    name: 'TypeError',
    message: 'object rejection',
    stack: 'object rejection stack',
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('preserves cross-realm rejection details', async () => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const CrossRealmTypeError = Reflect.get(
    iframe.contentWindow!,
    'TypeError',
  ) as TypeErrorConstructor;
  const crossRealmError = Object.assign(
    new CrossRealmTypeError('cross-realm rejection'),
    { stack: 'cross-realm rejection stack' },
  );
  Promise.reject(crossRealmError);

  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('preserves DOMException rejection details', async () => {
  const error = new DOMException('denied', 'SecurityError');
  Object.defineProperty(error, 'stack', {
    value:
      'SecurityError: denied\n    at domExceptionOrigin (test/uncaughtException.test.ts:1:1)',
  });
  Promise.reject(error);

  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('preserves assertion rejection metadata', async () => {
  Promise.reject({
    name: 'AssertionError',
    message: 'assertion rejection',
    stack: 'assertion rejection stack',
    actual: 'actual value',
    expected: 'expected value',
    showDiff: true,
    fullStack: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
});
