import { expect, it } from '@rstest/core';

it('test asymmetricMatcher error', () => {
  expect({
    text: 'hello world',
  }).toEqual({
    text: expect.stringMatching('hhh'),
  });
});
