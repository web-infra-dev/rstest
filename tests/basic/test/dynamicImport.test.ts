import { describe, expect, it } from '@rstest/core';

describe('Dynamic import', () => {
  it('should test correctly with dynamic import', async () => {
    const { sayHi } = await import('../src/index');
    expect(sayHi()).toBe('hi');
  });

  it.todo(
    'should get source file meta correctly with dynamic import',
    async () => {
      const { aDirName, aFileName } = await import('../src/meta');
      expect(aDirName.endsWith('/basic/src')).toBeTruthy();
      expect(aFileName.endsWith('/basic/src/meta.ts')).toBeTruthy();
    },
  );
});
