import { page } from '@rstest/browser';
import { expect, it } from '@rstest/core';

it('screenshot reference', async () => {
  document.body.innerHTML =
    '<button style="background: rgb(20, 80, 180); color: white">Save</button>';
  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot(
    'watch-snapshot',
  );
}, 30_000);
