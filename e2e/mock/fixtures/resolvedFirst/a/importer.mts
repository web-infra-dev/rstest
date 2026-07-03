// Non-literal relative import: the specifier resolves against THIS module's
// directory (rspack-injected origin), not the test file's.
export const loadFoo = (): Promise<{ from: string }> => {
  const spec = './foo.mjs';
  return import(spec);
};
