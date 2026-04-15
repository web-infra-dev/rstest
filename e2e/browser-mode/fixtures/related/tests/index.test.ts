import { describe, expect, it } from '@rstest/core';
import { sayHi } from './src/index';

describe('browser related index', () => {
  it('should greet index', () => {
    expect(sayHi()).toBe('Hello, index!');
  });
});
