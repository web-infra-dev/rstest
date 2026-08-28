try {
  const namespace = require('./required-esm.mjs');
  require('./explicit-esm/value.js');
  module.exports = {
    explicitEsm: globalThis.__RSTEST_EXPLICIT_ESM__,
    sameRealm:
      Object.getPrototypeOf(namespace.realmObject) === Object.prototype,
    value: namespace.value,
  };
} catch (error) {
  module.exports = { code: error.code };
}
