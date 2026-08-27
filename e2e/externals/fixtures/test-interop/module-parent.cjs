const childPath = require.resolve('./module-child.cjs');
const first = require(childPath);
delete require.cache[childPath];
const second = require(childPath);

module.exports = {
  first,
  reloaded: first !== second,
  second,
};
