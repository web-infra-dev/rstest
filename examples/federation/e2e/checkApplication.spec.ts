import { expect, test } from '@playwright/test';

// Hardcoded expectations for this example app. This avoids relying on shared
// fixtures that may not exist when running the example standalone.
const APP_TEXT = {
  header: 'Open Dev Tool And Focus On Network,checkout resources details',
  paragraphs: {
    firstStrong: 'main-app',
    secondStrong: 'component-app',
  },
  h4: {
    buttons: 'Buttons:',
    dialog: 'Dialog:',
    hoverTitle: 'hover me please!',
  },
  tooltip: {
    content: 'hover me please',
  },
  buttons: {
    primaryButton: 'primary Button',
    warningButton: 'warning Button',
    openDialogButton: 'click me to open Dialog',
    closeButton: 'close It!',
  },
  dialog: {
    nameMessage: 'What is your name ?',
    inputValue: 'rstest',
  },
} as const;

const COLORS = {
  primaryButtonBg: 'rgb(64, 158, 255)', // #409eff
  warningButtonBg: 'rgb(230, 162, 60)', // #e6a23c
} as const;

test.describe('Complete React case', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Check App build and running', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText(APP_TEXT.header);
    await expect(page.locator('strong').nth(0)).toHaveText(
      APP_TEXT.paragraphs.firstStrong,
    );
    await expect(page.locator('strong').nth(1)).toHaveText(
      APP_TEXT.paragraphs.secondStrong,
    );
    await expect(
      page.locator('h4').filter({ hasText: APP_TEXT.h4.buttons }),
    ).toBeVisible();
    await expect(
      page.locator('h4').filter({ hasText: APP_TEXT.h4.dialog }),
    ).toBeVisible();
    await expect(
      page.locator('h4').filter({ hasText: APP_TEXT.h4.hoverTitle }),
    ).toBeVisible();
    await expect(page.locator('.tool-tip')).toHaveText(
      APP_TEXT.tooltip.content,
    );
  });

  test('Check App buttons', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: APP_TEXT.buttons.primaryButton }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: APP_TEXT.buttons.warningButton }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: APP_TEXT.buttons.openDialogButton }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: APP_TEXT.buttons.primaryButton }),
    ).toHaveCSS('background-color', COLORS.primaryButtonBg);
    await expect(
      page.getByRole('button', { name: APP_TEXT.buttons.warningButton }),
    ).toHaveCSS('background-color', COLORS.warningButtonBg);
  });

  test('Check App Dialog popup', async ({ page }) => {
    await page
      .getByRole('button', { name: APP_TEXT.buttons.openDialogButton })
      .click();
    await expect(
      page.getByRole('button', { name: APP_TEXT.buttons.closeButton }),
    ).toBeVisible();
    await expect(page.getByText(APP_TEXT.dialog.nameMessage)).toBeVisible();
    await page.fill('input', APP_TEXT.dialog.inputValue);
    await page
      .getByRole('button', { name: APP_TEXT.buttons.closeButton })
      .click();
  });
});
