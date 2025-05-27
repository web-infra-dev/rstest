import { describe, expect, it } from '@rstest/core';
import { aDirName, aFileName } from '../src/meta';

describe('Meta', () => {
  it('should get test file meta correctly', async () => {
    expect(__dirname.endsWith('/rstest/tests/basic/test')).toBeTruthy();
    expect(__filename.endsWith('/basic/test/meta.test.ts')).toBeTruthy();
  });

  it('should get test file import meta correctly', async () => {
    expect(import.meta.dirname.includes('/basic/test')).toBeTruthy();
    expect(
      import.meta.filename.endsWith('/basic/test/meta.test.ts'),
    ).toBeTruthy();
  });

  // TODO
  it.todo('should get source file meta correctly', async () => {
    expect(aDirName.endsWith('/basic/src')).toBeTruthy();
    expect(aFileName.endsWith('/basic/src/meta.ts')).toBeTruthy();
  });
});
