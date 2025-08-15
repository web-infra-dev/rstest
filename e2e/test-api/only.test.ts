import { afterAll, beforeEach, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs).toEqual([
    '[beforeEach] root',
    '[test] in level A',
    '[beforeEach] root',
    '[test] in level B-B',
    '[beforeEach] root',
    '[test] in level D',
  ]);
});

beforeEach(() => {
  logs.push('[beforeEach] root');
});

describe('level A', () => {
  it.only('it in level A', () => {
    logs.push('[test] in level A');
    expect(1 + 1).toBe(2);
  });

  describe('level B', () => {
    it('it in level B-A', () => {
      logs.push('[test] in level B-A');
      expect(2 + 1).toBe(3);
    });

    it.only('it in level B-B', () => {
      logs.push('[test] in level B-B');
      expect(2 + 1).toBe(3);
    });
  });

  it('it in level C', () => {
    logs.push('[test] in level C');
    expect(2 + 2).toBe(4);
  });
});

it.only('it in level D', () => {
  logs.push('[test] in level D');
  expect(1 + 1).toBe(2);
});

describe('level E', () => {
  it('it in level E-A', () => {
    logs.push('[test] in level E-A');
    expect(2 + 1).toBe(3);
  });
});
