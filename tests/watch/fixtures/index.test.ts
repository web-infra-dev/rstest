import { describe, expect, it } from '@rstest/core';
import { sayHi } from './src/index';

describe('index', () => {
  it('should test source code correctly', () => {
    expect(sayHi()).toBe('hi');
  });
});
