// No type annotations: the third-party loader under test compiles sources
// verbatim (like `e2e/runtime-register/fixtures/cjs-register.cjs`) and does not
// strip types.
module.exports = { name: 'cjs-plugin' };
