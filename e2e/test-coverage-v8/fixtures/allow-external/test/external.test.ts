import { describe, expect, it } from '@rstest/core';
import { externalAdd } from '../../external-module/helper';
import { internalGreet } from '../src/internal';

describe('allowExternal test', () => {
  it('should use internal module', () => {
    expect(internalGreet('World')).toBe('Hello, World!');
  });

  it('should use external module', () => {
    expect(externalAdd(1, 2)).toBe(3);
  });
});
