import { afterAll, expect, it, rs } from '@rstest/core';

// Regression for #1327 (node builtins) and #1328 (ESM-only npm packages):
// a dynamic `import()` of a MOCKED externalized specifier must resolve to the
// mock, not the real module.
//
// rspack mints a different external module id for a dynamic `import("X")`
// (`external import "X"`) than for the hoisted `rs.mock` dependency
// (`external module "X"`), so a mock installed on the static id was missed by
// the dynamic import. The rstest runtime (mockRuntimeCode.js) now also registers
// the mock under the clean request, and the RstestPlugin codegen routes EXTERNAL
// dynamic imports through `__webpack_require__.rstest_dynamic_require(id, request)`
// to find it.
//
// SKIPPED: the runtime half ships in this package, but the codegen half lives in
// @rspack/core's rstest plugin. This assertion only passes once rstest depends on
// an @rspack/core that emits the `rstest_dynamic_require` codegen — remove
// `.skip` after that dependency bump. The codegen half is already regression-
// covered upstream in
// rspack: tests/rspack-test/configCases/rstest/mock-dynamic-import-external.
rs.mock('node:child_process', () => ({
  execSync: () => 'MOCKED',
}));

afterAll(() => {
  rs.doUnmock('node:child_process');
});

it.skip('dynamic import() of a mocked node builtin resolves to the mock (#1327/#1328)', async () => {
  const cp = await import('node:child_process');
  const execSync = cp.execSync as unknown as () => string;
  expect(execSync()).toBe('MOCKED');
});
