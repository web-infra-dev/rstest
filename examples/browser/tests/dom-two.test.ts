import { describe, expect, it } from '@rstest/core';

const sleep = (ms: number) =>
  new Promise((res) => globalThis.setTimeout(res, ms));

describe('second suite DOM', () => {
  it('renders independent counter', async () => {
    const div = document.createElement('div');
    div.textContent = 'hello';
    document.body.appendChild(div);
    await sleep(2000);
    expect(document.body.textContent).toContain('hello');
  });
});
