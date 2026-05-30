// Without `injectRequireResolveOrigin`, rstest used to resolve these
// `require.resolve()` calls against the test entry. This fixture lives in a
// different directory, so relative specifiers must use this module as origin.
export const resolveHelper = () => require.resolve('./exportHelper');

export const resolveWithPaths = (base) =>
  require.resolve('rstest-require-resolve-target', { paths: [base] });
