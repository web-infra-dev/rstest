import { type SpyInternalImpl, getInternalState, internalSpyOn } from 'tinyspy';
import type { FunctionLike, Mock, MockContext, MockFn } from '../../types';

const wrapSpy = <T extends FunctionLike>(
  obj: Record<string, any>,
  methodName: string,
  mockFn?: T,
): Mock<T> => {
  const spyImpl = internalSpyOn(obj, methodName, mockFn) as SpyInternalImpl<
    Parameters<T>,
    ReturnType<T>
  >;

  const spyFn = spyImpl as unknown as Mock<T>;

  let mockImplementationOnce: T[] = [];
  let implementation = mockFn;

  const initMockState = () => ({
    mockName: mockFn?.name,
  });

  let mockState = initMockState();

  const spyState = getInternalState(spyImpl);

  spyFn.getMockName = () => mockState.mockName || methodName;

  spyFn.mockName = (name: string) => {
    mockState.mockName = name;

    return spyFn;
  };

  spyFn.getMockImplementation = () => {
    return mockImplementationOnce.length
      ? mockImplementationOnce[mockImplementationOnce.length - 1]
      : implementation;
  };

  function withImplementation(fn: T, cb: () => void): void;
  function withImplementation(fn: T, cb: () => Promise<void>): Promise<void>;
  function withImplementation(
    fn: T,
    cb: () => void | Promise<void>,
  ): void | Promise<void> {
    const originalImplementation = implementation;
    const originalMockImplementationOnce = mockImplementationOnce;

    implementation = fn;
    mockImplementationOnce = [];
    spyState.willCall(willCall);

    const reset = () => {
      implementation = originalImplementation;
      mockImplementationOnce = originalMockImplementationOnce;
    };

    const result = cb();

    if (result instanceof Promise) {
      return result.then(() => {
        reset();
      });
    }

    reset();
  }

  spyFn.withImplementation = withImplementation;

  spyFn.mockImplementation = (fn) => {
    implementation = fn;
    return spyFn;
  };

  spyFn.mockImplementationOnce = (fn) => {
    mockImplementationOnce.push(fn);
    return spyFn;
  };

  spyFn.mockReturnValue = (value) => {
    return spyFn.mockImplementation((() => value) as T);
  };

  spyFn.mockReturnValueOnce = (value) => {
    return spyFn.mockImplementationOnce((() => value) as T);
  };

  spyFn.mockResolvedValue = (value) => {
    return spyFn.mockImplementation((() => Promise.resolve(value)) as T);
  };

  spyFn.mockResolvedValueOnce = (value) => {
    return spyFn.mockImplementationOnce((() => Promise.resolve(value)) as T);
  };

  spyFn.mockRejectedValue = (value) => {
    return spyFn.mockImplementation((() => Promise.reject(value)) as T);
  };

  spyFn.mockRejectedValueOnce = (value) => {
    return spyFn.mockImplementationOnce((() => Promise.reject(value)) as T);
  };

  spyFn.mockReturnThis = () => {
    return spyFn.mockImplementation(function (this: ReturnType<T>) {
      return this;
    } as T);
  };

  function willCall(this: unknown, ...args: any) {
    let impl = implementation;
    if (mockImplementationOnce.length) {
      impl = mockImplementationOnce.shift();
    }
    return impl?.apply(this, args);
  }

  spyState.willCall(willCall);

  Object.defineProperty(spyFn, 'mock', {
    get: (): MockContext<T> => ({
      get calls() {
        return spyState.calls;
      },
      get results() {
        return spyState.results.map(([resultType, value]) => {
          const type =
            resultType === 'error' ? ('throw' as const) : ('return' as const);
          return { type: type, value };
        });
      },
    }),
  });

  spyFn.mockClear = () => {
    spyState.reset();

    return spyFn;
  };

  spyFn.mockReset = () => {
    spyFn.mockClear();
    implementation = mockFn;
    mockImplementationOnce = [];

    return spyFn;
  };

  spyFn.mockRestore = () => {
    spyFn.mockReset();
    spyState.restore();
    mockState = initMockState();
  };

  return spyFn;
};

export const fn: MockFn = <T extends FunctionLike>(mockFn?: T) => {
  const defaultName = 'rstest.fn()';

  return wrapSpy(
    {
      [defaultName]: mockFn,
    },
    defaultName,
    mockFn,
  );
};
