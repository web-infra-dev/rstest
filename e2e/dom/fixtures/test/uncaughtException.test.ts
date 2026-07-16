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
