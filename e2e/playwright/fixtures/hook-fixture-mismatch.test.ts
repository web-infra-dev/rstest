import { test as base } from '@rstest/playwright';

type CustomFixtures = {
  customValue: string;
};

const extended = base.extend<CustomFixtures>({
  customValue: 'custom',
});

extended.beforeEach<CustomFixtures>(({ customValue }) => {
  if (customValue === undefined) {
    throw new Error('Playwright hook received a missing fixture');
  }
});

extended('provides the custom fixture', () => {});
base('does not provide the custom fixture', () => {});
