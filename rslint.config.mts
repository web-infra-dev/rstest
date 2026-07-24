import { defineConfig, ts } from '@rslint/core';

// Unit tests must be OS-agnostic: CI runs the ut job on ubuntu only, so a test
// whose behavior branches on the host platform silently loses its non-Linux
// side. OS-specific behavior belongs in e2e/ (which still runs macOS and
// Windows); platform-dependent code paths in unit tests must stub the platform
// instead — see `withPlatform` in packages/core/tests/core/related.test.ts.
// Stub/restore via Object.defineProperty + Object.getOwnPropertyDescriptor is
// intentionally not flagged: it is the sanctioned pattern.
const osAgnosticTests = {
  meta: {
    type: 'problem',
    docs: { description: 'disallow reading the host platform in unit tests' },
    schema: [],
    messages: {
      banned:
        'Unit tests run on ubuntu only in CI, so {{read}} makes the test host-dependent. ' +
        'Stub the platform (see `withPlatform` in packages/core/tests/core/related.test.ts) ' +
        'or move the coverage to e2e/.',
    },
  },
  create(context: {
    report: (descriptor: {
      node: unknown;
      messageId: string;
      data: { read: string };
    }) => void;
  }) {
    // ESTree nodes; typed structurally since the plugin worker passes plain
    // ESLint-shaped objects.
    const report = (node: unknown, read: string) =>
      context.report({ node, messageId: 'banned', data: { read } });

    // Local names bound to the os module via default/namespace imports
    // (`import hostOs from 'node:os'`, `import * as hostOs from 'node:os'`),
    // so aliasing cannot bypass the member-access check. Imports precede any
    // use in document order, so the set is populated before it is consulted.
    const osModuleNames = new Set(['os']);

    return {
      MemberExpression(node: {
        object: { type: string; name?: string };
        property: { type: string; name?: string; value?: unknown };
        computed: boolean;
      }) {
        const property = node.computed
          ? node.property.value
          : node.property.name;
        if (node.object.name === 'process' && property === 'platform') {
          report(node, 'process.platform');
        }
        if (
          node.object.name !== undefined &&
          osModuleNames.has(node.object.name) &&
          (property === 'platform' || property === 'type')
        ) {
          report(node, `\`${property}()\` from node:os`);
        }
      },
      VariableDeclarator(node: {
        id: {
          type: string;
          properties?: Array<{
            type: string;
            key?: { type: string; name?: string };
          }>;
        };
        init?: { type: string; name?: string } | null;
      }) {
        if (node.init?.name !== 'process' || node.id.type !== 'ObjectPattern') {
          return;
        }
        for (const property of node.id.properties ?? []) {
          if (property.key?.name === 'platform') {
            report(property, 'destructuring `platform` from process');
          }
        }
      },
      ImportDeclaration(node: {
        source: { value?: unknown };
        specifiers: Array<{
          type: string;
          local?: { type: string; name?: string };
          imported?: { type: string; name?: string };
        }>;
      }) {
        if (node.source.value !== 'os' && node.source.value !== 'node:os') {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const imported = specifier.imported?.name;
            if (imported === 'platform' || imported === 'type') {
              report(specifier, `importing \`${imported}\` from node:os`);
            }
          } else if (specifier.local?.name !== undefined) {
            // ImportDefaultSpecifier / ImportNamespaceSpecifier
            osModuleNames.add(specifier.local.name);
          }
        }
      },
    };
  },
};

export default defineConfig([
  { ignores: ['**/dist/**', '**/dist-types/**'] },
  ts.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: ['./e2e/tsconfig.json', './packages/*/tsconfig.json'],
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['packages/*/tests/**'],
    plugins: { rstest: { rules: { 'os-agnostic-tests': osAgnosticTests } } },
    rules: {
      'rstest/os-agnostic-tests': 'error',
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
