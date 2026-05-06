import { describe, expect, it } from '@rstest/core';
import { sayBye } from './src/other';

describe('browser related other', () => {
  it('should greet other', () => {
    expect(sayBye()).toBe('Hello, other!');
  });
});
