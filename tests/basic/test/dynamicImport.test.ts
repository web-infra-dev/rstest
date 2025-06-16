import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';

describe('Dynamic import', () => {
  it('should test correctly with dynamic import', async () => {
    const { sayHi } = await import('../src/index');
    expect(sayHi()).toBe('hi');
  });

  it('should get source file meta correctly with dynamic import', async () => {
    const { aDirName, aFileName } = await import('../src/meta');
    expect(pathe.normalize(aDirName).endsWith('/basic/src')).toBeTruthy();
    expect(
      pathe.normalize(aFileName).endsWith('/basic/src/meta.ts'),
    ).toBeTruthy();
  });
});
