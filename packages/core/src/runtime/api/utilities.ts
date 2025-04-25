import type { RstestUtilities } from '../../types';
import { fn, mocks, spyOn } from './spy';

export const rstest: RstestUtilities = {
  fn,
  spyOn,
  clearAllMocks: () => {
    for (const mock of mocks) {
      mock.mockClear();
    }
    return rstest;
  },
  resetAllMocks: () => {
    for (const mock of mocks) {
      mock.mockReset();
    }
    return rstest;
  },
  restoreAllMocks: () => {
    for (const mock of mocks) {
      mock.mockRestore();
    }
    return rstest;
  },
};
