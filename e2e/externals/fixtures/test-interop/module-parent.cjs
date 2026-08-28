const childPath = require.resolve('./module-child.cjs');
const first = require(childPath);
delete require.cache[childPath];
const second = require(childPath);
require.cache[childPath] = { exports: { replaced: true } };
const replaced = require(childPath);
const jsonPath = require.resolve('./cache-data.json');
const originalJson = require(jsonPath);
require.cache[jsonPath] = { exports: { label: 'replaced-json' } };
const replacedJson = require(jsonPath);

module.exports = {
  first,
  originalJson: originalJson.label,
  replaced,
  replacedJson: replacedJson.label,
  reloaded: first !== second,
  second,
};
