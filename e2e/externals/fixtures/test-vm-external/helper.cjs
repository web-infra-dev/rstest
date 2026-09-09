module.exports = {
  default: 'inner',
  isPlainObject: (value) =>
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype,
  named: 1,
};
