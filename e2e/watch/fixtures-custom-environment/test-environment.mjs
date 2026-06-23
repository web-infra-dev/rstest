export default {
  name: 'custom-node',
  async setup(global) {
    global.__CUSTOM_ENV_MARKER__ = 'initial';
    return {
      teardown() {},
    };
  },
};
