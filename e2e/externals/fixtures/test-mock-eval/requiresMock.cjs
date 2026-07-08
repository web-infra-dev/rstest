// Bundled CJS helper: its body runs among the importer's harmony requires —
// BEFORE the async-deps await — so this require hits the mocked module while
// async externals are still pending (the lazy Proxy path).
module.exports = require('sfx-mod');
