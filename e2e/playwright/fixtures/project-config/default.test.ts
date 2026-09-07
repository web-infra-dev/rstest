import { expect, test } from '@rstest/playwright';

test('does not inherit Playwright config from another project', ({
  playwright,
}) => {
  expect(playwright.contextOptions).toBeUndefined();
  console.log('RSTEST_PLAYWRIGHT_CONFIG_PROJECT_ISOLATED_OK');
});
