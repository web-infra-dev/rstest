const setupGlobal = globalThis as typeof globalThis & {
  __RSTEST_VM_SETUP_COUNT__?: number;
};

setupGlobal.__RSTEST_VM_SETUP_COUNT__ =
  (setupGlobal.__RSTEST_VM_SETUP_COUNT__ ?? 0) + 1;
console.log('VM_SETUP_FILE');
