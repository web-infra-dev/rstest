import { describe, expect, it } from '@rstest/core';

// This file checks that it's isolated from file1.test.ts

describe('file2 isolation', () => {
  it('should not see global variable from file1', () => {
    // file1 sets __FILE1_VAR__, but it should not exist here.
    expect(
      (globalThis as Record<string, unknown>).__FILE1_VAR__,
    ).toBeUndefined();
  });

  it('should not see local/session storage from file1', () => {
    expect(localStorage.getItem('rstest-local')).toBeNull();
    expect(sessionStorage.getItem('rstest-session')).toBeNull();
  });

  it('should not see cookies from file1', () => {
    expect(document.cookie).not.toContain('rstest_cookie=file1');
  });

  it('should not see DOM element from file1', () => {
    // file1 adds #file1-element, but it should not exist here.
    expect(document.getElementById('file1-element')).toBeNull();
  });

  it('should have clean DOM', () => {
    // Body should be empty or only contain elements added by this test
    const children = document.body.children;
    expect(children.length).toBe(1);
    expect(children[0]).toBeInstanceOf(HTMLDivElement);
    expect(children[0]!.id).toBe('root');
    expect(children[0]!.children.length).toBe(0);
  });
});
