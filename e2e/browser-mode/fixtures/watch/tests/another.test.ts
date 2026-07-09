import { describe, expect, it } from '@rstest/core';
import { getMessage } from '../src/helper';

describe('another test', () => {
  it('should also use helper', () => {
    expect(getMessage()).toBe('hello');
  });
});
