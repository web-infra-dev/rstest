import { describe, expect, it } from '@rstest/core';

describe('webkit browser', () => {
  it('should detect webkit user agent', () => {
    // WebKit browsers include "AppleWebKit" in user agent
    expect(navigator.userAgent).toMatch(/AppleWebKit/);
  });

  it('should run DOM tests in webkit', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello WebKit';
    document.body.appendChild(div);

    expect(div.textContent).toBe('Hello WebKit');
    expect(document.body.contains(div)).toBe(true);

    document.body.removeChild(div);
  });

  it('should handle async operations in webkit', async () => {
    const result = await Promise.resolve('webkit-async');
    expect(result).toBe('webkit-async');
  });
});
