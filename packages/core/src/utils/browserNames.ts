import type { BrowserName } from '../types';

// Dependency-free so both the host and the browser runtime entries can expose
// it. A `Record` keyed by the `BrowserName` union: tsc rejects a missing or
// extra name, so this set cannot drift from the type the config accepts.
const BROWSER_NAME_SET: Record<BrowserName, true> = {
  chromium: true,
  firefox: true,
  webkit: true,
};

export const BROWSER_NAMES: string[] = Object.keys(BROWSER_NAME_SET);

export const isBrowserName = (value: unknown): value is BrowserName =>
  typeof value === 'string' && BROWSER_NAMES.includes(value);
