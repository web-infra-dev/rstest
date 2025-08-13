import { describe, expect, it } from '@rstest/core';
import { sayFoo } from '../src/foo';

describe('Foo', () => {
  it('should add two numbers correctly', () => {
    expect(1 + 2).toBe(3);
  });

  it('should test source code correctly', () => {
    expect(sayFoo()).toBe('foo');
  });
});
