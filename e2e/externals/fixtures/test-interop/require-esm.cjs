try {
  require('./required-esm.mjs');
  module.exports = undefined;
} catch (error) {
  module.exports = error.code;
}
