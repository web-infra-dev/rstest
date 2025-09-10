const { dirname } = require('node:path');

if (!dirname) {
  throw new Error('dirname is not defined');
}
exports.a = 1;
