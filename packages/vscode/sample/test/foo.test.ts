import { describe, expect, it } from '@rstest/core';
import { sayFoo } from '../src/foo';

describe('Foo', () => {
  describe('inner Foo', () => {
    it('should return "foo"', () => {
      expect(sayFoo()).toBe('foo');
    });
  });
});
