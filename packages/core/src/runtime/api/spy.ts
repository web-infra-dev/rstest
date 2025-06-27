import { getInternalState, internalSpyOn, type SpyInternalImpl } from 'tinyspy';
import type {
  FunctionLike,
  Mock,
  MockContext,
  MockFn,
  MockInstance,
} from '../../types';

let callOrder = 0;

export const mocks: Set<MockInstance> = new Set();

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
  let mockName = mockFn?.name;

  const initMockState = () => ({
    instances: [] as ReturnType<T>[],
    contexts: [] as ThisParameterType<T>[],
    invocationCallOrder: [] as number[],
  });

  let mockState = initMockState();

  const spyState = getInternalState(spyImpl);

  spyFn.getMockName = () => mockName || methodName;

  spyFn.mockName = (name: string) => {
    mockName = name;

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
    let impl = implementation || (spyState.getOriginal() as T);
    mockState.instances.push(this as ReturnType<T>);
    mockState.contexts.push(this as ThisParameterType<T>);
    mockState.invocationCallOrder.push(++callOrder);
    if (mockImplementationOnce.length) {
      impl = mockImplementationOnce.shift()!;
    }
    return impl?.apply(this, args);
  }

  spyState.willCall(willCall);

  Object.defineProperty(spyFn, 'mock', {
    get: (): MockContext<T> => ({
      get calls() {
        return spyState.calls;
      },
      get lastCall() {
        return spyState.calls[spyState.callCount - 1];
      },
      get instances() {
        return mockState.instances;
      },
      get contexts() {
        return mockState.contexts;
      },
      get invocationCallOrder() {
        return mockState.invocationCallOrder;
      },
      get results() {
        return spyState.results.map(([resultType, value]) => {
          const type =
            resultType === 'error' ? ('throw' as const) : ('return' as const);
          return { type: type, value };
        });
      },
      get settledResults() {
        return spyState.resolves.map(([resultType, value]) => {
          const type =
            resultType === 'error'
              ? ('rejected' as const)
              : ('fulfilled' as const);
          return { type, value };
        });
      },
    }),
  });

  spyFn.mockClear = () => {
    mockState = initMockState();
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
    mockName = mockFn?.name;
  };

  mocks.add(spyFn);

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

export const spyOn = <T extends Record<string, any>, K extends keyof T>(
  obj: T,
  methodName: K,
  accessType?: 'get' | 'set',
): MockInstance<T[K]> => {
  const accessTypeMap = {
    get: 'getter',
    set: 'setter',
  };

  const method = accessType
    ? { [accessTypeMap[accessType]]: methodName }
    : methodName;

  return wrapSpy(obj, method as string);
};

export const isMockFunction = (fn: any): fn is MockInstance =>
  typeof fn === 'function' && '_isMockFunction' in fn && fn._isMockFunction;
