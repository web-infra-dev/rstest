import type {
  BrowserLocatorFilterOptions,
  BrowserLocatorIR,
  BrowserLocatorText,
  BrowserRpcRequest,
} from '../rpcProtocol';
import { callBrowserRpc } from './browserRpc';
import { registerElementLocator } from './elementLocator';
import { keyboard, type BrowserKeyboard } from './keyboard';
import { viewport } from './viewport';

export const serializeText = (value: string | RegExp): BrowserLocatorText => {
  if (typeof value === 'string') {
    return { type: 'string', value };
  }
  return { type: 'regexp', source: value.source, flags: value.flags };
};

export type LocatorAriaRole =
  | 'alert'
  | 'alertdialog'
  | 'application'
  | 'article'
  | 'banner'
  | 'blockquote'
  | 'button'
  | 'caption'
  | 'cell'
  | 'checkbox'
  | 'code'
  | 'columnheader'
  | 'combobox'
  | 'complementary'
  | 'contentinfo'
  | 'definition'
  | 'deletion'
  | 'dialog'
  | 'directory'
  | 'document'
  | 'emphasis'
  | 'feed'
  | 'figure'
  | 'form'
  | 'generic'
  | 'grid'
  | 'gridcell'
  | 'group'
  | 'heading'
  | 'img'
  | 'insertion'
  | 'link'
  | 'list'
  | 'listbox'
  | 'listitem'
  | 'log'
  | 'main'
  | 'marquee'
  | 'math'
  | 'meter'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'menuitemcheckbox'
  | 'menuitemradio'
  | 'navigation'
  | 'none'
  | 'note'
  | 'option'
  | 'paragraph'
  | 'presentation'
  | 'progressbar'
  | 'radio'
  | 'radiogroup'
  | 'region'
  | 'row'
  | 'rowgroup'
  | 'rowheader'
  | 'scrollbar'
  | 'search'
  | 'searchbox'
  | 'separator'
  | 'slider'
  | 'spinbutton'
  | 'status'
  | 'strong'
  | 'subscript'
  | 'superscript'
  | 'switch'
  | 'tab'
  | 'table'
  | 'tablist'
  | 'tabpanel'
  | 'term'
  | 'textbox'
  | 'time'
  | 'timer'
  | 'toolbar'
  | 'tooltip'
  | 'tree'
  | 'treegrid'
  | 'treeitem';

export type LocatorGetByRoleOptions = {
  name?: string | RegExp;
  exact?: boolean;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean;
  includeHidden?: boolean;
  level?: number;
};

export type LocatorTextOptions = {
  exact?: boolean;
};

export type LocatorKeyboardModifier =
  'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift';

export type LocatorMouseButton = 'left' | 'right' | 'middle';

export type LocatorPosition = {
  x: number;
  y: number;
};

export type LocatorClickOptions = {
  button?: LocatorMouseButton;
  clickCount?: number;
  delay?: number;
  force?: boolean;
  modifiers?: LocatorKeyboardModifier[];
  position?: LocatorPosition;
  timeout?: number;
  trial?: boolean;
};

export type LocatorDblclickOptions = Omit<LocatorClickOptions, 'clickCount'>;

export type LocatorHoverOptions = Pick<
  LocatorClickOptions,
  'force' | 'modifiers' | 'position' | 'timeout' | 'trial'
>;

export type LocatorDragToOptions = {
  force?: boolean;
  sourcePosition?: LocatorPosition;
  targetPosition?: LocatorPosition;
  timeout?: number;
  trial?: boolean;
};

export type LocatorPressOptions = {
  delay?: number;
  timeout?: number;
};

export type LocatorFillOptions = {
  force?: boolean;
  timeout?: number;
};

export type LocatorClearOptions = {
  force?: boolean;
  timeout?: number;
};

export type LocatorCheckOptions = {
  force?: boolean;
  position?: LocatorPosition;
  timeout?: number;
  trial?: boolean;
};

export type LocatorFocusOptions = {
  timeout?: number;
};

export type LocatorBlurOptions = {
  timeout?: number;
};

export type LocatorScrollIntoViewIfNeededOptions = {
  timeout?: number;
};

export type LocatorWaitForOptions = {
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  timeout?: number;
};

export type BrowserSerializable =
  | null
  | boolean
  | number
  | string
  | BrowserSerializable[]
  | { [key: string]: BrowserSerializable };

export type LocatorDispatchEventInit = BrowserSerializable;

export type LocatorDispatchEventOptions = {
  timeout?: number;
};

export type LocatorSelectOptionItem =
  | string
  | {
      value?: string;
      label?: string;
      index?: number;
    };

export type LocatorSelectOptionValue =
  null | LocatorSelectOptionItem | readonly LocatorSelectOptionItem[];

export type LocatorSelectOptionOptions = {
  force?: boolean;
  timeout?: number;
};

export type LocatorSetInputFilesOptions = {
  timeout?: number;
};

export type LocatorFilterOptions = {
  hasText?: string | RegExp;
  hasNotText?: string | RegExp;
  has?: Locator;
  hasNot?: Locator;
  visible?: boolean;
};

export type LocatorOptions = Omit<LocatorFilterOptions, 'visible'>;

const requireFilterLocator = (
  value: Locator | undefined,
  optionName: 'has' | 'hasNot',
  methodName: string,
): BrowserLocatorIR | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isLocator(value)) {
    throw new TypeError(
      `${methodName}({ ${optionName} }) expects a Locator returned from @rstest/browser page.getBy* APIs.`,
    );
  }
  return value.ir;
};

const serializeFilterOptions = (
  options: LocatorOptions,
  methodName: string,
): BrowserLocatorFilterOptions => {
  return {
    hasText:
      options.hasText === undefined
        ? undefined
        : serializeText(options.hasText),
    hasNotText:
      options.hasNotText === undefined
        ? undefined
        : serializeText(options.hasNotText),
    has: requireFilterLocator(options.has, 'has', methodName),
    hasNot: requireFilterLocator(options.hasNot, 'hasNot', methodName),
  };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isSelectOptionItem = (
  value: unknown,
): value is LocatorSelectOptionItem => {
  if (typeof value === 'string') {
    return true;
  }
  if (!isPlainObject(value)) {
    return false;
  }
  const { value: optionValue, label, index } = value;
  const hasOptionField =
    optionValue !== undefined || label !== undefined || index !== undefined;
  if (!hasOptionField) {
    return false;
  }
  if (optionValue !== undefined && typeof optionValue !== 'string') {
    return false;
  }
  if (label !== undefined && typeof label !== 'string') {
    return false;
  }
  if (index !== undefined && typeof index !== 'number') {
    return false;
  }
  return Object.keys(value).every(
    (key) => key === 'value' || key === 'label' || key === 'index',
  );
};

export class Locator {
  readonly ir: BrowserLocatorIR;

  constructor(ir: BrowserLocatorIR) {
    this.ir = ir;
  }

  getByRole(
    role: LocatorAriaRole | (string & {}),
    options?: LocatorGetByRoleOptions,
  ): Locator {
    const next = {
      steps: [
        ...this.ir.steps,
        {
          type: 'getByRole',
          role,
          options: options
            ? {
                ...options,
                name:
                  options.name === undefined
                    ? undefined
                    : serializeText(options.name),
              }
            : undefined,
        },
      ],
    } satisfies BrowserLocatorIR;
    return new Locator(next);
  }

  locator(selector: string, options?: LocatorOptions): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        options === undefined
          ? { type: 'locator', selector }
          : {
              type: 'locator',
              selector,
              options: serializeFilterOptions(options, 'Locator.locator'),
            },
      ],
    });
  }

  getByText(text: string | RegExp, options?: LocatorTextOptions): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        { type: 'getByText', text: serializeText(text), options },
      ],
    });
  }

  getByLabel(text: string | RegExp, options?: LocatorTextOptions): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        { type: 'getByLabel', text: serializeText(text), options },
      ],
    });
  }

  getByPlaceholder(
    text: string | RegExp,
    options?: LocatorTextOptions,
  ): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        { type: 'getByPlaceholder', text: serializeText(text), options },
      ],
    });
  }

  getByAltText(text: string | RegExp, options?: LocatorTextOptions): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        { type: 'getByAltText', text: serializeText(text), options },
      ],
    });
  }

  getByTitle(text: string | RegExp, options?: LocatorTextOptions): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        { type: 'getByTitle', text: serializeText(text), options },
      ],
    });
  }

  getByTestId(text: string | RegExp): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        { type: 'getByTestId', text: serializeText(text) },
      ],
    });
  }

  filter(options: LocatorFilterOptions): Locator {
    return new Locator({
      steps: [
        ...this.ir.steps,
        {
          type: 'filter',
          options: {
            ...serializeFilterOptions(options, 'Locator.filter'),
            ...(options.visible === undefined
              ? {}
              : { visible: options.visible }),
          },
        },
      ],
    });
  }

  and(other: Locator): Locator {
    if (!isLocator(other)) {
      throw new TypeError(
        'Locator.and() expects a Locator returned from @rstest/browser page.getBy* APIs.',
      );
    }
    return new Locator({
      steps: [...this.ir.steps, { type: 'and', locator: other.ir }],
    });
  }

  or(other: Locator): Locator {
    if (!isLocator(other)) {
      throw new TypeError(
        'Locator.or() expects a Locator returned from @rstest/browser page.getBy* APIs.',
      );
    }
    return new Locator({
      steps: [...this.ir.steps, { type: 'or', locator: other.ir }],
    });
  }

  nth(index: number): Locator {
    return new Locator({ steps: [...this.ir.steps, { type: 'nth', index }] });
  }

  first(): Locator {
    return new Locator({ steps: [...this.ir.steps, { type: 'first' }] });
  }

  last(): Locator {
    return new Locator({ steps: [...this.ir.steps, { type: 'last' }] });
  }

  count(): Promise<number> {
    return this.callLocator<number>('count', []);
  }

  async all(): Promise<Locator[]> {
    const count = await this.count();
    return Array.from({ length: count }, (_, index) => this.nth(index));
  }

  async click(options?: LocatorClickOptions): Promise<void> {
    await this.callLocator('click', options === undefined ? [] : [options]);
  }

  async dblclick(options?: LocatorDblclickOptions): Promise<void> {
    await this.callLocator('dblclick', options === undefined ? [] : [options]);
  }

  async dragTo(target: Locator, options?: LocatorDragToOptions): Promise<void> {
    if (!isLocator(target)) {
      throw new TypeError(
        'Locator.dragTo() expects a target Locator returned from @rstest/browser page.getBy* APIs.',
      );
    }
    await this.callLocator(
      'dragTo',
      options === undefined ? [target.ir] : [target.ir, options],
    );
  }

  async fill(value: string, options?: LocatorFillOptions): Promise<void> {
    await this.callLocator(
      'fill',
      options === undefined ? [value] : [value, options],
    );
  }

  async hover(options?: LocatorHoverOptions): Promise<void> {
    await this.callLocator('hover', options === undefined ? [] : [options]);
  }

  async press(key: string, options?: LocatorPressOptions): Promise<void> {
    await this.callLocator(
      'press',
      options === undefined ? [key] : [key, options],
    );
  }

  async pressSequentially(
    text: string,
    options?: LocatorPressOptions,
  ): Promise<void> {
    await this.callLocator(
      'pressSequentially',
      options === undefined ? [text] : [text, options],
    );
  }

  async clear(options?: LocatorClearOptions): Promise<void> {
    await this.callLocator('clear', options === undefined ? [] : [options]);
  }

  async check(options?: LocatorCheckOptions): Promise<void> {
    await this.callLocator('check', options === undefined ? [] : [options]);
  }

  async uncheck(options?: LocatorCheckOptions): Promise<void> {
    await this.callLocator('uncheck', options === undefined ? [] : [options]);
  }

  async focus(options?: LocatorFocusOptions): Promise<void> {
    await this.callLocator('focus', options === undefined ? [] : [options]);
  }

  async blur(options?: LocatorBlurOptions): Promise<void> {
    await this.callLocator('blur', options === undefined ? [] : [options]);
  }

  async scrollIntoViewIfNeeded(
    options?: LocatorScrollIntoViewIfNeededOptions,
  ): Promise<void> {
    await this.callLocator(
      'scrollIntoViewIfNeeded',
      options === undefined ? [] : [options],
    );
  }

  async waitFor(options?: LocatorWaitForOptions): Promise<void> {
    await this.callLocator('waitFor', options === undefined ? [] : [options]);
  }

  async dispatchEvent(
    type: string,
    eventInit?: LocatorDispatchEventInit,
    options?: LocatorDispatchEventOptions,
  ): Promise<void> {
    if (typeof type !== 'string' || !type) {
      throw new TypeError(
        'Locator.dispatchEvent() expects a non-empty event type string.',
      );
    }
    const args: unknown[] = [type];
    if (options !== undefined) {
      args.push(eventInit, options);
    } else if (eventInit !== undefined) {
      args.push(eventInit);
    }
    await this.callLocator('dispatchEvent', args);
  }

  async selectOption(
    values: LocatorSelectOptionValue,
    options?: LocatorSelectOptionOptions,
  ): Promise<string[]> {
    const isValid =
      values === null ||
      isSelectOptionItem(values) ||
      (Array.isArray(values) && values.every(isSelectOptionItem));
    if (!isValid) {
      throw new TypeError(
        'Locator.selectOption() expects null, a string, { value?, label?, index? }, or an array of those values in browser mode.',
      );
    }
    return await this.callLocator<string[]>(
      'selectOption',
      options === undefined ? [values] : [values, options],
    );
  }

  async setInputFiles(
    files: string | string[],
    options?: LocatorSetInputFilesOptions,
  ): Promise<void> {
    if (
      typeof files !== 'string' &&
      !(Array.isArray(files) && files.every((v) => typeof v === 'string'))
    ) {
      throw new TypeError(
        'Locator.setInputFiles() only supports file path string or string[] in browser mode.',
      );
    }
    await this.callLocator(
      'setInputFiles',
      options === undefined ? [files] : [files, options],
    );
  }

  private callLocator<T = void>(method: string, args: unknown[]): Promise<T> {
    return callBrowserRpc<T>({
      kind: 'locator',
      locator: this.ir,
      method,
      args,
    } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath' | 'projectName'>);
  }
}

const browserPageQueryMethods = [
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
] as const;

type BrowserPageQueryMethod = (typeof browserPageQueryMethods)[number];

export type BrowserPage = Pick<Locator, BrowserPageQueryMethod> & {
  elementLocator: (element: Element) => Locator;
  keyboard: BrowserKeyboard;
  /** Resize the layout viewport for the current test attempt. */
  viewport: (width: number, height: number) => Promise<void>;
};

const rootLocator = new Locator({ steps: [] });

const createBrowserPage = (): BrowserPage => {
  const queries = Object.fromEntries(
    browserPageQueryMethods.map((methodName) => {
      return [methodName, rootLocator[methodName].bind(rootLocator)];
    }),
  ) as Pick<Locator, BrowserPageQueryMethod>;
  return {
    ...queries,
    keyboard,
    viewport,
    elementLocator: (element) =>
      new Locator({
        steps: [{ type: 'element', id: registerElementLocator(element) }],
      }),
  };
};

export const page: BrowserPage = createBrowserPage();

export const isBrowserPage = (value: unknown): value is BrowserPage =>
  value === page;

export const isLocator = (value: unknown): value is Locator => {
  return value instanceof Locator;
};

/**
 * Configure the attribute used by `getByTestId()` queries.
 * Forwards to the host provider (e.g. Playwright `selectors.setTestIdAttribute()`).
 *
 * @default 'data-testid'
 */
export const setTestIdAttribute = async (attribute: string): Promise<void> => {
  await callBrowserRpc<void>({
    kind: 'config',
    locator: { steps: [] },
    method: 'setTestIdAttribute',
    args: [attribute],
  } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath' | 'projectName'>);
};
