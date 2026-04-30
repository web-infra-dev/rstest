import type vm from 'node:vm';

export const shouldInterop = ({
  interopDefault = true,
  modulePath,
  mod,
}: {
  interopDefault?: boolean;
  modulePath: string;
  mod: any;
}): boolean => {
  if (!interopDefault) {
    return false;
  }
  // keep nodejs syntax
  // TODO: should also skip for `.js` with `type="module"`
  return !modulePath.endsWith('.mjs') && 'default' in mod;
};

const isPrimitive = (v: any): boolean => v !== Object(v);

export function interopModule(mod: any): { mod: any; defaultExport: any } {
  if (isPrimitive(mod)) {
    return {
      mod: { default: mod },
      defaultExport: mod,
    };
  }

  const defaultExport = 'default' in mod ? mod.default : mod;

  if (!isPrimitive(defaultExport) && '__esModule' in defaultExport) {
    return {
      mod: defaultExport,
      defaultExport:
        'default' in defaultExport ? defaultExport.default : defaultExport,
    };
  }

  return { mod, defaultExport };
}

// Caches vm.SyntheticModule by resolved module id to avoid nodejs/node#54735:
// repeatedly wrapping the same exports in fresh SyntheticModule instances
// races the V8 module-graph evaluation and segfaults the worker. One instance
// per resolved id structurally eliminates the race (mirrors vitest#7741).
const smCache = new Map<string, vm.SyntheticModule>();

/**
 * Wrap a plain exports object in a `vm.SyntheticModule` so it can participate
 * in the `vm.Module` graph as a link() or importModuleDynamically result.
 *
 * Default-export semantics are driven by the caller:
 * - Pass `defaultExport` when the source has an explicit default (CJS interop,
 *   JSON, WASM, native ESM with `export default`).
 * - Omit `defaultExport` for native ESM namespaces with only named exports —
 *   no `default` key is synthesized, so the consumer namespace shape stays
 *   identical to the original ESM namespace.
 */
export const asModule = async (
  something: Record<string, any>,
  resolvedId: string,
  defaultExport?: unknown,
): Promise<vm.SyntheticModule> => {
  const { SyntheticModule } = await import('node:vm');

  const cached = smCache.get(resolvedId);
  if (cached) return cached;

  const hasDefault = defaultExport !== undefined || 'default' in something;
  const namedKeys = Object.keys(something).filter((k) => k !== 'default');
  const exports = hasDefault ? ['default', ...namedKeys] : namedKeys;
  const resolvedDefault = hasDefault
    ? (defaultExport ?? something.default)
    : undefined;

  const syntheticModule = new SyntheticModule(
    exports,
    () => {
      for (const name of exports) {
        syntheticModule.setExport(
          name,
          name === 'default' ? resolvedDefault : something[name],
        );
      }
    },
    { identifier: resolvedId },
  );

  smCache.set(resolvedId, syntheticModule);

  await syntheticModule.link((() => undefined) as unknown as vm.ModuleLinker);

  // @ts-expect-error copy from webpack
  if (syntheticModule.instantiate) syntheticModule.instantiate();
  await syntheticModule.evaluate();

  return syntheticModule;
};

export const clearSyntheticModuleCache = (): void => {
  smCache.clear();
};
