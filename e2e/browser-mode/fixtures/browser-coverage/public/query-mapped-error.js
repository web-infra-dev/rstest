Object.defineProperty(globalThis, '__RSTEST_QUERY_MAPPED_FAILURE__', {
  value: () => {
    throw new Error('query-mapped browser failure');
  },
  configurable: true,
});
