import { styleText } from 'node:util';
import { expect, it } from '@rstest/core';
import picocolors from 'picocolors';

it('uses the color default for a project without an override', () => {
  expect(process.env.FORCE_COLOR).toBeUndefined();
  expect(process.env.NO_COLOR).toBeUndefined();
  expect(picocolors.isColorSupported).toBe(true);
  expect(styleText('yellow', 'X')).toBe('X');
});
