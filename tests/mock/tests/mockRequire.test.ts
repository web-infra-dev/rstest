import { expect, it, rs } from '@rstest/core';

rs.mockRequire('is-url');

it('mocked is-url', () => {
  const isUrl = require('is-url');
  isUrl.fn('string');
  expect(isUrl.fn).toHaveBeenCalledWith('string');
  expect(isUrl()).toBe('is-url mock');
});
