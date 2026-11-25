import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('uses global screenshot defaults and paths', async ({
  onTestFinished,
}) => {
  document.body.innerHTML =
    '<div id="pixel" style="width: 1px; height: 1px; background: rgb(10, 20, 30)"></div>';
  const pixel = document.querySelector<HTMLElement>('#pixel[data-animate]');
  if (pixel) {
    let frame = 0;
    let animation = 0;
    const paint = () => {
      pixel.style.backgroundColor = `rgb(180, ${frame++ % 256}, 20)`;
      animation = requestAnimationFrame(paint);
    };
    paint();
    onTestFinished(() => cancelAnimationFrame(animation));
  }
  await expect(page.locator('#pixel')).toMatchScreenshot('global-default');
}, 30_000);
