import { describe, expect, it } from '@rstest/core';
import { sayHi } from './src/index';

describe('node project', () => {
  it('should run node related tests without loading browser mode', () => {
    expect(sayHi()).toBe('Hello, node!');
  });
});
