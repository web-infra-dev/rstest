import { createContext, runInContext, type Context } from 'node:vm';
import type { MaybePromise, RunWorkerOptions } from '../../../types';
import type { TestEnvironmentModuleFallback } from '../../../pool/protocol';
import { environmentLoaders } from '../env/registry';
import { loadTestEnvironmentModule } from '../env/testEnvironmentModule';
import {
  installObjectURLTracker,
  installTimerTracking,
  type NodeTimerPrimitives,
} from '../env/utils';
import { captureVmContextKeys } from './context';
import {
  installVmNodeGlobals,
  installWorkerHTMLElement,
  type VmRuntimeGlobal,
} from './nodeGlobals';

export const prepareVmRuntimeRealm = async (
  context: RunWorkerOptions['options']['context'],
  cleanupFns: (() => MaybePromise<void>)[],
  onTestEnvironmentFallback?: (fallback: TestEnvironmentModuleFallback) => void,
): Promise<{
  initialKeys: Set<string | symbol>;
  runtimeError: typeof Error;
  runtimeGlobal: VmRuntimeGlobal;
  vmContext: Context;
  setVirtualConsoleTarget?: (target: Console) => void;
}> => {
  const { testEnvironment } = context.runtimeConfig;
  let vmContext: Context;
  let setVirtualConsoleTarget: ((target: Console) => void) | undefined;
  if (testEnvironment.name === 'node') {
    vmContext = createContext({});
  } else {
    const loadEnvironment = environmentLoaders[testEnvironment.name];
    if (!loadEnvironment) {
      throw new Error(`Unknown test environment: ${testEnvironment.name}`);
    }
    const [{ setupVM }, environmentModule] = await Promise.all([
      loadEnvironment(),
      loadTestEnvironmentModule(
        context.testEnvironmentModule,
        onTestEnvironmentFallback,
      ),
    ]);
    const vmEnvironment = await setupVM(
      testEnvironment.options || {},
      { scope: 'file' },
      environmentModule,
    );
    vmContext = vmEnvironment.context;
    cleanupFns.push(vmEnvironment.teardown);
    setVirtualConsoleTarget = vmEnvironment.setVirtualConsoleTarget;
  }

  const runtimeGlobal = runInContext(
    'globalThis',
    vmContext,
  ) as VmRuntimeGlobal;
  const runtimeError = runInContext('Error', vmContext) as typeof Error;
  if (testEnvironment.name !== 'node') {
    cleanupFns.push(installWorkerHTMLElement(runtimeGlobal));
  }
  installVmNodeGlobals(runtimeGlobal, vmContext);
  if (testEnvironment.name === 'node') {
    const nodeTimers: NodeTimerPrimitives = {
      clearImmediate: globalThis.clearImmediate,
      clearInterval: globalThis.clearInterval,
      clearTimeout: globalThis.clearTimeout,
      setImmediate: globalThis.setImmediate,
      setInterval: globalThis.setInterval,
      setTimeout: globalThis.setTimeout,
    };
    cleanupFns.push(
      installTimerTracking(runtimeGlobal, nodeTimers, { scope: 'file' }),
      installObjectURLTracker(runtimeGlobal.URL, { scope: 'file' }),
    );
  }
  return {
    initialKeys: captureVmContextKeys(vmContext),
    runtimeError,
    runtimeGlobal,
    setVirtualConsoleTarget,
    vmContext,
  };
};
