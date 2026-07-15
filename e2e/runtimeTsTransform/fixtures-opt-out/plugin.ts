// This file has no top-level `import`/`export`, so TypeScript treats it as a
// global script: the name must not collide with a `lib.dom` global (`name`) nor
// with the other fixtures in this e2e tsconfig program.
const optOutPluginName: string = 'cjs-plugin';

module.exports = { name: optOutPluginName };
