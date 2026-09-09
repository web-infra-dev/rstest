const fs = require('node:fs');

require.extensions['.ts'] = (mod, filename) => {
  mod._compile(fs.readFileSync(filename, 'utf-8'), filename);
};
