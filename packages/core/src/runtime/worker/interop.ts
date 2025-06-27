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
  if (interopDefault === false) {
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

export const asModule = async (
  something: Record<string, any>,
  defaultExport: Record<string, any>,
  context?: Record<string, any>,
  unlinked?: boolean,
): Promise<vm.SourceTextModule> => {
  const { Module, SyntheticModule } = await import('node:vm');

  if (something instanceof Module) {
    return something;
  }

  const exports = [...new Set(['default', ...Object.keys(something)])];

  const m = new SyntheticModule(
    exports,
    () => {
      for (const name of exports) {
        m.setExport(name, name === 'default' ? defaultExport : something[name]);
      }
    },
    {
      context,
    },
  );

  if (unlinked) return m;

  await m.link((() => {}) as unknown as vm.ModuleLinker);

  // @ts-expect-error copy from webpack
  if (m.instantiate) m.instantiate();
  await m.evaluate();

  return m;
};
