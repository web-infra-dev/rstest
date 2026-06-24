import { marker } from './environment-helper.mjs';

export default {
  name: 'custom-node',
  async setup(global) {
    global.__CUSTOM_ENV_MARKER__ = marker;
    return {
      teardown() {},
    };
  },
};
