import type { Locator } from './locator';

export type BrowserElementExpect = {
  not: BrowserElementExpect;
  toBeVisible: (options?: { timeout?: number }) => Promise<void>;
  toBeHidden: (options?: { timeout?: number }) => Promise<void>;
  toBeEnabled: (options?: { timeout?: number }) => Promise<void>;
  toBeDisabled: (options?: { timeout?: number }) => Promise<void>;
  toBeChecked: (options?: { timeout?: number }) => Promise<void>;
  toBeUnchecked: (options?: { timeout?: number }) => Promise<void>;
  toBeAttached: (options?: { timeout?: number }) => Promise<void>;
  toBeDetached: (options?: { timeout?: number }) => Promise<void>;
  toBeEditable: (options?: { timeout?: number }) => Promise<void>;
  toBeFocused: (options?: { timeout?: number }) => Promise<void>;
  toBeEmpty: (options?: { timeout?: number }) => Promise<void>;
  toBeInViewport: (options?: {
    timeout?: number;
    ratio?: number;
  }) => Promise<void>;
  toHaveText: (
    text: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toContainText: (
    text: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveValue: (
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveId: (
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveAttribute: (
    name: string,
    value?: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveClass: (
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveCount: (count: number, options?: { timeout?: number }) => Promise<void>;
  toHaveCSS: (
    name: string,
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveJSProperty: (
    name: string,
    value: unknown,
    options?: { timeout?: number },
  ) => Promise<void>;
};

export type ToMatchScreenshotOptions = {
  /** Per-pixel color distance threshold from 0 (strict) to 1 (loose). */
  threshold?: number;
  /** Maximum number of pixels allowed to differ. */
  maxDiffPixels?: number;
  /** Maximum fraction of pixels allowed to differ, from 0 to 1. */
  maxDiffPixelRatio?: number;
  /** Time allowed for consecutive screenshots to become stable. Defaults to 2000 ms; use 0 to disable or at least 100 ms. */
  stabilityTimeout?: number;
  /** Mask dynamic content with browser-mode Locators. */
  mask?: Locator[];
  maskColor?: string;
  /** Capture the full page instead of the viewport. Only supported by page assertions. */
  fullPage?: boolean;
  style?: string;
  caret?: 'hide' | 'initial';
  scale?: 'css' | 'device';
  omitBackground?: boolean;
};

declare module '@rstest/core' {
  interface Assertion<T> {
    toMatchScreenshot: (
      name?: string,
      options?: ToMatchScreenshotOptions,
    ) => Promise<void>;
  }

  interface ExpectStatic {
    element: (locator: Locator) => BrowserElementExpect;
  }
}
