import type { RstestUtilities } from '../../types';
import { fn, spyOn } from './spy';

export const rstest: RstestUtilities = {
  fn,
  spyOn,
  mock: () => {
    // TODO
  },
};
