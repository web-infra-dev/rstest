try {
  module.exports = require('./module-exports.mjs');
} catch (error) {
  module.exports = { code: error.code };
}
