import { afterAll, describe, expect, it } from '@rstest/core';

describe('Describe skipIf & runIf API', async () => {
  const logs: string[] = [];

  afterAll(() => {
    expect(logs.length).toBe(1);
  });

  describe.skipIf(1 + 1 === 2).each([
    { a: 1, b: 1, expected: 2 },
    { a: 1, b: 2, expected: 3 },
    { a: 2, b: 1, expected: 3 },
  ])('add two numbers correctly', ({ a, b, expected }) => {
    it(`should return ${expected}`, () => {
      logs.push('executed');
      expect(a + b).toBe(expected);
    });
  });

  describe.runIf(1 + 1 === 2)('add two numbers correctly', () => {
    it('add two numbers correctly', () => {
      logs.push('executed');
      expect(1 + 1).toBe(2);
    });
  });
});
