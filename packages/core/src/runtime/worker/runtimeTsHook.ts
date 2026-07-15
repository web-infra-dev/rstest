import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getNodeVersion, type NodeVersion } from '../../utils/helper';

/**
 * Node's own type stripping erases types but never converts module systems: in
 * a `type: module` scope a `.ts` file is ESM, period (and the mirror holds for
 * `type: commonjs`). Modules loaded at runtime — outside the bundle graph, e.g.
 * via a user-level `createRequire` — bypass rstest's per-module vm loaders, so
 * only a process-global `module.registerHooks` load hook can reach them.
 *
 * This hook intervenes on mismatches ONLY; every other file keeps Node-native
 * semantics.
 */

type SwcModuleType = 'commonjs' | 'es6';

type SwcApi = {
  transformSync: (
    source: string,
    options: {
      filename: string;
      module: { type: SwcModuleType };
      jsc: {
        parser: { syntax: 'typescript'; tsx: boolean };
        target: string;
      };
      sourceMaps: boolean;
    },
  ) => { code: string; map?: string };
};

const requireFromCore = createRequire(import.meta.url);

/**
 * Comment stripping is deliberately crude — see the safety argument on
 * {@link looksLikeCjs}.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// Top-level ESM syntax. `import(` (dynamic import, legal in CJS) and
// `import.meta` must NOT match — hence the char classes after the keyword.
const ESM_SYNTAX_RE = /^[ \t]*(?:import[\s"']|export[\s{*])/m;
const CJS_MARKER_RE = /\b(?:module\.exports|exports\s*[.[]|require\s*\()/;

/**
 * Safety argument for both sniffs: a false negative means we don't transform,
 * so the file fails natively exactly as it does today (no regression). The
 * regexes are deliberately conservative so false positives — transforming a
 * file that would have worked natively — are practically impossible: the
 * module→commonjs case additionally requires CJS markers, which throw in native
 * ESM anyway; the commonjs→module case requires ESM declarations, which throw
 * in native CJS anyway.
 */
export const looksLikeCjs = (source: string): boolean => {
  const stripped = stripComments(source);
  return !ESM_SYNTAX_RE.test(stripped) && CJS_MARKER_RE.test(stripped);
};

export const looksLikeEsm = (source: string): boolean => {
  const stripped = stripComments(source);
  return ESM_SYNTAX_RE.test(stripped) && !CJS_MARKER_RE.test(stripped);
};

// Every comparison against `NaN` (pre-release tags such as `23.0.0-nightly`)
// is false, closing the gate — the desired failure mode.
const atLeastInMajor = (
  { minor, patch }: NodeVersion,
  targetMinor: number,
  targetPatch: number,
): boolean =>
  minor > targetMinor || (minor === targetMinor && patch >= targetPatch);

/**
 * Sync-hook CJS loading was only made reentrancy-safe by
 * https://github.com/nodejs/node/pull/59929, shipped in v22.22.3, v24.11.1,
 * v25.1.0 and v26.0.0. Below those versions the feature stays inactive and the
 * documented manual workaround (`ts-node`/`@swc-node` registration) applies.
 *
 * Exported so unit tests can drive the version matrix without stubbing
 * `process.versions`.
 */
export const isRuntimeTsHookSupportedVersion = (
  version: NodeVersion,
): boolean => {
  const { major } = version;
  if (major >= 26) return true;
  if (major === 25) return atLeastInMajor(version, 1, 0);
  if (major === 24) return atLeastInMajor(version, 11, 1);
  if (major === 22) return atLeastInMajor(version, 22, 3);
  return false;
};

export const supportsRuntimeTsHook = (): boolean =>
  typeof Module.registerHooks === 'function' &&
  isRuntimeTsHookSupportedVersion(getNodeVersion());

let swc: SwcApi | undefined;

/**
 * SWC ships inside Rspack, reached through the `rspack` object that
 * `@rsbuild/core` re-exports — the same access path core already uses for
 * `rspack.experiments` (see `getSetupFiles.ts` / `plugins/basic.ts`). Requiring
 * it dlopens a ~39 MB native binding (~60 ms), so this must only ever run from
 * inside the load hook on an actual mismatch hit — never at registration.
 */
const loadSwc = (url: string): SwcApi => {
  if (swc) return swc;
  try {
    const { rspack }: { rspack: { experiments: { swc: SwcApi } } } =
      requireFromCore('@rsbuild/core');
    swc = rspack.experiments.swc;
    return swc;
  } catch (error) {
    throw new Error(
      `Failed to load SWC from @rsbuild/core to transform ${url}. ` +
        'This file is TypeScript loaded at runtime whose module style ' +
        'mismatches its package `type` scope, so rstest needs SWC to ' +
        'transform it. Set `runtimeTsTransform: false` to opt out, or make ' +
        'the file natively compatible (e.g. rename it to `.cts` / `.mts`).',
      { cause: error },
    );
  }
};

const textDecoder = new TextDecoder();

const decodeSource = (
  source: string | ArrayBuffer | NodeJS.TypedArray,
): string => (typeof source === 'string' ? source : textDecoder.decode(source));

const transformTs = (
  source: string,
  url: string,
  moduleType: SwcModuleType,
): string => {
  const { code, map } = loadSwc(url).transformSync(source, {
    filename: fileURLToPath(url),
    module: { type: moduleType },
    jsc: {
      parser: { syntax: 'typescript', tsx: false },
      target: 'es2022',
    },
    sourceMaps: true,
  });
  if (!map) return code;
  // Verified on Node v22.22.3: `sourceMaps: 'inline'` is NOT supported by
  // `rspack.experiments.swc.transformSync` (it emits no inline comment), so the
  // returned map — a JSON string — is appended manually.
  const inlineMap = Buffer.from(map, 'utf8').toString('base64');
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${inlineMap}`;
};

let hookEnabled = false;
let registered = false;
/**
 * Identity of the `.ts` CJS extension handler at registration time (`undefined`
 * on stock Node). `require.extensions` IS `Module._extensions` — the same
 * object — so this snapshot detects a third-party TS loader (ts-node, tsx,
 * @swc-node) taking over `.ts` later.
 */
let baselineTsExtension: unknown;

const getTsExtension = (): unknown => requireFromCore.extensions['.ts'];

/**
 * Registers the runtime TypeScript load hook once per process (registerHooks is
 * per-thread, which is what both the forks and threads pools want). `enabled`
 * is refreshed on every call so worker reuse across projects with different
 * settings behaves correctly.
 */
export const ensureRuntimeTsHook = (enabled: boolean): void => {
  hookEnabled = enabled;
  if (!enabled || registered) return;
  if (!supportsRuntimeTsHook()) return;

  baselineTsExtension = getTsExtension();
  registered = true;

  // `shortCircuit` is accepted by the sync-hook API but has no effect
  // (verified on Node v22.22.3), so it is omitted.
  Module.registerHooks({
    load: (url, context, nextLoad) => {
      if (!hookEnabled) return nextLoad(url, context);

      if (!url.startsWith('file://')) return nextLoad(url, context);
      const fileUrl = url.replace(/[?#].*$/, '');
      if (!fileUrl.endsWith('.ts') || fileUrl.includes('/node_modules/')) {
        return nextLoad(url, context);
      }

      // A third-party TS loader owns `.ts` now — pass through so it keeps
      // working. Verified on Node v22.22.3: when `Module._extensions['.ts']` is
      // assigned, Node's CJS loader gives it precedence and this hook never
      // fires on the `require()` path at all; on the `import()` path it fires
      // and this check hands back the native result.
      if (getTsExtension() !== baselineTsExtension) {
        return nextLoad(url, context);
      }

      const result = nextLoad(url, context);
      const { format } = result;
      // Only the two mismatch formats can be rewritten; anything already
      // resolved (`commonjs`/`module`, JSON, …) passes through without paying
      // for the source decode.
      if (format !== 'module-typescript' && format !== 'commonjs-typescript') {
        return result;
      }
      if (result.source === undefined) return result;
      const source = decodeSource(result.source);

      if (format === 'module-typescript' && looksLikeCjs(source)) {
        return {
          format: 'commonjs',
          source: transformTs(source, fileUrl, 'commonjs'),
        };
      }

      if (format === 'commonjs-typescript' && looksLikeEsm(source)) {
        return {
          format: 'module',
          source: transformTs(source, fileUrl, 'es6'),
        };
      }

      return result;
    },
  });
};
