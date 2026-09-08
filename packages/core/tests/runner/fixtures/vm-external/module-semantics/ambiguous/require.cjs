try {
  module.exports = require('./dependency.js');
} catch (error) {
  module.exports = { code: error.code };
}
