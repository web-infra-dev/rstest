import type { MaybePromise } from '../../types';

export type CleanupCallback = () => MaybePromise<void>;
export type RegisterCleanup = (cleanup: CleanupCallback) => () => boolean;

export type CleanupRegistry = {
  register: RegisterCleanup;
  installBridge: (runtimeGlobal: Record<PropertyKey, unknown>) => void;
  take: () => CleanupCallback[];
};

export const createCleanupRegistry = (
  scope: 'file' | 'worker',
): CleanupRegistry => {
  const registrySymbol = Symbol.for(`rstest.${scope}.cleanup.registry`);
  const hostRegisterSymbol = Symbol.for(`rstest.${scope}.cleanup.register`);

  const getRegistry = (): Set<CleanupCallback> => {
    let registry = Reflect.get(globalThis, registrySymbol) as
      Set<CleanupCallback> | undefined;

    if (!registry) {
      registry = new Set<CleanupCallback>();
      Reflect.set(globalThis, registrySymbol, registry);
    }

    return registry;
  };

  const registerLocal: RegisterCleanup = (cleanup) => {
    const registry = getRegistry();
    registry.add(cleanup);
    return () => registry.delete(cleanup);
  };

  const register: RegisterCleanup = (cleanup) => {
    // VM contexts keep an isolated `globalThis`; delegate to the host worker
    // registrar installed on the VM global so teardown runs these callbacks.
    const hostRegister = Reflect.get(globalThis, hostRegisterSymbol) as
      RegisterCleanup | undefined;
    return hostRegister ? hostRegister(cleanup) : registerLocal(cleanup);
  };

  const installBridge = (runtimeGlobal: Record<PropertyKey, unknown>): void => {
    if (runtimeGlobal !== globalThis) {
      Reflect.set(runtimeGlobal, hostRegisterSymbol, registerLocal);
    }
  };

  const take = (): CleanupCallback[] => {
    const registry = getRegistry();
    const cleanups = [...registry];
    registry.clear();
    return cleanups;
  };

  return { register, installBridge, take };
};
