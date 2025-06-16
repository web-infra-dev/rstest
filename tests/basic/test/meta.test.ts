import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';
import { aDirName, aFileName } from '../src/meta';

describe('import.meta', () => {
  it('should get test file meta correctly', async () => {
    expect(
      pathe.normalize(__dirname).endsWith('/rstest/tests/basic/test'),
    ).toBeTruthy();
    expect(
      pathe.normalize(__filename).endsWith('/basic/test/meta.test.ts'),
    ).toBeTruthy();
  });

  it('should get test file import meta correctly', async () => {
    expect(
      pathe.normalize(import.meta.dirname).includes('/basic/test'),
    ).toBeTruthy();
    expect(
      pathe
        .normalize(import.meta.filename)
        .endsWith('/basic/test/meta.test.ts'),
    ).toBeTruthy();
  });

  // TODO
  it.todo('should get source file meta correctly', async () => {
    expect(pathe.normalize(aDirName).endsWith('/basic/src')).toBeTruthy();
    expect(
      pathe.normalize(aFileName).endsWith('/basic/src/meta.ts'),
    ).toBeTruthy();
  });
});
