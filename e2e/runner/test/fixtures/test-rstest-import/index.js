import { beforeAll, describe, expect, it, rs } from '@rstest/core';

beforeAll(() => {
  process.env.A = 'A';
});

describe('wrap test', () => {
  it('should run', () => {
    const fn = rs.fn(() => 'hello');

    expect(fn()).toBe('hello');
    expect('call it').toBe('call it');
  });

  it.todo('should not run', () => {
    expect(1 + 1).toBe(3);
  });
});
