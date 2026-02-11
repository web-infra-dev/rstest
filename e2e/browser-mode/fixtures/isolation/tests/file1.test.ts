import { describe, expect, it } from '@rstest/core';

// This file mutates browser state.
// file2.test.ts should not observe these side effects.

describe('file1 isolation', () => {
  it('should set global variable', () => {
    (globalThis as Record<string, unknown>).__FILE1_VAR__ = 'file1';
    expect((globalThis as Record<string, unknown>).__FILE1_VAR__).toBe('file1');
  });

  it('should persist storage state', () => {
    localStorage.setItem('rstest-local', 'file1-local');
    sessionStorage.setItem('rstest-session', 'file1-session');

    expect(localStorage.getItem('rstest-local')).toBe('file1-local');
    expect(sessionStorage.getItem('rstest-session')).toBe('file1-session');
  });

  it('should persist cookie state', () => {
    document.cookie = 'rstest_cookie=file1; path=/';
    expect(document.cookie).toContain('rstest_cookie=file1');
  });

  it('should add element to DOM', () => {
    const div = document.createElement('div');
    div.id = 'file1-element';
    div.textContent = 'File 1 Element';
    document.body.appendChild(div);

    expect(document.getElementById('file1-element')).not.toBeNull();
  });
});
