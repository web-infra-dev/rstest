import { expect, it } from '@rstest/core';

let attempts = 0;

it('retried test', { retry: 2 }, () => {
  attempts++;
  expect({ value: 'stable' }).toMatchSnapshot();
  expect('second').toMatchSnapshot();
  // fail the first attempt after the snapshots were checked
  expect(attempts).toBe(2);
});

it('repeated test', { repeats: 2 }, () => {
  expect('same on every repeat').toMatchSnapshot();
});
