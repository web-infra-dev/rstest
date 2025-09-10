import { describe, expect, it } from '@rstest/core';
import {
  chunk,
  findMax,
  flatten,
  removeDuplicates,
  shuffle,
} from '../src/array';

describe('Array Utils', () => {
  describe('removeDuplicates', () => {
    it('should remove duplicate numbers', () => {
      expect(removeDuplicates([1, 2, 2, 3, 3, 4])).toEqual([1, 2, 3, 4]);
    });

    it('should remove duplicate strings', () => {
      expect(removeDuplicates(['a', 'b', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('should handle empty array', () => {
      expect(removeDuplicates([])).toEqual([]);
    });
  });

  describe('chunk', () => {
    it('should chunk array into specified size', () => {
      expect(chunk([1, 2, 3, 4, 5, 6], 2)).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    it('should handle remainder elements', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should throw error for invalid chunk size', () => {
      expect(() => chunk([1, 2, 3], 0)).toThrow(
        'Chunk size must be greater than 0',
      );
    });
  });

  describe('flatten', () => {
    it('should flatten nested arrays', () => {
      expect(flatten([1, [2, 3], [4, [5, 6]]])).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should handle empty arrays', () => {
      expect(flatten([])).toEqual([]);
    });
  });

  describe('findMax', () => {
    it('should find maximum number', () => {
      expect(findMax([1, 5, 3, 9, 2])).toBe(9);
    });

    it('should throw error for empty array', () => {
      expect(() => findMax([])).toThrow('Array cannot be empty');
    });
  });

  describe('shuffle', () => {
    it('should return array with same length', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = shuffle(original);
      expect(shuffled).toHaveLength(original.length);
    });

    it('should contain all original elements', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = shuffle(original);
      expect(shuffled.sort()).toEqual(original.sort());
    });
  });
});
