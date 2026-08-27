module.exports = {
  cached: require.cache[__filename] === module,
  hasParent: module.parent?.filename.endsWith('module-parent.cjs') === true,
  parentHasChild: module.parent?.children.includes(module) === true,
};
