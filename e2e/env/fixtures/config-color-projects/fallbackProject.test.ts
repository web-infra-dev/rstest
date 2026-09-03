import { styleText } from 'node:util';
import { expect, it } from '@rstest/core';

it('uses the color default for a project without an override', () => {
  expect(process.env.FORCE_COLOR).toBe('1');
  expect(styleText('yellow', 'X')).toContain('\u001b[');
});
