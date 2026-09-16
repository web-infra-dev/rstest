import { expect, it, rs } from '@rstest/core';

const { getCardStyles } = require('./component');

// The consumer has no root mock; use the mock shipped beside the linked package's entry.
rs.mock('@rstest/test-mock-manual-mock-workspace-package-styles-lib');

it("uses the manual mock colocated inside the workspace package's own directory", () => {
  expect(getCardStyles()).toEqual({ mocked: true });
});
