import { describe, expect, it } from '@rstest/core';

describe('browser counter', () => {
  it('increments text content when clicked', () => {
    const button = document.createElement('button');
    button.id = 'counter';
    button.textContent = '0';

    button.addEventListener('click', () => {
      button.textContent = String(Number(button.textContent) + 1);
    });

    document.body.appendChild(button);

    button.click();

    expect(button.textContent).toBe('1');

    button.click();
    expect(button.textContent).toBe('2');
  });
});
