import { describe, expect, it } from '@rstest/core';
import { loadGreeting, sayHi } from './src/index';

describe('browser related index', () => {
  it('should greet index', async () => {
    expect(sayHi()).toBe('Hello, index!');
    expect((await loadGreeting('en')).greeting).toBe('Welcome');
  });
});
