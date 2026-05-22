import { describe, expect, it } from '@rstest/core';
import { getScopedPackageName } from '../src/index';

describe('scoped package source', () => {
  it('runs source under a scoped @rstest folder', () => {
    expect(getScopedPackageName()).toBe('@rstest/app');
  });
});
