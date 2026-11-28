import {
  getInternalState,
  internalSpyOn,
  spies as tinyspySpies,
  type SpyInternalImpl,
} from 'tinyspy';
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
import {
  isCleanupMethod,
  MockRegistry,
  type TrackedMock,
} from './mockRegistry';

const isMockFunction = (fn: any): fn is MockInstance =>
  typeof fn === 'function' && '_isMockFunction' in fn && fn._isMockFunction;

type MockHistory<T extends FunctionLike = FunctionLike> = Omit<
  MockContext<T>,
  'lastCall'
>;

type MockConfig = {
  implementation?: FunctionLike;
  once: FunctionLike[];
};

type RealmMockFactory = (implementation: FunctionLike) => FunctionLike;

type ProjectMocks = MockRegistry<MockHistory, MockConfig>;

export const initSpy = (
  // The running file's project key (`workerState.project`). The `rstest`
  // singleton is shared by a reused worker, which under `isolate: false` can
  // serve several projects; scoping the registry by project keeps one project's
  // `*AllMocks` from resetting another project's kept mocks. Defaults to a single
  // bucket for callers (and unit tests) that don't run multiple projects.
  // See https://github.com/web-infra-dev/rstest/pull/1376#discussion_r3458343793.
  getProjectKey: () => string = () => '',
  getRuntimeGlobal: () => Record<string, unknown> = () => globalThis,
): Pick<RstestUtilities, 'isMockFunction' | 'spyOn' | 'fn'> & {
  clearAllMocks: () => void;
  resetAllMocks: () => void;
  discardMockState: () => void;
  restoreAllSpies: () => void;
  createMockInstance: CreateMockInstanceFn;
  /**
   * Restart `invocationCallOrder` numbering. The spy state lives for the whole
   * worker (the `rstest` singleton), so under `isolate: false` the per-file
   * reset must rewind this counter to mirror the previous per-file rebuild.
   */
  resetCallOrder: () => void;
} => {
  let callOrder = 0;
  const mocksByProject = new Map<string, ProjectMocks>();
  // An overwritten property no longer keeps its spy alive, but its target
  // still needs the original descriptor until the spy is restored.
  const restoresByTarget = new WeakMap<object, Set<() => void>>();
  const realmMockFactories = new WeakMap<object, RealmMockFactory>();
  const realmSpies = new WeakMap<(...args: any[]) => any, MockInstance>();

  const getRealmPromise = (): PromiseConstructor => {
    const promise = getRuntimeGlobal().Promise;
    if (typeof promise !== 'function') {
      throw new TypeError('The runtime global does not provide Promise.');
    }
    return promise as PromiseConstructor;
  };

  const getRealmArray = (): ArrayConstructor => {
    const array = getRuntimeGlobal().Array;
    if (typeof array !== 'function') {
      throw new TypeError('The runtime global does not provide Array.');
    }
    return array as ArrayConstructor;
  };

  const getRealmObject = (): ObjectConstructor => {
    const object = getRuntimeGlobal().Object;
    if (typeof object !== 'function') {
      throw new TypeError('The runtime global does not provide Object.');
    }
    return object as ObjectConstructor;
  };

  const toRealmArray = <T>(values: readonly T[]): T[] => {
    const array = getRealmArray();
    return array === Array ? (values as T[]) : array.from(values);
  };

  const toRealmCall = <T extends readonly unknown[]>(call: T): T =>
    toRealmArray(call) as unknown as T;

  const toRealmResult = <T>(
    type: 'return' | 'throw' | 'incomplete' | 'fulfilled' | 'rejected',
    value: T,
  ): { type: typeof type; value: T } => {
    const object = getRealmObject();
    if (object === Object) {
      return { type, value };
    }
    return object.assign(new object(), { type, value });
  };

  const projectMocks = (): ProjectMocks => {
    const key = getProjectKey();
    let project = mocksByProject.get(key);
    if (!project) {
      project = new MockRegistry<MockHistory, MockConfig>();
      mocksByProject.set(key, project);
    }
    return project;
  };

  const wrapRealmMock = <T extends FunctionLike>(
    spyFn: Mock<T>,
    target: SpyInternalImpl<Parameters<T>, ReturnType<T>>,
    project: ProjectMocks,
    entry: TrackedMock,
  ): Mock<T> => {
    const realmFunction = getRuntimeGlobal().Function;
    if (typeof realmFunction !== 'function' || realmFunction === Function) {
      return spyFn;
    }

    let factory = realmMockFactories.get(realmFunction);
    if (!factory) {
      const createFactory = realmFunction as (
        ...args: string[]
      ) => RealmMockFactory;
      factory = createFactory(
        'implementation',
        'return function(...args) { return new.target ? Reflect.construct(implementation, args, new.target) : implementation.apply(this, args); };',
      );
      realmMockFactories.set(realmFunction, factory);
    }
    const surface = factory(spyFn) as Mock<T>;
    const realmSpy = new Proxy<Mock<T>>(surface, project.traps);

    for (const key of Reflect.ownKeys(target)) {
      if (key === 'caller' || key === 'callee' || key === 'arguments') {
        continue;
      }
      if (key === 'length' || key === 'name' || key === 'prototype') {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor) {
        continue;
      }
      if (typeof descriptor.value === 'function') {
        const value = descriptor.value;
        descriptor.value = (...args: unknown[]) => {
          const result = Reflect.apply(value, spyFn, args);
          if (result === spyFn) {
            return realmSpy;
          }
          if (
            key === 'withImplementation' &&
            result !== null &&
            (typeof result === 'object' || typeof result === 'function') &&
            typeof Reflect.get(result, 'then') === 'function'
          ) {
            return getRealmPromise()
              .resolve(result)
              .then((resolved) => (resolved === spyFn ? realmSpy : resolved));
          }
          return result;
        };
      }
      Object.defineProperty(surface, key, descriptor);
    }

    Object.defineProperty(surface, 'name', {
      configurable: true,
      value: spyFn.name,
    });
    Object.defineProperty(surface, 'length', {
      configurable: true,
      value: spyFn.length,
    });
    // A bare tinyspy mock gets a host-realm default prototype. Keep the
    // wrapper's VM-realm prototype unless the original spy carries a custom
    // prototype that must be preserved for constructor mocks.
    if (
      spyFn.prototype &&
      Object.getPrototypeOf(spyFn.prototype) !== Object.prototype
    ) {
      surface.prototype = spyFn.prototype;
    } else {
      surface.prototype.constructor = realmSpy;
    }
    project.watchRealmWrapper(surface, entry);
    return realmSpy;
  };

  const wrapSpy = <T extends FunctionLike>(
    obj: Record<string, any>,
    methodName: string | { getter: string } | { setter: string },
    mockFn?: NormalizedProcedure<T>,
    registerRestore = false,
  ): Mock<T> => {
    const propertyName =
      typeof methodName === 'string'
        ? methodName
        : Object.values(methodName)[0]!;
    let descriptor: PropertyDescriptor | undefined;
    let current: object | null = obj;
    while (current) {
      descriptor = Object.getOwnPropertyDescriptor(current, propertyName);
      if (descriptor) {
        break;
      }
      current = Object.getPrototypeOf(current);
    }
    const existing =
      typeof methodName === 'string'
        ? descriptor?.value
        : 'getter' in methodName
          ? descriptor?.get
          : descriptor?.set;
    if (typeof existing === 'function') {
      const realmSpy = realmSpies.get(existing);
      if (realmSpy) {
        return realmSpy as Mock<T>;
      }
    }

    const spyImpl = internalSpyOn(obj, methodName, mockFn) as SpyInternalImpl<
      Parameters<T>,
      ReturnType<T>
    >;

    // internalSpyOn also registers the raw spy in tinyspy's global strong Set.
    // Rstest owns restoration, including for spies installed in another realm.
    (tinyspySpies as Set<FunctionLike>).delete(spyImpl);

    // Keep tinyspy's descriptors and function metadata, but own execution so
    // its call wrapper cannot subscribe to the returned Promise a second time.
    const project = projectMocks();
    // tinyspy exposes its raw callable as the constructor of its fresh prototype.
    // Observe changes through that alias while preserving its own call behavior.
    spyImpl.prototype.constructor = new Proxy(spyImpl, project.traps);
    const spyFn = new Proxy(spyImpl, {
      defineProperty: project.traps.defineProperty,
      deleteProperty: project.traps.deleteProperty,
      apply: (_target, thisArg, args) => Reflect.apply(willCall, thisArg, args),
      construct: (_target, args, newTarget) =>
        Reflect.construct(willCall, args, newTarget),
    }) as unknown as Mock<T>;

    // Bind to the creating project even when a reused worker switches projects.
    const entry: TrackedMock = { mock: spyFn, order: 0 };
    let mockName = mockFn?.name;
    const history = (): MockHistory<T> => {
      let state = project.histories.get(entry);
      if (!state) {
        state = {
          calls: [],
          instances: [],
          contexts: [],
          invocationCallOrder: [],
          results: [],
          settledResults: [],
        };
        project.histories.set(entry, state);
      }
      // Each function key is only used with its own call signature.
      return state as MockHistory<T>;
    };

    const config = (): MockConfig => {
      let current = project.configs.get(entry);
      if (!current) {
        current = { implementation: mockFn, once: [] };
        project.configs.set(entry, current);
      }
      return current;
    };

    const spyState = getInternalState(spyImpl);
    let restore = spyState.restore;

    const setMethod = <K extends keyof Mock<T>>(key: K, value: Mock<T>[K]) => {
      // An original setter must receive the callable proxy as its receiver.
      const target = (key in spyImpl ? spyFn : spyImpl) as Mock<T>;
      target[key] = value;
      if (target === spyFn && isCleanupMethod(key)) {
        project.recordOverride(entry, spyImpl, key, value);
      }
    };

    setMethod('getMockName', () => mockName || propertyName);

    setMethod('mockName', (name: string) => {
      mockName = name;

      return spyFn;
    });

    setMethod('getMockImplementation', () => {
      const current = project.configs.get(entry);
      return current?.once.at(-1) ?? current?.implementation ?? mockFn;
    });

    function withImplementation(
      fn: NormalizedProcedure<T>,
      cb: () => Promise<unknown>,
    ): Promise<Mock<T>>;
    function withImplementation(
      fn: NormalizedProcedure<T>,
      cb: () => unknown,
    ): Mock<T>;
    function withImplementation(
      fn: NormalizedProcedure<T>,
      cb: () => unknown,
    ): Mock<T> | Promise<Mock<T>> {
      const current = config();
      const previous = current.implementation;
      const previousOnce = current.once;
      current.implementation = fn;
      current.once = [];

      // If the mock was reset in the meantime, this config is already detached.
      const reset = () => {
        current.implementation = previous;
        current.once = previousOnce;
      };

      try {
        const result = cb();

        if (
          typeof result === 'object' &&
          result !== null &&
          'then' in result &&
          typeof result.then === 'function'
        ) {
          return result.then(
            () => {
              reset();
              return spyFn;
            },
            (error: unknown) => {
              reset();
              throw error;
            },
          );
        }

        reset();
        return spyFn;
      } catch (error) {
        reset();
        throw error;
      }
    }

    setMethod('withImplementation', withImplementation);

    setMethod('mockImplementation', (fn) => {
      config().implementation = fn;
      return spyFn;
    });

    setMethod('mockImplementationOnce', (fn) => {
      config().once.push(fn);
      return spyFn;
    });

    setMethod('mockReturnValue', (value) => {
      return spyFn.mockImplementation((() => value) as T);
    });

    setMethod('mockReturnValueOnce', (value) => {
      return spyFn.mockImplementationOnce((() => value) as T);
    });

    setMethod('mockThrow', (value) => {
      return spyFn.mockImplementation(() => {
        throw value;
      });
    });

    setMethod('mockThrowOnce', (value) => {
      return spyFn.mockImplementationOnce(() => {
        throw value;
      });
    });

    setMethod('mockResolvedValue', (value) => {
      return spyFn.mockImplementation((() =>
        getRealmPromise().resolve(value)) as T);
    });

    setMethod('mockResolvedValueOnce', (value) => {
      return spyFn.mockImplementationOnce((() =>
        getRealmPromise().resolve(value)) as T);
    });

    setMethod('mockRejectedValue', (value) => {
      return spyFn.mockImplementation((() =>
        getRealmPromise().reject(value)) as T);
    });

    setMethod('mockRejectedValueOnce', (value) => {
      return spyFn.mockImplementationOnce((() =>
        getRealmPromise().reject(value)) as T);
    });

    setMethod('mockReturnThis', () => {
      return spyFn.mockImplementation(function (this: ReturnType<T>) {
        return this;
      } as T);
    });

    function willCall(this: unknown, ...args: Parameters<T>) {
      // A call that settles after `mockClear` must not write into the new state.
      const mockState = history();
      const { calls, results, settledResults } = mockState;
      const callIndex = calls.push(args) - 1;
      results[callIndex] = { type: 'incomplete', value: undefined };
      mockState.instances.push(this as ReturnType<T>);
      mockState.contexts.push(this as ThisParameterType<T>);
      mockState.invocationCallOrder.push(++callOrder);
      try {
        const current = project.configs.get(entry);
        const impl = current?.once.length
          ? current.once.shift()!
          : (current?.implementation ?? mockFn ?? spyState.getOriginal());
        const result: ReturnType<T> = impl?.apply(this, args);
        const isObject =
          (typeof result === 'object' && result !== null) ||
          typeof result === 'function';
        if (
          isObject &&
          // The tag finds a promise from another realm (a test's `Promise` in a
          // VM context); `instanceof` finds a subclass with its own tag.
          ((result as object) instanceof Promise ||
            Object.prototype.toString.call(result) === '[object Promise]')
        ) {
          const then: unknown = Reflect.get(result, 'then');
          if (typeof then === 'function') {
            void then.call(
              result,
              (value: Awaited<ReturnType<T>>) => {
                settledResults[callIndex] = { type: 'fulfilled', value };
              },
              (error: unknown) => {
                settledResults[callIndex] = { type: 'rejected', value: error };
              },
            );
          }
        }
        results[callIndex] = {
          type: 'return',
          // `new` returns the instance unless the implementation returns an object.
          value: new.target && !isObject ? (this as ReturnType<T>) : result,
        };
        return result;
      } catch (error) {
        results[callIndex] = { type: 'throw', value: error };
        throw error;
      }
    }

    Object.defineProperty(spyImpl, 'mock', {
      get: (): MockContext<T> => ({
        get calls() {
          if (getRealmArray() === Array) {
            return history().calls.slice();
          }
          return toRealmArray(
            history().calls.map((call) => toRealmCall(call)),
          ) as MockContext<T>['calls'];
        },
        get lastCall() {
          const lastCall = history().calls.at(-1);
          return lastCall
            ? (toRealmCall(lastCall) as MockContext<T>['lastCall'])
            : undefined;
        },
        get instances() {
          return toRealmArray(history().instances);
        },
        get contexts() {
          return toRealmArray(history().contexts);
        },
        get invocationCallOrder() {
          return toRealmArray(history().invocationCallOrder);
        },
        get results() {
          return toRealmArray(
            history().results.map(({ type, value }) =>
              toRealmResult(type, value),
            ),
          ) as MockContext<T>['results'];
        },
        get settledResults() {
          return toRealmArray(
            history().settledResults.map(({ type, value }) =>
              toRealmResult(type, value),
            ),
          ) as MockContext<T>['settledResults'];
        },
      }),
    });

    setMethod('mockClear', () => {
      project.histories.delete(entry);

      return spyFn;
    });

    setMethod('mockReset', () => {
      spyFn.mockClear();
      project.configs.delete(entry);

      return spyFn;
    });

    setMethod('mockRestore', () => {
      spyFn.mockReset();
      restore();
      mockName = mockFn?.name;
    });

    if (Symbol.dispose) {
      Object.defineProperty(spyImpl, Symbol.dispose, {
        value: () => {
          spyFn.mockRestore();
        },
        configurable: true,
      });
    }

    const realmSpy = wrapRealmMock(spyFn, spyImpl, project, entry);
    entry.mock = realmSpy;
    project.register(spyImpl, entry);
    realmSpies.set(spyFn, realmSpy);
    realmSpies.set(realmSpy, realmSpy);
    if (registerRestore) {
      let targetRestores = restoresByTarget.get(obj);
      if (!targetRestores) {
        targetRestores = new Set();
        restoresByTarget.set(obj, targetRestores);
      }
      const restoreSpy = () => {
        spyState.restore();
        if (targetRestores.delete(restoreSpy) && targetRestores.size === 0) {
          restoresByTarget.delete(obj);
        }
        project.restores.delete(ref);
      };
      const ref = new WeakRef(restoreSpy);
      targetRestores.add(restoreSpy);
      project.restores.add(ref);
      restore = restoreSpy;
    }
    descriptor = Object.getOwnPropertyDescriptor(obj, propertyName);
    if (descriptor) {
      if (typeof methodName === 'string') {
        if ('value' in descriptor) {
          descriptor.value = realmSpy;
        } else {
          // tinyspy's accessor initializes the original constructor prototype.
          const getSpy = descriptor.get!;
          descriptor.get = () => {
            getSpy.call(obj);
            return realmSpy;
          };
        }
      } else if ('getter' in methodName) {
        descriptor.get = realmSpy;
      } else {
        descriptor.set = realmSpy as unknown as NonNullable<
          PropertyDescriptor['set']
        >;
      }
      Object.defineProperty(obj, propertyName, descriptor);
    }

    return realmSpy;
  };

  const restoreAllSpies = (): void => {
    const restores = mocksByProject.get(getProjectKey())?.restores;
    if (!restores) return;
    for (const ref of restores) {
      const restore = ref.deref();
      if (restore) {
        restore();
      } else {
        restores.delete(ref);
      }
    }
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
    if (accessType) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, methodName);
      const accessor =
        accessType === 'get'
          ? Reflect.get(descriptor ?? {}, 'get')
          : Reflect.get(descriptor ?? {}, 'set');
      if (typeof accessor === 'function' && isMockFunction(accessor)) {
        return accessor as MockInstance<T[K]>;
      }
    } else {
      const method = obj[methodName];
      if (isMockFunction(method)) {
        return method;
      }
    }

    // A native ES module namespace is an exotic object whose exports can't be
    // redefined — even when the descriptor reports `writable: true` — so
    // installing a spy fails with a bare "Cannot redefine property". Detect that
    // exact object (a `[object Module]`) and throw an actionable error instead.
    // The check matches ONLY a real module namespace, deliberately NOT an
    // `__esModule` interop object from a transpiled CommonJS module: those are
    // ordinary objects whose writable exports tinyspy can still spy, so they
    // must fall through untouched. Bundled deps expose *configurable* getters,
    // so this never fires for them either. See
    // https://github.com/web-infra-dev/rstest/issues/1492
    const targetDescriptor = Object.getOwnPropertyDescriptor(obj, methodName);
    if (
      targetDescriptor?.configurable === false &&
      (obj as Record<PropertyKey, unknown>)[Symbol.toStringTag] === 'Module'
    ) {
      throw new Error(
        `[Rstest] Cannot spy on "${String(methodName)}": it is a read-only export of a third-party or native ES module. Mock the module instead with \`rs.mock('<module>', { spy: true })\`. See https://rstest.rs/api/runtime-api/rstest/mock-functions#rsspyon`,
      );
    }

    const accessTypeMap = {
      get: 'getter',
      set: 'setter',
    };

    const method = accessType
      ? { [accessTypeMap[accessType]]: methodName }
      : methodName;

    return wrapSpy(
      obj,
      method as string | { getter: string } | { setter: string },
      undefined,
      true,
    );
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
      const realmFunction = getRuntimeGlobal().Function;
      Object.setPrototypeOf(
        mock,
        typeof realmFunction === 'function'
          ? realmFunction.prototype
          : Function.prototype,
      );
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
    clearAllMocks: () =>
      mocksByProject.get(getProjectKey())?.clean('mockClear'),
    resetAllMocks: () =>
      mocksByProject.get(getProjectKey())?.clean('mockReset'),
    discardMockState: () => mocksByProject.get(getProjectKey())?.discard(true),
    restoreAllSpies,
    createMockInstance,
    resetCallOrder: () => {
      callOrder = 0;
    },
  };
};
