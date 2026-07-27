import { defineConfig, ts } from '@rslint/core';

// Unit tests must be OS-agnostic: CI runs the ut job on ubuntu only, so a test
// whose behavior branches on the host platform silently loses its non-Linux
// side. OS-specific behavior belongs in e2e/ (which still runs macOS and
// Windows); platform-dependent code paths in unit tests must stub the platform
// instead — see `withPlatform` in packages/core/tests/core/related.test.ts.
// Stub/restore via Object.defineProperty + Object.getOwnPropertyDescriptor is
// intentionally not flagged: it is the sanctioned pattern.
//
// Exported so scripts/lint/os-agnostic-rule.test.ts can mount it in a minimal,
// project-free config — linting fixtures without the type-aware program this
// config otherwise builds (which the syntactic rule does not need).
export const osAgnosticTests = {
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
    // ESTree nodes, typed structurally since the plugin worker passes plain
    // ESLint-shaped objects. IdentNode is the identifier-shaped subset the
    // predicates inspect; MemberNode adds the member-access fields.
    type IdentNode = { type: string; name?: string };
    type MemberNode = {
      type: string;
      object: MemberNode | IdentNode;
      property: { name?: string; value?: unknown };
      computed: boolean;
      name?: string;
    };
    const report = (node: unknown, read: string) =>
      context.report({ node, messageId: 'banned', data: { read } });

    // Local names that alias a provider, so aliasing cannot bypass the
    // member-access check: default/namespace imports (`import hostOs from
    // 'node:os'`), `require()` bindings (`const proc = require('node:process')`)
    // and `const`-bindings of another alias (`const host = process`). The
    // import/binding precedes any use in document order, so the sets are
    // populated before they are read.
    const osNames = new Set(['os']);
    const processNames = new Set(['process']);

    const identBoundTo = (node: IdentNode, names: Set<string>) =>
      node.type === 'Identifier' &&
      node.name !== undefined &&
      names.has(node.name);

    // The accessed property name: `.name` for a static member, the literal
    // `.value` for a computed string key, or the cooked text for a
    // no-substitution template key (`obj[`platform`]`, which would otherwise
    // parse as a TemplateLiteral with an undefined `.value` and slip through).
    const memberName = (node: {
      property: {
        name?: string;
        value?: unknown;
        quasis?: Array<{ value?: { cooked?: unknown } }>;
      };
      computed: boolean;
    }) =>
      node.computed
        ? (node.property.value ?? node.property.quasis?.[0]?.value?.cooked)
        : node.property.name;

    const isGlobalObject = (node: IdentNode) =>
      node.type === 'Identifier' &&
      (node.name === 'globalThis' || node.name === 'global');

    // Whether an expression resolves to the `process` global: the bare (or
    // aliased) identifier, or `globalThis.process` / `global.process`.
    const isProcessRef = (node: MemberNode | IdentNode) => {
      if (node.type === 'Identifier') {
        return identBoundTo(node, processNames);
      }
      const member = node as MemberNode;
      return (
        member.type === 'MemberExpression' &&
        isGlobalObject(member.object) &&
        memberName(member) === 'process'
      );
    };

    const isOsRef = (node: IdentNode) => identBoundTo(node, osNames);

    // Which provider a `require('node:os')` or `import('node:os')` load
    // resolves to, so both module-loading forms are tracked like a static
    // import. `await import(...)` is handled by unwrapping in providerOf.
    const loadedModule = (node: {
      type?: string;
      callee?: { name?: string };
      arguments?: Array<{ value?: unknown }>;
      source?: { value?: unknown };
    }) => {
      const source =
        node.type === 'ImportExpression'
          ? node.source?.value
          : node.type === 'CallExpression' && node.callee?.name === 'require'
            ? node.arguments?.[0]?.value
            : undefined;
      if (source === 'os' || source === 'node:os') return 'os' as const;
      if (source === 'process' || source === 'node:process') {
        return 'process' as const;
      }
      return null;
    };

    // Which provider an initializer resolves to: a `process`/`os` reference
    // (bare, aliased, or global), or a `require()` / (`await`) `import()` of
    // the module.
    const providerOf = (node: MemberNode | IdentNode) => {
      const load =
        node.type === 'AwaitExpression'
          ? (node as { argument?: MemberNode }).argument
          : node;
      if (load && isProcessRef(load)) return 'process' as const;
      if (load && isOsRef(load)) return 'os' as const;
      return load ? loadedModule(load) : null;
    };

    return {
      MemberExpression(node: MemberNode) {
        const property = memberName(node);
        if (property === 'platform' && isProcessRef(node.object)) {
          report(node, 'process.platform');
        }
        if (
          (property === 'platform' || property === 'type') &&
          isOsRef(node.object)
        ) {
          report(node, `\`${property}()\` from node:os`);
        }
      },
      VariableDeclarator(node: {
        id: {
          type: string;
          name?: string;
          properties?: Array<{
            type: string;
            computed?: boolean;
            key?: {
              name?: string;
              value?: unknown;
              quasis?: Array<{ value?: { cooked?: unknown } }>;
            };
          }>;
        };
        init?: MemberNode | null;
      }) {
        if (!node.init) {
          return;
        }
        // `const host = process` / `const host = require('node:os')`
        // propagates the alias into the name sets so a later `host.platform` /
        // `host.type()` is caught.
        if (node.id.type === 'Identifier' && node.id.name !== undefined) {
          const provider = providerOf(node.init);
          if (provider === 'process') {
            processNames.add(node.id.name);
          } else if (provider === 'os') {
            osNames.add(node.id.name);
          }
          return;
        }
        // `const { platform } = process`, `const { platform, type } = os`
        // (or a require()/alias of either), including computed keys like
        // `const { ['platform']: p } = process`.
        if (node.id.type === 'ObjectPattern') {
          const provider = providerOf(node.init);
          for (const property of node.id.properties ?? []) {
            const key = memberName({
              property: property.key ?? {},
              computed: property.computed ?? false,
            });
            if (provider === 'process' && key === 'platform') {
              report(property, 'destructuring `platform` from process');
            } else if (
              provider === 'os' &&
              (key === 'platform' || key === 'type')
            ) {
              report(property, `destructuring \`${key}\` from node:os`);
            }
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
        const source = node.source.value;
        const fromOs = source === 'os' || source === 'node:os';
        const fromProcess = source === 'process' || source === 'node:process';
        if (!fromOs && !fromProcess) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const imported = specifier.imported?.name;
            if (fromOs && (imported === 'platform' || imported === 'type')) {
              report(specifier, `importing \`${imported}\` from node:os`);
            }
            if (fromProcess && imported === 'platform') {
              report(specifier, 'importing `platform` from node:process');
            }
          } else if (specifier.local?.name !== undefined) {
            // ImportDefaultSpecifier / ImportNamespaceSpecifier
            (fromOs ? osNames : processNames).add(specifier.local.name);
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
    // Most packages keep unit tests under tests/; browser-ui colocates them as
    // src/**/*.test.{ts,tsx}. Both are ubuntu-only in CI, so cover both.
    files: [
      'packages/*/tests/**',
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
    ],
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
