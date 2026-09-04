/**
 * Keep every port unique across configs that different test files launch.
 *
 * Browser-mode e2e test *files* run concurrently in a single process, so two
 * configs a single file runs one after another may share a port, but two
 * configs reached from different files must not — that is the flaky
 * "EADDRINUSE" failure, and one fixture directory holding several configs is
 * exactly where it hides.
 */
export const BROWSER_PORTS = {
  basic: 5180,
  'browser-react': 5202,
  'locator-api': 5226,
  list: 5204,
  'no-tests': 5206,
  'entry-override': 5208,
  env: 5212,
  config: 5184,
  console: 5192,
  'browser-coverage': 5200,
  'browser-coverage-no-include': 5210,
  error: 5182,
  isolation: 5188,
  'setup-files': 5190,
  snapshot: 5196,
  watch: 5186,
  'watch-headed': 5270,
  webkit: 5198,
  viewport: 5214,
  'viewport-preset': 5216,
  reporter: 5220,
  'reporter-watch': 5222,
  'github-actions': 5224,
  silent: 5230,
  'browser-coverage-multiproject': 5228,
  related: 5232,
  'multi-project-config': 5234,
  'multi-project-config-hooked-b': 5246,
  bail: 5236,
  mixed: 5238,
  'mixed-browser-fail': 5240,
  'browser-only-reporters': 5242,
  'no-tests-reporters': 5244,
  'browser-empty-project': 5248,
  'browser-collect-timeout': 5250,
  'browser-global-setup': 5252,
  'browser-global-setup-error': 5254,
  'browser-global-setup-mixed': 5256,
  'browser-mock': 5258,
  'browser-in-source': 5260,
  'browser-in-source-watch': 5262,
  'watch-shortcuts': 5194,
  'watch-multi-project': 5266,
  'mixed-watch-shortcuts': 5268,
  // One key for every config `configWarnings.test.ts` launches: its tests run
  // serially, so they may share — the rule above only splits across files.
  'browser-coverage-config-warnings': 5272,
  'browser-coverage-v8': 5280,
  'browser-coverage-v8-webkit': 5282,
  'empty-suite': 5284,
  'programmatic-runner': 5286,
  'watch-setup': 5278,
  'basic-federation': 5274,
  'basic-federation-watch': 5276,
} as const;

const browserPortValues = Object.values(BROWSER_PORTS);

if (new Set(browserPortValues).size !== browserPortValues.length) {
  throw new Error(
    `Duplicate browser fixture ports detected: ${JSON.stringify(BROWSER_PORTS)}`,
  );
}

export const BROWSER_TEST_TIMEOUT =
  process.platform === 'win32' ? 20_000 : 10_000;
