import type {
  BrowserLocatorIR,
  BrowserLocatorText,
  BrowserRpcRequest,
} from '../rpcProtocol';
import { callBrowserRpc } from './browserRpc';

export const serializeText = (value: string | RegExp): BrowserLocatorText => {
  if (typeof value === 'string') {
    return { type: 'string', value };
  }
  return { type: 'regexp', source: value.source, flags: value.flags };
};

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
  | 'Alt'
  | 'Control'
  | 'ControlOrMeta'
  | 'Meta'
  | 'Shift';

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

export type LocatorPressOptions = {
  delay?: number;
  timeout?: number;
};

export type LocatorFillOptions = {
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

export type LocatorSelectOptionOptions = {
  force?: boolean;
  timeout?: number;
};

export type LocatorSetInputFilesOptions = {
  timeout?: number;
};

export type LocatorFilterOptions = {
  hasText?: string | RegExp;
  has?: Locator;
};

export class Locator {
  readonly ir: BrowserLocatorIR;

  constructor(ir: BrowserLocatorIR) {
    this.ir = ir;
  }

  getByRole(role: string, options?: LocatorGetByRoleOptions): Locator {
    const next = {
      steps: [
        ...this.ir.steps,
        {
          type: 'getByRole',
          role,
          options: options
            ? {
                ...options,
                name: options.name ? serializeText(options.name) : undefined,
              }
            : undefined,
        },
      ],
    } satisfies BrowserLocatorIR;
    return new Locator(next);
  }

  locator(selector: string): Locator {
    return new Locator({
      steps: [...this.ir.steps, { type: 'locator', selector }],
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
            hasText: options.hasText
              ? serializeText(options.hasText)
              : undefined,
            has:
              options.has === undefined
                ? undefined
                : isLocator(options.has)
                  ? options.has.ir
                  : (() => {
                      throw new TypeError(
                        'Locator.filter({ has }) expects a Locator returned from @rstest/browser page.getBy* APIs.',
                      );
                    })(),
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

  async click(options?: LocatorClickOptions): Promise<void> {
    await this.callLocator('click', options === undefined ? [] : [options]);
  }

  async dblclick(options?: LocatorDblclickOptions): Promise<void> {
    await this.callLocator('dblclick', options === undefined ? [] : [options]);
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

  async clear(): Promise<void> {
    await this.callLocator('clear', []);
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
  ): Promise<void> {
    if (typeof type !== 'string' || !type) {
      throw new TypeError(
        'Locator.dispatchEvent() expects a non-empty event type string.',
      );
    }
    await this.callLocator(
      'dispatchEvent',
      eventInit === undefined ? [type] : [type, eventInit],
    );
  }

  async selectOption(
    value: string | string[],
    options?: LocatorSelectOptionOptions,
  ): Promise<void> {
    if (
      typeof value !== 'string' &&
      !(Array.isArray(value) && value.every((v) => typeof v === 'string'))
    ) {
      throw new TypeError(
        'Locator.selectOption() only supports string or string[] values in browser mode.',
      );
    }
    await this.callLocator(
      'selectOption',
      options === undefined ? [value] : [value, options],
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

  private async callLocator(method: string, args: unknown[]): Promise<void> {
    await callBrowserRpc<void>({
      kind: 'locator',
      locator: this.ir,
      method,
      args,
    } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath' | 'runId'>);
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

export type BrowserPage = Pick<Locator, BrowserPageQueryMethod>;

const rootLocator = new Locator({ steps: [] });

const createBrowserPage = (): BrowserPage => {
  return Object.fromEntries(
    browserPageQueryMethods.map((methodName) => {
      return [methodName, rootLocator[methodName].bind(rootLocator)];
    }),
  ) as BrowserPage;
};

export const page: BrowserPage = createBrowserPage();

export const isLocator = (value: unknown): value is Locator => {
  return value instanceof Locator;
};
