import { describe, expect, it } from '@rstest/core';

// This file modifies global state and DOM
// file2.test.ts should not be affected

describe('file1 isolation', () => {
  it('should set global variable', () => {
    (globalThis as Record<string, unknown>).__FILE1_VAR__ = 'file1';
    expect((globalThis as Record<string, unknown>).__FILE1_VAR__).toBe('file1');
  });

  it('should add element to DOM', () => {
    const div = document.createElement('div');
    div.id = 'file1-element';
    div.textContent = 'File 1 Element';
    document.body.appendChild(div);

    expect(document.getElementById('file1-element')).not.toBeNull();
  });
});
