import type { Locator } from './client/locator';

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

declare module '@rstest/core' {
  interface ExpectStatic {
    element: (locator: Locator) => BrowserElementExpect;
  }
}
