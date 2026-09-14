import { expect, it, rs } from '@rstest/core';

const { getCardStyles } = require('./component');

// Bare manual-mock call: no factory. This package
// (@rstest/test-mock-manual-mock-workspace-package-styles-lib) is a *workspace* dependency
// (linked via node_modules the same way any real monorepo links a shared package) and ships
// its own manual mock at `<styles-lib>/__mocks__/index.js`.
//
// Jest resolves the specifier, follows the symlink to the real package directory, and finds
// that colocated `__mocks__/index.js`.
//
// Rstest's manual-mock lookup only checks a single fixed `<rootPath>/__mocks__` directory,
// where `rootPath` is *this* package's own root (which has no `__mocks__` folder) — it never
// looks inside the *mocked* package's own directory. So this silently falls back to full
// automocking instead of using the manual mock above.
rs.mock('@rstest/test-mock-manual-mock-workspace-package-styles-lib');

it("uses the manual mock colocated inside the workspace package's own directory", () => {
  // Expected (matches Jest): { mocked: true }
  // Actual under Rstest: throws "useCardStyles is not a function", because the automocked
  // `makeStyles` returns `undefined` instead of a function.
  expect(getCardStyles()).toEqual({ mocked: true });
});
