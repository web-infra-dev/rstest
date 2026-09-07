module.exports = {
  dirname: __dirname,
  filename: __filename,
  inspectFailedChild() {
    const childPath = require.resolve('./retry-child.cjs');
    let failed = false;
    try {
      require(childPath);
    } catch (error) {
      failed = error.message === 'first attempt failed';
    }
    const cachedAfterFailure = Object.hasOwn(require.cache, childPath);
    const childrenAfterFailure = module.children.filter(
      (child) => child.filename === childPath,
    ).length;
    const result = require(childPath);
    return {
      failed,
      cachedAfterFailure,
      childrenAfterFailure,
      childrenAfterRetry: module.children.filter(
        (child) => child.filename === childPath,
      ).length,
      result,
    };
  },
};
