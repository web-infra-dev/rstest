import { describe, expect, it } from '@rstest/core';

describe('agent-md', () => {
  it('fails with console output', () => {
    console.log('hello from console.log');
    console.warn('hello from console.warn');
    console.error('hello from console.error');
    expect(1).toBe(2);
  });
});
