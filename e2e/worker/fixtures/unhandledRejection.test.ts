import { describe, expect, it } from '@rstest/core';

describe('Index', () => {
  it('should add two numbers correctly', async () => {
    setTimeout(() => {
      expect('hello').toBe('hii');
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(1 + 1).toBe(2);
  });
});
