import { describe, expect, it } from '@rstest/core';
import {
  addDays,
  formatDate,
  getDaysBetween,
  getQuarter,
  isWeekend,
} from '../src/date';

describe('Date Utils', () => {
  describe('formatDate', () => {
    it('should format date with default format', () => {
      // Use the numeric Date ctor to avoid timezone-dependent parsing of
      // `new Date('YYYY-MM-DD')` across environments (notably Windows).
      const date = new Date(2023, 11, 25);
      expect(formatDate(date)).toBe('2023-12-25');
    });

    it('should format date with custom format', () => {
      const date = new Date(2023, 11, 25);
      expect(formatDate(date, 'DD/MM/YYYY')).toBe('25/12/2023');
    });
  });

  describe('addDays', () => {
    it('should add days to date', () => {
      const date = new Date(2023, 11, 25);
      const result = addDays(date, 5);
      expect(result.getDate()).toBe(30);
    });

    it('should subtract days from date', () => {
      const date = new Date(2023, 11, 25);
      const result = addDays(date, -5);
      expect(result.getDate()).toBe(20);
    });
  });

  describe('getDaysBetween', () => {
    it('should calculate days between two dates', () => {
      const date1 = new Date(2023, 11, 25);
      const date2 = new Date(2023, 11, 30);
      expect(getDaysBetween(date1, date2)).toBe(5);
    });

    it('should handle reversed dates', () => {
      const date1 = new Date(2023, 11, 30);
      const date2 = new Date(2023, 11, 25);
      expect(getDaysBetween(date1, date2)).toBe(5);
    });
  });

  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      const saturday = new Date(2023, 11, 23); // Saturday
      expect(isWeekend(saturday)).toBe(true);
    });

    it('should return true for Sunday', () => {
      const sunday = new Date(2023, 11, 24); // Sunday
      expect(isWeekend(sunday)).toBe(true);
    });

    it('should return false for weekday', () => {
      const monday = new Date(2023, 11, 25); // Monday
      expect(isWeekend(monday)).toBe(false);
    });
  });

  describe('getQuarter', () => {
    it('should return correct quarter for different months', () => {
      expect(getQuarter(new Date(2023, 0, 15))).toBe(1);
      expect(getQuarter(new Date(2023, 3, 15))).toBe(2);
      expect(getQuarter(new Date(2023, 6, 15))).toBe(3);
      expect(getQuarter(new Date(2023, 9, 15))).toBe(4);
    });
  });
});
