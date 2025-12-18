import { describe, expect, it } from '@rstest/core';

describe('browser snapshot', () => {
  it('should match object snapshot', () => {
    const user = {
      name: 'Alice',
      age: 30,
      email: 'alice@example.com',
    };
    expect(user).toMatchSnapshot();
  });

  it('should match string snapshot', () => {
    const greeting = 'Hello, Browser World!';
    expect(greeting).toMatchSnapshot();
  });

  it('should match DOM element snapshot', () => {
    const div = document.createElement('div');
    div.className = 'container';
    div.innerHTML = '<span>Test Content</span>';
    expect(div.outerHTML).toMatchSnapshot();
  });
});
