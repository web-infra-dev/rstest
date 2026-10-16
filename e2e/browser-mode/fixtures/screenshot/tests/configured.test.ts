import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('uses global screenshot defaults and paths', async () => {
  document.body.innerHTML =
    '<div id="pixel" style="width: 1px; height: 1px; background: rgb(10, 20, 30)"></div>';
  await expect(page.locator('#pixel')).toMatchScreenshot('global-default');
}, 30_000);
