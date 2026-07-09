import { describe, expect, it } from '@rstest/core';
import { getMessage } from '../src/helper';

describe('watch mode test', () => {
  it('should pass initial test', () => {
    expect('initial').toBe('initial');
  });

  it('should use helper', () => {
    expect(getMessage()).toBe('hello');
  });
});
