import type { TestEnvironment } from '../../../types';

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'node',
  setup() {
    return {
      teardown() {},
    };
  },
};
