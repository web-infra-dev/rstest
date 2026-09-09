import { beforeEach, test } from '@rstest/core';

type BrowserFixtures = {
  browserValue: string;
};

const browserTest = test.extend<BrowserFixtures>({
  browserValue: 'browser',
});

beforeEach<BrowserFixtures>(({ browserValue }) => {
  if (browserValue === undefined) {
    throw new Error('browser hook received a missing fixture');
  }
});

browserTest('provides the browser hook fixture', () => {});
test('does not provide the browser hook fixture', () => {});
