import { callBrowserRpc } from './browserRpc';

export type BrowserKeyboardPressOptions = {
  /** Time in milliseconds between keydown and keyup. @default 0 */
  delay?: number;
};

export type BrowserKeyboardTabOptions = {
  /** Move focus backwards with Shift+Tab. @default false */
  shift?: boolean;
};

export type BrowserKeyboard = {
  press: (key: string, options?: BrowserKeyboardPressOptions) => Promise<void>;
  tab: (options?: BrowserKeyboardTabOptions) => Promise<void>;
};

export const keyboard: BrowserKeyboard = {
  async press(key, options) {
    await callBrowserRpc<void>({
      kind: 'keyboard',
      locator: { steps: [] },
      method: 'press',
      args: options === undefined ? [key] : [key, options],
    });
  },
  async tab(options) {
    await keyboard.press(options?.shift ? 'Shift+Tab' : 'Tab');
  },
};
