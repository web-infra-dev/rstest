// @rstest-environment jsdom
import { describe, expect, it } from '@rstest/core';
import { value } from './src/index';

describe('watch environment pragma', () => {
  it('runs in jsdom', () => {
    expect(value).toBe('initial');
    expect(document.createElement('div')).toBeDefined();
  });
});
