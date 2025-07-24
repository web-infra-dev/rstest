import { expect, it, rs } from '@rstest/core';
import { b } from '../src/b';
import { d } from '../src/d';

// b
rs.mock(import('../src/b'), async () => {
  return {
    b: 222,
  };
});

it('mocked b', async () => {
  expect(b).toBe(222);
});

// c
it('mocked c', async () => {
  rs.doMock(import('../src/c'), () => {
    return { c: 333 };
  });

  const { c } = await import('../src/c');
  expect(c).toBe(333);
});

// d
rs.mock<{ d: number }>('../src/d', async () => {
  return {
    d: 444,
  };
});

it('mocked d', async () => {
  expect(d).toBe(444);
});
