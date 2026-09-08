module.exports = {
  parent: module.parent,
  linked: module.parent?.children.includes(module),
};
