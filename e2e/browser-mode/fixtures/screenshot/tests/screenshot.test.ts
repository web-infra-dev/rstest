import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('matches a locator screenshot', async () => {
  document.body.innerHTML = `
    <div id="capture">
      <button style="background: rgb(20, 80, 180); color: white; padding: 12px 24px; border: 0">Save</button>
      <span id="dynamic">dynamic content</span>
    </div>
  `;

  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot(
    'primary-button',
    { threshold: 0.1, maxDiffPixels: 0, stabilityTimeout: 500 },
  );
  await expect(page.locator('#capture')).toMatchScreenshot('masked-capture', {
    mask: [page.locator('#dynamic')],
  });
});
