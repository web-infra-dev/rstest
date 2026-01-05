import { describe, expect, it } from '@rstest/core';

describe('Project A - Button Tests', () => {
  it('creates a button with correct text', () => {
    const button = document.createElement('button');
    button.textContent = 'Click Me A';
    document.body.appendChild(button);
    expect(button.textContent).toBe('Click Me A');
  });

  it('handles button click events', () => {
    const button = document.createElement('button');
    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });
    button.click();
    expect(clicked).toBe(true);
  });
});

describe('Project A - Input Tests', () => {
  it('creates an input with correct value', () => {
    const input = document.createElement('input');
    input.value = 'Hello from A';
    expect(input.value).toBe('Hello from A');
  });
});
