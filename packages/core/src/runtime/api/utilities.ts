import type { RstestUtilities } from '../../types';
import { fn, isMockFunction, mocks, spyOn } from './spy';

export const createRstestUtilities: () => RstestUtilities = () => {
  const originalEnvValues = new Map<string, string | undefined>();

  const rstest: RstestUtilities = {
    fn,
    spyOn,
    isMockFunction,
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
    mock: () => {
      // TODO
    },
    stubEnv: (name: string, value: string | undefined): RstestUtilities => {
      if (!originalEnvValues.has(name)) {
        originalEnvValues.set(name, process.env[name]);
      }

      // update process.env
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }

      return rstest;
    },
    unstubAllEnvs: (): RstestUtilities => {
      // restore process.env
      for (const [name, value] of originalEnvValues) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }

      originalEnvValues.clear();

      return rstest;
    },
  };

  return rstest;
};
