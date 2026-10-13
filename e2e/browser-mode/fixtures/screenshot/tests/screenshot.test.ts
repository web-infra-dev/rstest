import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('matches a locator screenshot', async () => {
  document.body.innerHTML = `
    <button style="background: rgb(20, 80, 180); color: white; padding: 12px 24px; border: 0">
      Save
    </button>
  `;

  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot(
    'primary-button',
  );
});
