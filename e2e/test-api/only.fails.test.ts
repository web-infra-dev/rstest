import { afterAll, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs.length).toBe(1);
});

it.only
  .fails('will pass when failed', () => {
    logs.push('executed');
    expect(1 + 1).toBe(1);
  });

it('will not run', () => {
  logs.push('executed');
  expect(1 + 1).toBe(1);
});
