import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFailed,
} from '@rstest/core';

beforeEach(() => {
  onTestFailed(({ task }) => {
    console.log('[onTestFailed]', task.result.name);
  });
});
describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(3);
  });

  afterEach(() => {
    console.log('[afterEach] in level A');
  });
});

it('it in level B', () => {
  expect(1 + 1).toBe(2);
});
