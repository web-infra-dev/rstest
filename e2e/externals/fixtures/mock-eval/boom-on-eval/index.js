// Import-time side effect that must never run when this package is mocked.
throw new Error('boom-on-eval was evaluated');
module.exports = { real: true };
