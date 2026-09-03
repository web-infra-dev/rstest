import { styleText } from 'node:util';
import { expect, it } from '@rstest/core';

it('disables colors for the configured project', () => {
  expect(process.env.NO_COLOR).toBe('1');
  expect(process.env.FORCE_COLOR).toBeUndefined();
  expect(styleText('yellow', 'X')).toBe('X');
});
