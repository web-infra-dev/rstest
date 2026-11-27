/** @module-federation/node warns about the require chunk handler that Rstest deliberately installs. */
export const createFederationConsole = (base: Console): Console => {
  const scoped: Console = Object.create(base);
  scoped.warn = (...args) => {
    if (
      typeof args[1] === 'string' &&
      args[1].includes('build target is not set to "async-node"')
    ) {
      return;
    }
    base.warn(...args);
  };
  return scoped;
};
