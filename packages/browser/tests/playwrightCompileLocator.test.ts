import { describe, expect, it } from '@rstest/core';
import type { BrowserLocatorIR } from '../src/protocol';
import { compilePlaywrightLocator } from '../src/providers/playwright/compileLocator';

class FakeLocator {
  readonly ops: Array<{ name: string; args: any[] }>;

  constructor(ops: Array<{ name: string; args: any[] }> = []) {
    this.ops = ops;
  }

  private next(name: string, ...args: any[]): FakeLocator {
    return new FakeLocator([...this.ops, { name, args }]);
  }

  locator(selector: string): FakeLocator {
    return this.next('locator', selector);
  }

  getByText(text: any, options?: any): FakeLocator {
    return this.next('getByText', text, options);
  }

  filter(options: any): FakeLocator {
    return this.next('filter', options);
  }

  and(other: any): FakeLocator {
    return this.next('and', other);
  }

  or(other: any): FakeLocator {
    return this.next('or', other);
  }

  nth(index: number): FakeLocator {
    return this.next('nth', index);
  }

  first(): FakeLocator {
    return this.next('first');
  }

  last(): FakeLocator {
    return this.next('last');
  }

  // Methods below are unused by these tests but required by compiler switch.
  getByRole(...args: any[]): FakeLocator {
    return this.next('getByRole', ...args);
  }
  getByLabel(...args: any[]): FakeLocator {
    return this.next('getByLabel', ...args);
  }
  getByPlaceholder(...args: any[]): FakeLocator {
    return this.next('getByPlaceholder', ...args);
  }
  getByAltText(...args: any[]): FakeLocator {
    return this.next('getByAltText', ...args);
  }
  getByTitle(...args: any[]): FakeLocator {
    return this.next('getByTitle', ...args);
  }
  getByTestId(...args: any[]): FakeLocator {
    return this.next('getByTestId', ...args);
  }
}

class FakeFrameLocator {
  locator(selector: string): FakeLocator {
    return new FakeLocator([{ name: 'frame.locator', args: [selector] }]);
  }

  getByText(text: any, options?: any): FakeLocator {
    return new FakeLocator([
      { name: 'frame.getByText', args: [text, options] },
    ]);
  }

  getByRole(...args: any[]): FakeLocator {
    return new FakeLocator([{ name: 'frame.getByRole', args }]);
  }

  getByLabel(...args: any[]): FakeLocator {
    return new FakeLocator([{ name: 'frame.getByLabel', args }]);
  }

  getByPlaceholder(...args: any[]): FakeLocator {
    return new FakeLocator([{ name: 'frame.getByPlaceholder', args }]);
  }

  getByAltText(...args: any[]): FakeLocator {
    return new FakeLocator([{ name: 'frame.getByAltText', args }]);
  }

  getByTitle(...args: any[]): FakeLocator {
    return new FakeLocator([{ name: 'frame.getByTitle', args }]);
  }

  getByTestId(...args: any[]): FakeLocator {
    return new FakeLocator([{ name: 'frame.getByTestId', args }]);
  }
}

describe('compilePlaywrightLocator', () => {
  it('should compile nested filter({ has }) and and/or steps recursively', () => {
    const ir: BrowserLocatorIR = {
      steps: [
        { type: 'locator', selector: 'section' },
        {
          type: 'filter',
          options: {
            has: {
              steps: [
                { type: 'locator', selector: 'h2' },
                {
                  type: 'filter',
                  options: { hasText: { type: 'string', value: 'Profile' } },
                },
              ],
            },
          },
        },
        {
          type: 'and',
          locator: { steps: [{ type: 'locator', selector: '#a' }] },
        },
        {
          type: 'or',
          locator: { steps: [{ type: 'locator', selector: '#b' }] },
        },
      ],
    };

    const frame = new FakeFrameLocator();
    const out = compilePlaywrightLocator(
      frame as any,
      ir,
    ) as unknown as FakeLocator;

    const filterOp = out.ops.find((o) => o.name === 'filter');
    expect(filterOp).toBeTruthy();
    const hasLocator = filterOp!.args[0].has as FakeLocator;
    expect(hasLocator).toBeInstanceOf(FakeLocator);
    expect(hasLocator.ops.some((o) => o.name === 'filter')).toBe(true);

    const andOp = out.ops.find((o) => o.name === 'and');
    const orOp = out.ops.find((o) => o.name === 'or');
    expect(andOp).toBeTruthy();
    expect(orOp).toBeTruthy();
    expect(andOp!.args[0]).toBeInstanceOf(FakeLocator);
    expect(orOp!.args[0]).toBeInstanceOf(FakeLocator);
  });

  it('should compile filter({ has }) where has includes and/or steps', () => {
    const ir: BrowserLocatorIR = {
      steps: [
        { type: 'locator', selector: 'section' },
        {
          type: 'filter',
          options: {
            has: {
              steps: [
                {
                  type: 'or',
                  locator: {
                    steps: [
                      {
                        type: 'getByText',
                        text: { type: 'string', value: 'Profile' },
                      },
                    ],
                  },
                },
                {
                  type: 'and',
                  locator: { steps: [{ type: 'locator', selector: 'h2' }] },
                },
              ],
            },
          },
        },
      ],
    };

    const frame = new FakeFrameLocator();
    const out = compilePlaywrightLocator(
      frame as any,
      ir,
    ) as unknown as FakeLocator;

    const filterOp = out.ops.find((o) => o.name === 'filter');
    expect(filterOp).toBeTruthy();

    const hasLocator = filterOp!.args[0].has as FakeLocator;
    expect(hasLocator.ops.some((o) => o.name === 'or')).toBe(true);
    expect(hasLocator.ops.some((o) => o.name === 'and')).toBe(true);
  });
});
