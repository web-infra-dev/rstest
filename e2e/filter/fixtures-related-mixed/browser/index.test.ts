import { describe, expect, it } from '@rstest/core';
import { sayHi } from './src/index';

describe('browser project', () => {
  it('should not be touched for node-only related sources', () => {
    expect(sayHi()).toBe('Hello, browser!');
  });
});
