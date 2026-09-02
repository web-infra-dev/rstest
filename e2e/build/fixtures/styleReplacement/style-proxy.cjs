module.exports = new Proxy(
  {},
  {
    get: (_target, className) =>
      className === '__esModule' ? false : className,
  },
);
