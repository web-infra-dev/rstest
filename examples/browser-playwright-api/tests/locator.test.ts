import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

function createCounter(initial = 0) {
  let count = initial;

  const container = document.createElement('div');
  const display = document.createElement('p');
  const incBtn = document.createElement('button');

  display.textContent = `Count: ${count}`;
  incBtn.textContent = 'Increment';
  incBtn.id = 'inc-btn';

  incBtn.addEventListener('click', () => {
    count++;
    display.textContent = `Count: ${count}`;
  });

  container.append(display, incBtn);
  return container;
}

test('page.getBy* + expect.element works', async () => {
  document.body.appendChild(createCounter(5));

  const input = document.createElement('input');
  input.placeholder = 'Name';
  input.value = 'Alice';
  document.body.appendChild(input);

  await expect.element(page.getByText('Count: 5')).toHaveText('Count: 5');

  document.getElementById('inc-btn')?.click();
  await expect.element(page.getByText('Count: 6')).toHaveText('Count: 6');

  await expect.element(page.getByText(/Count: 6/)).toContainText('Count');
  await expect.element(page.getByPlaceholder('Name')).toHaveValue(/Alice/);
});
