import type { Page } from 'playwright';
import type {
  BrowserProviderPage,
  BrowserV8CoverageCollector,
  BrowserV8CoverageEntry,
} from '../index';

type PlaywrightCoveragePage = Pick<Page, 'coverage'>;

const asCoveragePage = (page: BrowserProviderPage): PlaywrightCoveragePage =>
  // BrowserProviderPage deliberately excludes provider-owned APIs.
  page as unknown as PlaywrightCoveragePage;

export const createPlaywrightV8CoverageCollector =
  (): BrowserV8CoverageCollector => ({
    async start(page): Promise<void> {
      await asCoveragePage(page).coverage.startJSCoverage({
        resetOnNavigation: false,
      });
    },
    async take(page): Promise<BrowserV8CoverageEntry[]> {
      return asCoveragePage(page).coverage.stopJSCoverage();
    },
  });
