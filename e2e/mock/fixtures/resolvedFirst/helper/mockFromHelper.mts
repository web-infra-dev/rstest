// A module mock declared OUTSIDE the test file: the relative request must
// resolve against THIS helper's directory (the declaring module, `info.o`),
// not the test file that imports the helper.
import { rs } from '@rstest/core';

rs.mock('./helperDep.mjs', () => ({ tag: 'MOCKED_FROM_HELPER' }));

export const loadDep = (): Promise<{ tag: string }> => {
  const spec = './helperDep.mjs';
  return import(spec);
};
