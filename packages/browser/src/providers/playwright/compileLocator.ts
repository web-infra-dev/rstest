import type { FrameLocator, Locator, Page } from 'playwright';
import type { BrowserLocatorIR } from '../../protocol';
import { reviveBrowserLocatorText } from './textMatcher';

export const compilePlaywrightLocator = (
  frame: FrameLocator | Page,
  locatorIR: BrowserLocatorIR,
): Locator => {
  const compileFromFrame = (ir: BrowserLocatorIR): Locator => {
    let current: FrameLocator | Page | Locator = frame;

    const ensureLocator = (): Locator => {
      if ((current as any).filter) {
        return current as Locator;
      }
      // Convert FrameLocator to a Locator within the frame.
      current = (current as FrameLocator).locator(':root');
      return current as Locator;
    };

    for (const step of ir.steps as any[]) {
      switch (step.type) {
        case 'getByRole': {
          const name = step.options?.name
            ? reviveBrowserLocatorText(step.options.name)
            : undefined;
          const options = step.options ? { ...step.options, name } : undefined;
          current = (current as any).getByRole(step.role, options);
          break;
        }
        case 'locator':
          current = (current as any).locator(step.selector);
          break;
        case 'getByText':
          current = (current as any).getByText(
            reviveBrowserLocatorText(step.text),
            step.options,
          );
          break;
        case 'getByLabel':
          current = (current as any).getByLabel(
            reviveBrowserLocatorText(step.text),
            step.options,
          );
          break;
        case 'getByPlaceholder':
          current = (current as any).getByPlaceholder(
            reviveBrowserLocatorText(step.text),
            step.options,
          );
          break;
        case 'getByAltText':
          current = (current as any).getByAltText(
            reviveBrowserLocatorText(step.text),
            step.options,
          );
          break;
        case 'getByTitle':
          current = (current as any).getByTitle(
            reviveBrowserLocatorText(step.text),
            step.options,
          );
          break;
        case 'getByTestId':
          current = (current as any).getByTestId(
            reviveBrowserLocatorText(step.text) as any,
          );
          break;
        case 'filter': {
          const locator = ensureLocator();
          const options: {
            hasText?: string | RegExp;
            has?: Locator;
          } = {};
          if (step.options?.hasText) {
            options.hasText = reviveBrowserLocatorText(step.options.hasText);
          }
          if (step.options?.has) {
            options.has = compileFromFrame(step.options.has);
          }
          current = locator.filter(options);
          break;
        }
        case 'and': {
          const locator = ensureLocator();
          const other = compileFromFrame(step.locator);
          current = locator.and(other);
          break;
        }
        case 'or': {
          const locator = ensureLocator();
          const other = compileFromFrame(step.locator);
          current = locator.or(other);
          break;
        }
        case 'nth': {
          const locator = ensureLocator();
          current = locator.nth(step.index);
          break;
        }
        case 'first': {
          const locator = ensureLocator();
          current = locator.first();
          break;
        }
        case 'last': {
          const locator = ensureLocator();
          current = locator.last();
          break;
        }
        default:
          throw new Error(`Unknown locator step: ${String(step?.type)}`);
      }
    }

    return ensureLocator();
  };

  return compileFromFrame(locatorIR);
};
