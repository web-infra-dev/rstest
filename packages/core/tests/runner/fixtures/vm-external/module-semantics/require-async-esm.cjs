try {
  require('./async-dependency.mjs');
  module.exports = { code: undefined };
} catch (error) {
  module.exports = { code: error.code };
}
