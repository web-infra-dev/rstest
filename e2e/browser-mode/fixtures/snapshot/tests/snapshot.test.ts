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

  it('should match array snapshot', () => {
    const items = ['apple', 'banana', 'cherry'];
    expect(items).toMatchSnapshot();
  });

  it('should match nested object snapshot', () => {
    const data = {
      users: [
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' },
      ],
      meta: {
        total: 2,
        page: 1,
      },
    };
    expect(data).toMatchSnapshot();
  });
});
