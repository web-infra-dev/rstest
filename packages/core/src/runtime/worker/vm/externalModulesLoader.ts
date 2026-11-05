import type { Context } from 'node:vm';

let externalModules: typeof import('./externalModules') | undefined;

export const loadVmExternalModules = async (): Promise<
  typeof import('./externalModules')
> => {
  externalModules ??= await import('./externalModules');
  return externalModules;
};

// VM preparation loads the implementation before a bundle can call require().
// Keeping this bridge synchronous avoids loading the VM executor in native pools.
export const getVmExternalModules = (
  context: Context,
): ReturnType<typeof import('./externalModules').getVmExternalModules> => {
  if (!externalModules) {
    throw new Error('VM external modules must be loaded before require().');
  }
  return externalModules.getVmExternalModules(context);
};
