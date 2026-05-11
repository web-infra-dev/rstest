// Babel/TSC-style CJS: `__esModule: true` plus an explicit `exports.default`.
// User contract: `import x from 'lib'` should give the inner default value
// (not the whole `module.exports`).
'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.a = 'world';
exports.default = () => 'hello';
