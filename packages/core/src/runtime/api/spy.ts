import { getInternalState, internalSpyOn, type SpyInternalImpl } from 'tinyspy';
import type {
  FunctionLike,
  Mock,
  MockContext,
  MockFn,
  MockInstance,
  NormalizedProcedure,
  RstestUtilities,
} from '../../types';
import type { CreateMockInstanceFn } from './mockObject';

const isMockFunction = (fn: any): fn is MockInstance =>
  typeof fn === 'function' && '_isMockFunction' in fn && fn._isMockFunction;

export const initSpy = (): Pick<
  RstestUtilities,
  'isMockFunction' | 'spyOn' | 'fn'
> & {
  mocks: Set<MockInstance>;
  createMockInstance: CreateMockInstanceFn;
} => {
  let callOrder = 0;
  const mocks: Set<MockInstance> = new Set<MockInstance>();

  const wrapSpy = <T extends FunctionLike>(
    obj: Record<string, any>,
    methodName: string,
    mockFn?: NormalizedProcedure<T>,
  ): Mock<T> => {
    const spyImpl = internalSpyOn(obj, methodName, mockFn) as SpyInternalImpl<
      Parameters<T>,
      ReturnType<T>
    >;

    const spyFn = spyImpl as unknown as Mock<T>;

    let mockImplementationOnce: NormalizedProcedure<T>[] = [];
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

  const fn: MockFn = <T extends FunctionLike>(mockFn?: T) => {
    const defaultName = 'rstest.fn()';

    return wrapSpy(
      {
        [defaultName]: mockFn,
      },
      defaultName,
      mockFn,
    );
  };

  const spyOn = <T extends Record<string, any>, K extends keyof T>(
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

  /**
   * Creates a mock instance for use with mockObject.
   * This creates a mock function that can optionally preserve the original implementation
   * and support prototype members for class mocking.
   */
  const createMockInstance = (options?: {
    prototypeMembers?: (string | symbol)[];
    name?: string | symbol;
    originalImplementation?: (...args: any[]) => any;
    keepMembersImplementation?: boolean;
  }): Mock => {
    const {
      name,
      originalImplementation,
      prototypeMembers = [],
      keepMembersImplementation = false,
    } = options || {};
    const mockName = name ? String(name) : 'rstest.fn()';

    // Check if the original implementation is a class constructor
    const isClass =
      originalImplementation &&
      /^class\s/.test(Function.prototype.toString.call(originalImplementation));

    // For class constructors, we need special handling
    if (isClass && originalImplementation) {
      // Create a wrapper function that can be called with 'new'
      const classWrapper = function (
        this: any,
        ...args: any[]
      ): ReturnType<typeof originalImplementation> {
        // Use Reflect.construct to properly instantiate the class
        const instance = Reflect.construct(
          originalImplementation,
          args,
          new.target || originalImplementation,
        );

        // If keepMembersImplementation is true, wrap instance methods as spies
        if (keepMembersImplementation && prototypeMembers.length > 0) {
          for (const memberName of prototypeMembers) {
            const originalMethod = instance[memberName];
            if (typeof originalMethod === 'function') {
              // Create a spy for each prototype method
              const methodSpy = wrapSpy(
                instance,
                memberName as string,
                originalMethod.bind(instance),
              );
              instance[memberName] = methodSpy;
            }
          }
        }

        return instance;
      } as any;

      // Make the wrapper behave like a constructor
      Object.defineProperty(classWrapper, 'name', {
        value: mockName,
        configurable: true,
      });

      // Copy the prototype
      classWrapper.prototype = originalImplementation.prototype;

      // Create the mock using the class wrapper
      const mock = wrapSpy(
        {
          [mockName]: classWrapper,
        },
        mockName,
        classWrapper,
      );

      // Make sure the mock can be used with 'new'
      Object.setPrototypeOf(mock, Function.prototype);
      mock.prototype = originalImplementation.prototype;

      return mock;
    }

    // Create a base mock function for non-class functions
    const mock = wrapSpy(
      {
        [mockName]: originalImplementation,
      },
      mockName,
      originalImplementation,
    );

    // For class constructors, we need to set up the prototype
    if (prototypeMembers.length > 0 && originalImplementation?.prototype) {
      // Copy prototype to the mock
      Object.setPrototypeOf(mock.prototype, originalImplementation.prototype);
    }

    return mock;
  };

  return {
    isMockFunction,
    spyOn,
    fn,
    mocks,
    createMockInstance,
  };
};
