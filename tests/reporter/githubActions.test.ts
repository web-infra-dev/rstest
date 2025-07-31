import { expect, it } from '@rstest/core';

it('should add two numbers correctly', () => {
  expect(1 + 1).toBe(4);
});

it('test snapshot', () => {
  expect('hello').toMatchInlineSnapshot(`"hello world"`);
});
