import { expect, test } from '@rstest/playwright';

test('uses project Playwright config in another file', ({ playwright }) => {
  expect(playwright.contextOptions?.viewport).toEqual({
    width: 777,
    height: 555,
  });
  console.log('RSTEST_PLAYWRIGHT_CONFIG_SECOND_FILE_OK');
});
