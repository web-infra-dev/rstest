import { describe, expect, it } from '@rstest/core';
import { sayFoo, sayFoo1 } from '../src/foo';

describe('Foo', () => {
  describe('inner Foo', () => {
    it('should return "foo"', () => {
      expect(sayFoo()).toBe('foo');
    });

    it('should return "foo1"', () => {
      expect(sayFoo1()).toBe('foo11');
    });
  });
});
