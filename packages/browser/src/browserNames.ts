import type { BrowserName } from '@rstest/core/internal/browser';

// A `Record` keyed by the `BrowserName` union: tsc rejects a missing or extra
// name, so this set cannot drift from the type core's config accepts.
const BROWSER_NAME_SET: Record<BrowserName, true> = {
  chromium: true,
  firefox: true,
  webkit: true,
};

export const BROWSER_NAMES: string[] = Object.keys(BROWSER_NAME_SET);

export const isBrowserName = (value: unknown): value is BrowserName =>
  typeof value === 'string' && BROWSER_NAMES.includes(value);
