import { setFlagsFromString } from 'node:v8';

let vmCompilationCacheDisabled = false;

export const disableVmCompilationCache = (): void => {
  if (vmCompilationCacheDisabled) {
    return;
  }
  // V8's isolate-wide compilation cache is unbounded and retains scripts from
  // every disposed Context. VM pools use the bounded worker cache instead.
  setFlagsFromString('--no-compilation-cache');
  vmCompilationCacheDisabled = true;
};
