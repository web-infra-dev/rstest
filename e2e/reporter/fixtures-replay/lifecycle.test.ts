import { describe, expect, it } from '@rstest/core';

console.log('module log');

describe('outer', () => {
  it('case 1', () => {
    console.log('case 1 log');
    expect(1).toBe(1);
  });

  describe('inner', () => {
    it('case 2', () => {
      expect(2).toBe(2);
    });

    it.skip('skipped case', () => {
      expect(3).toBe(4);
    });
  });

  it.todo('todo case');
});
