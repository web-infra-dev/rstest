export const runCleanupCode = (): void => {
  Reflect.set(globalThis, '__RSTEST_CLEANUP_CODE__', true);
};
