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

  it('should match inline snapshot', () => {
    expect('hello browser').toMatchInlineSnapshot(`"hello browser"`);
  });

  it('should match object inline snapshot', () => {
    expect({ foo: 'bar', count: 42 }).toMatchInlineSnapshot(`
      {
        "count": 42,
        "foo": "bar",
      }
    `);
  });

  it('should throw error matching inline snapshot', () => {
    const throwError = () => {
      throw new Error('browser error');
    };
    expect(throwError).toThrowErrorMatchingInlineSnapshot(
      '[Error: browser error]',
    );
  });
});
