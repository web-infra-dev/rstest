import { describe, expect, it } from '@rstest/core';
import { sayFoo, sayFoo1 } from '../src/foo';

describe('l1', () => {
  describe('l2', () => {
    it('should return "foo"', () => {
      expect(sayFoo()).toBe('foo');
    });

    it('should also return "foo"', () => {
      expect(sayFoo()).toBe('foo');
    });

    describe('l3', () => {
      it('should return "foo1"', () => {
        expect(sayFoo1()).toBe('foo2');
      });

      it('should also return "foo1"', () => {
        expect(sayFoo1()).toBe('foo3');
      });
    });
  });
});
