try {
  const namespace = require('./required.js');
  module.exports = {
    sameRealm:
      Object.getPrototypeOf(namespace.realmObject) === Object.prototype,
    value: namespace.value,
  };
} catch (error) {
  module.exports = { code: error.code };
}
