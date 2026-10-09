import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';
import { aDirName, aFileName, aMetaDirname, aMetaFileName } from '../src/meta';

describe('import.meta', () => {
  it('should get source file meta correctly', async () => {
    expect(pathe.normalize(aDirName).endsWith('/basic/src')).toBeTruthy();
    expect(
      pathe.normalize(aFileName).endsWith('/basic/src/meta.ts'),
    ).toBeTruthy();

    expect(aMetaDirname).toBe(aDirName);
    expect(aMetaFileName).toBe(aFileName);
  });
});
