import { describe, expect, it } from '@rstest/core';
import { sayHi } from './src/index';

describe('index', () => {
  it('should greet index', () => {
    expect(sayHi()).toBe('Hello, index!');
  });
});
