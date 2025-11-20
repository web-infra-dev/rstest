import { afterAll, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs.length).toBe(7);
});

describe.each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add two numbers correctly', ({ a, b, expected }) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
    logs.push('executed');
  });
});

describe.each([
  [2, 1, 3],
  [2, 2, 4],
  [3, 1, 4],
])('add two numbers correctly', (a, b, expected) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
    logs.push('executed');
  });
});
interface TestCase {
  name: string;
  targets: string[];
}

const TEST_CASES: TestCase[] = [
  {
    name: 'react-16',
    targets: ['node'],
  },
];

describe.each(TEST_CASES)('test case $name', ({ name, targets }) => {
  it(`should run ${name}`, () => {
    expect(targets).toBeDefined();
    logs.push('executed');
  });
});
