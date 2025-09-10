import { beforeAll } from '@rstest/core';
import { getA } from './a';

beforeAll(async (context) => {
  const A = getA();

  process.env.A = A;
  const { getB } = await import('./b');

  const B = getB();
  if (context.filepath.includes('index.test')) {
    process.env.B = B;
  } else {
    process.env.C = B;
  }
});
