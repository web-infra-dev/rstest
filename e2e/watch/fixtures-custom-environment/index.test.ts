import { describe, expect, it } from '@rstest/core';
import { value } from './src/index';

describe('watch custom environment', () => {
  it('runs with the custom environment', () => {
    expect(Reflect.get(globalThis, '__CUSTOM_ENV_MARKER__')).toBe('initial');
    expect(value).toBe('test');
  });
});
