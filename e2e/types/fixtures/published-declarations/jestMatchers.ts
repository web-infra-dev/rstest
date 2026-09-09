import { expect } from '@rstest/core';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Matchers<R, T = {}> {
      toBeCustom(): R;
    }
  }
}

expect(true).toBeCustom();
