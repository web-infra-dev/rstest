import { afterAll, describe, expect, it } from '@rstest/core';

describe('Test Condition (runIf & skipIf)', () => {
  const logs: string[] = [];

  afterAll(() => {
    expect(logs.length).toBe(1);
  });

  it.skipIf(1 + 1 === 2).each([
    { a: 1, b: 1, expected: 2 },
    { a: 1, b: 2, expected: 3 },
    { a: 2, b: 1, expected: 3 },
  ])('add($a, $b) -> $expected', ({ a, b, expected }) => {
    logs.push('executed');
    expect(a + b).toBe(expected);
  });

  it.runIf(1 + 1 === 2)('add two numbers correctly', () => {
    logs.push('executed');
    expect(1 + 1).toBe(2);
  });
});
