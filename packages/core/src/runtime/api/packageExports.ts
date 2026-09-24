import { createRequire } from 'node:module';
import type { RuntimeRstest } from './index';

// Rspack compiles external named imports to synchronous property reads at call sites,
// so getters must load via require; import() would return a Promise.
const require = createRequire(import.meta.url);

type PackageOnlyExport = Exclude<
  keyof typeof import('../../index'),
  keyof RuntimeRstest
>;

// Tests resolve @rstest/core through the runtime global, which must also expose
// these package exports. Defer loading the package (and @rsbuild/core) until read.
const PACKAGE_ONLY_EXPORTS = [
  'defineConfig',
  'defineInlineProject',
  'defineProject',
  'loadConfig',
  'mergeProjectConfig',
  'mergeRstestConfig',
] as const satisfies readonly PackageOnlyExport[];

type MissingPackageExports = Exclude<
  PackageOnlyExport,
  (typeof PACKAGE_ONLY_EXPORTS)[number]
>;
type PackageExportsAreExhaustive = [MissingPackageExports] extends [never]
  ? true
  : [
      'PACKAGE_ONLY_EXPORTS is missing exports of index.ts:',
      MissingPackageExports,
    ];
const _packageExportsAreExhaustive: PackageExportsAreExhaustive = true;
void _packageExportsAreExhaustive;

export function withPackageExports(api: RuntimeRstest): RuntimeRstest {
  const exports = { ...api };
  for (const name of PACKAGE_ONLY_EXPORTS) {
    Object.defineProperty(exports, name, {
      enumerable: true,
      get() {
        const packageModule: typeof import('../../index') = require('@rstest/core');
        return packageModule[name];
      },
    });
  }
  return exports;
}
