/**
 * Runtime allowlists for Browser RPC methods.
 *
 * Planned capabilities are intentionally documented in comments (not runtime
 * data) to keep this module focused on host-side validation.
 *
 * Planned gaps (non-exhaustive):
 * - Locator query/interop: filter({ hasNot, hasNotText }), locator.selector/length,
 *   locator.query()/element()/elements()/all(), page.elementLocator(element),
 *   locators.extend(...)
 * - Locator actions: tripleClick, hover out, drag/drop helpers
 * - Assertions: a11y matchers (accessible name/description), toHaveRole,
 *   toHaveValues
 * - Artifacts intentionally excluded for now: screenshot/toMatchScreenshot/
 *   trace/video
 */
export const supportedLocatorActions = new Set<string>([
  'click',
  'dblclick',
  'fill',
  'hover',
  'press',
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

export const supportedExpectElementMatchers = new Set<string>([
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
  'toContainText',
  'toHaveValue',
  'toHaveAttribute',
  'toHaveClass',
  'toHaveCount',
  'toBeChecked',
  'toBeUnchecked',
  'toHaveId',
  'toHaveCSS',
  'toHaveJSProperty',
]);
