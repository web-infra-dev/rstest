import { describe, expect, it } from '@rstest/core';
import { value } from './dom1';

const sleep = (ms: number) =>
  new Promise((res) => globalThis.setTimeout(res, ms));

describe('browser counter', () => {
  it('increments text content when clicked', async () => {
    const title = document.createElement('h1');
    title.textContent = 'DOM 1';
    document.body.appendChild(title);

    const button = document.createElement('button');
    button.id = 'counter';
    button.textContent = `${value}`;

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

describe('DOM element creation', () => {
  it('creates paragraph with correct text', () => {
    const p = document.createElement('p');
    p.textContent = 'Hello World';
    expect(p.textContent).toBe('Hello World');
  });

  it('sets element attributes correctly', () => {
    const div = document.createElement('div');
    div.setAttribute('data-test', 'example');
    expect(div.getAttribute('data-test')).toBe('example');
  });
});
