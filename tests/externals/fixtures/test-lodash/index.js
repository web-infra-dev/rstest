// Reference lodash/lodash.js
// biome-ignore lint/complexity/useArrowFunction: <explanation>
(function () {
  /** Used as the semantic version number. */
  const VERSION = '4.17.21';

  /** Detect free variable `global` from Node.js. */
  const freeGlobal =
    typeof global === 'object' && global && global.Object === Object && global;

  /** Detect free variable `self`. */
  const freeSelf =
    typeof self === 'object' && self && self.Object === Object && self;

  /** Used as a reference to the global object. */
  const root = freeGlobal || freeSelf || Function('return this')();

  /** Detect free variable `exports`. */
  const freeExports =
    typeof exports === 'object' && exports && !exports.nodeType && exports;

  /** Detect free variable `module`. */
  const freeModule =
    freeExports &&
    typeof module === 'object' &&
    module &&
    !module.nodeType &&
    module;

  function lodash(value) {}

  lodash.VERSION = VERSION;

  // Some AMD build optimizers, like r.js, check for condition patterns like:
  if (
    typeof define === 'function' &&
    typeof define.amd === 'object' &&
    define.amd
  ) {
    // Expose Lodash on the global object to prevent errors when Lodash is
    // loaded by a script tag in the presence of an AMD loader.
    // See http://requirejs.org/docs/errors.html#mismatch for more details.
    // Use `_.noConflict` to remove Lodash from the global object.
    root._ = lodash;

    // Define as an anonymous module so, through path mapping, it can be
    // referenced as the "underscore" module.
    define(() => lodash);
  }
  // Check for `exports` after `define` in case a build optimizer adds it.
  else if (freeModule) {
    // Export for Node.js.
    freeModule.exports = lodash;
    // Export for CommonJS support.
    freeExports._ = lodash;
  } else {
    // Export to the global object.
    root._ = lodash;
  }
}).call(this);
