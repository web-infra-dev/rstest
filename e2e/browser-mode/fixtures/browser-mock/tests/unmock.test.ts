import { expect, it, rs } from '@rstest/core';
import { flag } from '../src/unmockTarget';

// The setup file mocks `../src/unmockTarget`; unmock must cancel it here.
rs.unmock('../src/unmockTarget');

it('unmock cancels a mock registered in the setup file', () => {
  expect(flag).toBe('real');
});
