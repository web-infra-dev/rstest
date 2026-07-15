// CJS-style TypeScript inside a `"type": "module"` scope: Node's type stripping
// erases the annotation but never converts the module system, so natively this
// throws `ReferenceError: module is not defined`.
// This file has no top-level `import`/`export`, so TypeScript treats it as a
// global script: the name must not collide with a `lib.dom` global (`name`) nor
// with the other fixtures in this e2e tsconfig program.
const cjsPluginName: string = 'cjs-plugin';

module.exports = { name: cjsPluginName };
