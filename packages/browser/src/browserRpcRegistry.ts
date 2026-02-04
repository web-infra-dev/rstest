export type BrowserApiStatus = 'supported' | 'planned';

export type BrowserApiRegistryEntry = {
  name: string;
  status: BrowserApiStatus;
  /** Implementation hints/caveats for maintainers (not user-facing docs). */
  notes?: string;
};

const supportedSet = (
  entries: readonly BrowserApiRegistryEntry[],
): Set<string> => {
  return new Set(
    entries.filter((e) => e.status === 'supported').map((e) => e.name),
  );
};

/**
 * Browser-side Playwright-style APIs that are proxied to the host via Browser RPC.
 *
 * This file is the single source of truth (roadmap/checklist) for:
 * - supported APIs (allowlist)
 * - planned APIs to be implemented later
 *
 * Capability gaps (non-exhaustive):
 * - Locator query/interop: filter({ hasNot, hasNotText }), locator.selector/length,
 *   locator.query()/element()/elements()/all(), page.elementLocator(element), locators.extend(...)
 * - Locator actions: tripleClick, hover out, drag/drop helpers
 * - Assertions: a11y matchers (accessible name/description), toHaveRole, toHaveValues
 * - Artifacts intentionally excluded for now: screenshot/toMatchScreenshot/trace/video
 */
export const browserRpcRegistry = {
  locatorActions: [
    { name: 'click', status: 'supported' },
    { name: 'dblclick', status: 'supported' },
    { name: 'fill', status: 'supported' },
    { name: 'hover', status: 'supported' },
    { name: 'press', status: 'supported' },
    { name: 'clear', status: 'supported' },
    { name: 'check', status: 'supported' },
    { name: 'uncheck', status: 'supported' },
    { name: 'focus', status: 'supported' },
    { name: 'blur', status: 'supported' },
    { name: 'scrollIntoViewIfNeeded', status: 'supported' },
    { name: 'waitFor', status: 'supported' },
    {
      name: 'dispatchEvent',
      status: 'supported',
      notes: 'eventInit must be JSON-serializable.',
    },
    {
      name: 'selectOption',
      status: 'supported',
      notes: 'P0: only string or string[] values are supported.',
    },
    {
      name: 'setInputFiles',
      status: 'supported',
      notes: 'P0: only file path string or string[] are supported.',
    },
  ],
  expectElementMatchers: [
    {
      name: 'toBeVisible',
      status: 'supported',
      notes: "Host: locator._expect('to.be.visible').",
    },
    {
      name: 'toBeHidden',
      status: 'supported',
      notes: "Host: locator._expect('to.be.hidden').",
    },
    {
      name: 'toBeEnabled',
      status: 'supported',
      notes: "Host: locator._expect('to.be.enabled').",
    },
    {
      name: 'toBeDisabled',
      status: 'supported',
      notes: "Host: locator._expect('to.be.disabled').",
    },
    {
      name: 'toBeAttached',
      status: 'supported',
      notes: "Host: locator._expect('to.be.attached').",
    },
    {
      name: 'toBeDetached',
      status: 'supported',
      notes: "Host: locator._expect('to.be.detached').",
    },
    {
      name: 'toBeEditable',
      status: 'supported',
      notes: "Host: locator._expect('to.be.editable').",
    },
    {
      name: 'toBeFocused',
      status: 'supported',
      notes: "Host: locator._expect('to.be.focused').",
    },
    {
      name: 'toBeEmpty',
      status: 'supported',
      notes: "Host: locator._expect('to.be.empty').",
    },
    {
      name: 'toBeInViewport',
      status: 'supported',
      notes: "Host: locator._expect('to.be.in.viewport').",
    },
    {
      name: 'toHaveText',
      status: 'supported',
      notes: "Host: locator._expect('to.have.text') + expectedText.",
    },
    {
      name: 'toContainText',
      status: 'supported',
      notes: "Host: locator._expect('to.have.text') + matchSubstring.",
    },
    {
      name: 'toHaveValue',
      status: 'supported',
      notes: "Host: locator._expect('to.have.value') + expectedText.",
    },
    {
      name: 'toHaveAttribute',
      status: 'supported',
      notes: "Host: locator._expect('to.have.attribute[.value]').",
    },
    {
      name: 'toHaveClass',
      status: 'supported',
      notes: "Host: locator._expect('to.have.class') + expectedText.",
    },
    {
      name: 'toHaveCount',
      status: 'supported',
      notes: "Host: locator._expect('to.have.count').",
    },

    // Planned (P0/P1 candidates)
    {
      name: 'toBeChecked',
      status: 'supported',
      notes: "Host: locator._expect('to.be.checked') + expectedValue.",
    },
    {
      name: 'toBeUnchecked',
      status: 'supported',
      notes: "Host: locator._expect('to.be.checked') + expectedValue.",
    },
    {
      name: 'toHaveId',
      status: 'supported',
      notes: "Host: locator._expect('to.have.id') + expectedText.",
    },
    {
      name: 'toHaveCSS',
      status: 'supported',
      notes: "Host: locator._expect('to.have.css') or 'to.have.css.object'.",
    },
    {
      name: 'toHaveJSProperty',
      status: 'supported',
      notes: "Host: locator._expect('to.have.property') + expectedValue.",
    },
  ],
} as const satisfies {
  locatorActions: readonly BrowserApiRegistryEntry[];
  expectElementMatchers: readonly BrowserApiRegistryEntry[];
};

export const supportedLocatorActions = supportedSet(
  browserRpcRegistry.locatorActions,
);
export const supportedExpectElementMatchers = supportedSet(
  browserRpcRegistry.expectElementMatchers,
);
