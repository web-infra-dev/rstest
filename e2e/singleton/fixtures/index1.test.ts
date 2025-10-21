import { expect, it } from '@rstest/core';
import { getC } from 'c';
import { getA } from './a';

it('should singleton A', () => {
  expect(getA()).toBe(process.env.A);
});

it('should singleton B', async () => {
  if (process.env.TestNoIsolate) {
    const { getB } = await import('./b');
    expect(getB()).toBe(process.env.B);
  } else {
    expect(process.env.B).toBeUndefined();
  }
});

it('should singleton B - 1', async () => {
  const { getB } = await import('./b');
  expect(getB()).toBe(process.env.B1);
});

it('should singleton C', () => {
  expect(getC()).toBe(process.env.C);
});
