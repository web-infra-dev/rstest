try {
  const namespace = require('./dependency.mjs');
  const cachedNamespace = require('./dependency.mjs');
  module.exports = {
    code: undefined,
    bridgeValue: namespace.bridgeValue,
    commonJsValue: namespace.commonJsValue,
    cycle: namespace.cycle,
    filename: namespace.filename,
    jsonLabel: namespace.jsonLabel,
    jsonSameRealm: namespace.jsonSameRealm,
    loadDynamic: namespace.loadDynamic,
    sameNamespace: namespace === cachedNamespace,
    sameRealm:
      Object.getPrototypeOf(namespace.realmObject) === Object.prototype,
    esModule: namespace.__esModule === true,
    state: namespace.state,
    value: namespace.value,
  };
} catch (error) {
  module.exports = { code: error.code };
}
