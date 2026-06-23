import { expect, it } from '@rstest/core';
import { tested } from './tested';

it('runs a covered file', () => {
  expect(tested()).toBe('tested');
});
