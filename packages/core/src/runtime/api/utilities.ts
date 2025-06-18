import type { RstestUtilities } from '../../types';
import { fn, isMockFunction, mocks, spyOn } from './spy';

export const createRstestUtilities: () => RstestUtilities = () => {
  const originalEnvValues = new Map<string, string | undefined>();
  const originalGlobalValues = new Map<
    string | symbol | number,
    PropertyDescriptor | undefined
  >();

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
    doMock: () => {
      // TODO
    },
    unMock: () => {
      // TODO
    },
    doUnMock: () => {
      // TODO
    },
    importMock: async () => {
      return {} as any;
    },
    importActual: async () => {
      // The real implementation is handled by Rstest built-in plugin.
      return {} as any;
    },
    requireActual: () => {
      // The real implementation is handled by Rstest built-in plugin.
      return {} as any;
    },
    resetModules: () => {
      // TODO
      return rstest;
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
    stubGlobal: (name: string | symbol | number, value: any) => {
      if (!originalGlobalValues.has(name)) {
        originalGlobalValues.set(
          name,
          Object.getOwnPropertyDescriptor(globalThis, name),
        );
      }
      Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return rstest;
    },
    unstubAllGlobals: () => {
      originalGlobalValues.forEach((original, name) => {
        if (!original) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, original);
        }
      });
      originalGlobalValues.clear();
      return rstest;
    },
  };

  return rstest;
};
