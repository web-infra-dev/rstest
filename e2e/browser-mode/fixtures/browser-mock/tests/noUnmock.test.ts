import { expect, it } from '@rstest/core';
import { flag } from '../src/unmockTarget';

it('the setup file mock applies to files that do not unmock', () => {
  expect(flag).toBe('mocked');
});
