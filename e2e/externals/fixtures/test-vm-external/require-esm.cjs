try {
  const namespace = require('./required.js');
  module.exports = {
    sameRealm:
      Object.getPrototypeOf(namespace.realmObject) === Object.prototype,
    esModule: namespace.__esModule === true,
    value: namespace.value,
  };
} catch (error) {
  module.exports = { code: error.code };
}
