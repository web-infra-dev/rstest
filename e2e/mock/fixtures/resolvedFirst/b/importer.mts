// Same shape as a/importer.mts, one directory over — its './foo.mjs' names a
// DIFFERENT module than a/'s.
export const loadFoo = (): Promise<{ from: string }> => {
  const spec = './foo.mjs';
  return import(spec);
};
