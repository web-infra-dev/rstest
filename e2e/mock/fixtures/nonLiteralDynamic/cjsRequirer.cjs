const os = require('node:os');

module.exports = { probe: () => os.hostname() };
