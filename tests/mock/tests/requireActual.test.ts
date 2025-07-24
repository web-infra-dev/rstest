import { expect, it, rs } from '@rstest/core';

const isUrl: typeof import('is-url') = require('is-url');

rs.mockRequire('is-url');

it('mocked is-url (is-url is externalized)', async () => {
  expect(isUrl('https://github.com')).toBe('is-url mock');
  // @ts-expect-error is-url has been mocked.
  isUrl.fn(1);
  // @ts-expect-error is-url has been mocked.
  expect(isUrl.fn).toBeCalledWith(1);
});

it('use `requireActual` to require actual is-url', async () => {
  const isUrl = await rs.requireActual<typeof import('is-url')>('is-url');
  expect(isUrl('https://github.com')).toBe(true);
  expect(isUrl('http://')).toBe(false);
});
