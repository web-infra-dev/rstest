import { describe, expect, it } from '@rstest/core';

describe('Project B - Div Tests', () => {
  it('creates a div with class', () => {
    const div = document.createElement('div');
    div.className = 'container-b';
    expect(div.className).toBe('container-b');
  });

  it('sets multiple classes', () => {
    const div = document.createElement('div');
    div.classList.add('class1', 'class2');
    expect(div.classList.contains('class1')).toBe(true);
    expect(div.classList.contains('class2')).toBe(true);
  });
});
