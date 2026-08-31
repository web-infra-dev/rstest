const childPath = require.resolve('./child.cjs');
const first = require(childPath);
const cachedBeforeDelete = require.cache[childPath] !== undefined;
delete require.cache[childPath];
const second = require(childPath);
require.cache[childPath] = { exports: { replaced: true } };
const replaced = require(childPath);
const jsonPath = require.resolve('../data.json');
const originalJson = require(jsonPath);
require.cache[jsonPath] = { exports: { label: 'replaced-json' } };
const replacedJson = require(jsonPath);
const injectedPath = require.resolve('./injected.cjs');
require.cache[injectedPath] = { exports: { fromCache: true } };
const injected = require(injectedPath);
const { Module } = require('node:module');

module.exports = {
  cachedBeforeDelete,
  first,
  injected,
  originalJson: originalJson.label,
  replaced,
  replacedJson: replacedJson.label,
  reloadedAfterDelete: first !== second,
  second,
  moduleConstructor: {
    hasLoad: typeof module.constructor._load === 'function',
    hasResolveFilename:
      typeof module.constructor._resolveFilename === 'function',
    isModule: module instanceof Module,
    sameConstructor: module.constructor === Module,
  },
};
