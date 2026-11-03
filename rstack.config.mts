import { define } from 'rstack';
import { osAgnosticTests } from './scripts/lint/os-agnostic-rule.ts';

define.lint(({ js, ts }) => [
  {
    ...js.configs.recommended,
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  },
  ts.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Unit tests need their own entry: a package tsconfig is `composite`
        // with `rootDir: src` and cannot include a sibling directory, so
        // without `tests/tsconfig.json` every test escapes both type-aware
        // lint rules and tsc itself.
        project: [
          './e2e/tsconfig.json',
          './packages/*/tsconfig.json',
          './packages/*/tests/tsconfig.json',
        ],
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    // Most packages keep unit tests under tests/; browser-ui colocates them as
    // src/**/*.test.{ts,tsx}. Both are ubuntu-only in CI, so cover both.
    files: [
      'packages/*/tests/**',
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
    ],
    plugins: {
      'rstest-repo': { rules: { 'os-agnostic-tests': osAgnosticTests } },
    },
    rules: {
      'rstest-repo/os-agnostic-tests': 'error',
    },
  },
  {
    // Runtime code executes inside the user's test environment, where fake
    // timers (rstest.useFakeTimers) replace the timer globals. Framework
    // timers must go through the real-timer registry, or they leak / misfire
    // once a test enables fake timers.
    files: ['packages/core/src/runtime/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'setImmediate',
          'clearImmediate',
        ].map((name) => ({
          selector: `CallExpression[callee.name='${name}']`,
          message: `Fake timers replace the ${name} global in user tests. Use getRealTimers() from runtime/util (extend REAL_TIMERS there if it lacks ${name}).`,
        })),
      ],
    },
  },
]);

define.fmt({
  singleQuote: true,
  sortPackageJson: true,
  // The core build formats this generated file separately; root checks can
  // run alongside the build and must not read it while it is being written.
  ignorePatterns: [
    'LICENSE.md',
    // Keep fixture and skill lockfiles in the existing formatting scope.
    '!package-lock.json',
    '!skills-lock.json',
  ],
});
