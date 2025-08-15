import { expect, it } from '@rstest/core';
import { getA } from './a';

it('should singleton A', () => {
  expect(getA()).toBe(process.env.A);
});

it('should singleton B', async () => {
  const { getB } = await import('./b');
  expect(getB()).toBe(process.env.B);
});
