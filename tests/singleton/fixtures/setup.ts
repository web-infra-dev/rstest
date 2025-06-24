import { beforeAll } from '@rstest/core';
import { getA } from './a';

beforeAll(async () => {
  const A = getA();

  process.env.A = A;
  const { getB } = await import('./b');

  const B = getB();
  process.env.B = B;
});
