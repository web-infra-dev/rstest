import { styleText } from 'node:util';
import { expect, it } from '@rstest/core';
import picocolors from 'picocolors';

it('disables colors for the configured project', () => {
  expect(process.env.NO_COLOR).toBe('1');
  expect(process.env.FORCE_COLOR).toBeUndefined();
  expect(picocolors.isColorSupported).toBe(false);
  expect(styleText('yellow', 'X')).toBe('X');
});
