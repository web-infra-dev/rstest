import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

/**
 * Keeps a second test file ahead of the locator-based file so headed mode exercises
 * multi-file scheduling instead of the single-file happy path.
 */
test('headed concurrency smoke', async () => {
  const button = document.createElement('button');
  button.textContent = 'Frame action';
  button.onclick = () => {
    button.textContent = 'Frame clicked';
  };
  document.body.appendChild(button);
  await page.elementLocator(button).focus();
  await page.keyboard.press('Enter');
  await expect.element(button).toHaveText('Frame clicked');
  button.remove();
});
