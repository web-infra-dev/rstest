import { beforeEach, describe, expect, test } from '@rstest/core';
import { value } from './dom3';

const sleep = (ms: number) =>
  new Promise((res) => globalThis.setTimeout(res, ms));

describe('browser counter', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <span id="count">${value}</span>
        <button id="button">button</button>
      </div>
    `;
  });

  test('increments text content when clicked', async () => {
    const title = document.createElement('h1');
    title.textContent = 'DOM 3 - Modified';
    document.body.appendChild(title);

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

    await sleep(500);
    button.click();
    expect(button.textContent).toBe('3');
  });
});
