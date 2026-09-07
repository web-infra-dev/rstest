import { styleText } from 'node:util';
import { expect, it } from '@rstest/core';

it('disables colors from config env', () => {
  const styledText = styleText('yellow', 'X');

  expect(process.env.NO_COLOR).toBe('1');
  expect(process.env.FORCE_COLOR).toBeUndefined();
  expect(styledText).toBe('X');
});
