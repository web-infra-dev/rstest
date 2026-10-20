/**
 * Runtime allowlists for Browser RPC methods.
 *
 * Planned capabilities are intentionally documented in comments (not runtime
 * data) to keep this module focused on host-side validation.
 *
 * Planned gaps (non-exhaustive):
 * - Locator query/interop: locator.selector/length, locator.query()/element()/elements()/all(),
 *   page.elementLocator(element),
 *   locators.extend(...)
 * - Locator actions: tripleClick, hover out, other drag/drop helpers
 * - Artifacts intentionally excluded for now: trace/video
 */
export const supportedScreenshotMatchers: Set<string> = new Set([
  'toMatchScreenshot',
]);

export const supportedLocatorActions: Set<string> = new Set([
  'click',
  'dblclick',
  'dragTo',
  'fill',
  'hover',
  'press',
  'pressSequentially',
  'clear',
  'check',
  'uncheck',
  'focus',
  'blur',
  'scrollIntoViewIfNeeded',
  'waitFor',
  'dispatchEvent',
  'selectOption',
  'setInputFiles',
]);

export const supportedExpectElementMatchers: Set<string> = new Set([
  'toBeVisible',
  'toBeHidden',
  'toBeEnabled',
  'toBeDisabled',
  'toBeAttached',
  'toBeDetached',
  'toBeEditable',
  'toBeFocused',
  'toBeEmpty',
  'toBeInViewport',
  'toHaveText',
  'toHaveRole',
  'toHaveAccessibleName',
  'toHaveAccessibleDescription',
  'toContainText',
  'toHaveValue',
  'toHaveValues',
  'toHaveAttribute',
  'toHaveClass',
  'toHaveCount',
  'toBeChecked',
  'toBeUnchecked',
  'toHaveId',
  'toHaveCSS',
  'toHaveJSProperty',
]);
