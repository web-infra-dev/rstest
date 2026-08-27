const childPath = require.resolve('./child.cjs');
const first = require(childPath);
const cachedBeforeDelete = require.cache[childPath] !== undefined;
delete require.cache[childPath];
const second = require(childPath);
const injectedPath = require.resolve('./injected.cjs');
require.cache[injectedPath] = { exports: { fromCache: true } };
const injected = require(injectedPath);

module.exports = {
  cachedBeforeDelete,
  first,
  injected,
  reloadedAfterDelete: first !== second,
  second,
};
