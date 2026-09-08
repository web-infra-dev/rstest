module.exports = {
  cachedDuringExecution: require.cache[__filename] === module,
  cacheDescriptorMatches:
    Object.getOwnPropertyDescriptor(require.cache, __filename)?.value ===
    module,
  hasParent: module.parent?.filename.endsWith('parent.cjs') === true,
  parentHasChild: module.parent?.children.includes(module) === true,
  hasLookupPaths: module.paths.some((path) => path.endsWith('node_modules')),
};
