import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('uses global screenshot defaults and paths', async ({
  onTestFinished,
}) => {
  document.body.innerHTML =
    '<div id="pixel" style="width: 1px; height: 1px; border-right: 1px solid white; background: rgb(10, 20, 30)"></div>';
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

test('overrides project screenshot limits with a single assertion limit', async () => {
  const swatch = document.createElement('div');
  swatch.style.cssText = 'width: 2px; height: 1px; background: black';
  document.body.replaceChildren(swatch);
  const locator = page.elementLocator(swatch);
  await expect(locator).toMatchScreenshot('swatch');

  swatch.style.background = 'white';
  await expect(locator).toMatchScreenshot('swatch', { maxDiffPixels: 2 });
  await expect(locator).toMatchScreenshot('swatch', { maxDiffPixelRatio: 1 });
});
