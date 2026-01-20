import type { Mock } from '../../types';

type Key = string | symbol;

export type CreateMockInstanceFn = (options?: {
  prototypeMembers?: Key[];
  name?: Key;
  originalImplementation?: (...args: any[]) => any;
  keepMembersImplementation?: boolean;
}) => Mock;

export interface MockObjectOptions {
  globalConstructors: GlobalConstructors;
  createMockInstance: CreateMockInstanceFn;
  /**
   * 'automock' - Replace functions with empty mocks
   * 'autospy' - Wrap functions to track calls while keeping original behavior
   */
  type: 'automock' | 'autospy';
}

export interface GlobalConstructors {
  Object: typeof Object;
  Function: typeof Function;
  Array: typeof Array;
  Map: typeof Map;
  RegExp: typeof RegExp;
}

/**
 * Get the type name of a value using Object.prototype.toString
 */
function getTypeName(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1);
}

/**
 * Check if value is a plain object (not a special built-in object)
 */
function isPlainObject(value: unknown): value is Record<Key, any> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const type = getTypeName(value);
  return type === 'Object' || type === 'Module';
}

/**
 * Check if value is a function
 */
function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === 'function';
}

/**
 * Check if a property is a built-in readonly property (e.g., function's name, length)
 */
function isBuiltinReadonly(target: unknown, prop: Key): boolean {
  const builtinFunctionProps = [
    'arguments',
    'callee',
    'caller',
    'length',
    'name',
  ];
  const builtinRegExpProps = ['source', 'global', 'flags'];

  const type = getTypeName(target);

  if (builtinFunctionProps.includes(prop as string)) {
    return type === 'Function' || type === 'AsyncFunction';
  }

  if (builtinRegExpProps.includes(prop as string)) {
    return type === 'RegExp';
  }

  return false;
}

/**
 * Collect all method names from an object's prototype chain
 */
function collectPrototypeMethods(proto: any): Key[] {
  const methods: Key[] = [];
  let current = proto;

  while (current && current !== Object.prototype) {
    for (const key of [
      ...Object.getOwnPropertyNames(current),
      ...Object.getOwnPropertySymbols(current),
    ]) {
      if (key === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor?.value && typeof descriptor.value === 'function') {
        methods.push(key);
      }
    }
    current = Object.getPrototypeOf(current);
  }

  return methods;
}

/**
 * Get all enumerable properties of an object (including prototype chain, excluding built-in prototypes)
 */
function getEnumerableProperties(
  obj: any,
  constructors: GlobalConstructors,
): Key[] {
  const props = new Set<Key>();
  const isModule = getTypeName(obj) === 'Module' || obj.__esModule;

  // Modules only collect own properties
  if (isModule) {
    for (const k of Object.getOwnPropertyNames(obj)) {
      props.add(k);
    }
    for (const k of Object.getOwnPropertySymbols(obj)) {
      props.add(k);
    }
    return [...props];
  }

  // Regular objects collect properties from prototype chain until reaching built-in prototypes
  const builtinPrototypes = [
    constructors.Object.prototype,
    constructors.Function.prototype,
    constructors.Array.prototype,
    constructors.Map.prototype,
    constructors.RegExp.prototype,
  ];

  let current = obj;
  while (current && !builtinPrototypes.includes(current)) {
    for (const key of [
      ...Object.getOwnPropertyNames(current),
      ...Object.getOwnPropertySymbols(current),
    ]) {
      if (key !== 'constructor') {
        props.add(key);
      }
    }
    current = Object.getPrototypeOf(current);
  }

  return [...props];
}

/**
 * Deeply mock an object
 *
 * Core algorithm:
 * 1. Iterate over all properties of the object
 * 2. Functions → replace with mock functions (automock) or wrap as spy (autospy)
 * 3. Plain objects → process recursively
 * 4. Arrays → empty in automock mode, process elements recursively in autospy mode
 * 5. Primitive values → keep unchanged
 * 6. Use WeakMap to track processed objects and avoid circular references
 */
export function mockObject<T extends Record<Key, any>>(
  options: MockObjectOptions,
  object: T,
  mockExports: Record<Key, any> = {},
): T {
  const { createMockInstance, globalConstructors, type } = options;
  const isSpyMode = type === 'autospy';

  // Track processed object references to prevent infinite recursion from circular references
  const processedRefs = new WeakMap();
  // Deferred assignment queue for handling circular references
  const deferredAssignments: (() => void)[] = [];

  /**
   * Create a mock instance for a function
   */
  const createFunctionMock = (fn: (...args: any[]) => any): Mock => {
    const prototypeMembers = fn.prototype
      ? collectPrototypeMethods(fn.prototype)
      : [];

    return createMockInstance({
      name: fn.name,
      prototypeMembers,
      originalImplementation: isSpyMode ? fn : undefined,
      keepMembersImplementation: isSpyMode,
    });
  };

  /**
   * Process a single value and return the mocked value
   */
  const processValue = (value: any): any => {
    // Return primitive values as-is
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'object' && typeof value !== 'function') {
      return value;
    }

    // Already a mock function, return as-is
    if (value._isMockFunction) {
      return value;
    }

    // Check if already processed (circular reference)
    if (typeof value === 'object' && processedRefs.has(value)) {
      return processedRefs.get(value);
    }

    // Handle functions
    if (isFunction(value)) {
      const mock = createFunctionMock(value);
      // Functions may also have properties, process them recursively
      processProperties(value, mock);
      return mock;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (!isSpyMode) {
        // automock mode: return empty array
        return [];
      }
      // autospy mode: process array elements recursively
      return value.map(processValue);
    }

    // Handle plain objects
    if (isPlainObject(value)) {
      const result: Record<Key, any> = {};
      processedRefs.set(value, result);
      processProperties(value, result);
      return result;
    }

    // Other types (Date, RegExp, Map, etc.) return as-is
    return value;
  };

  /**
   * Process all properties of an object
   */
  const processProperties = (
    source: Record<Key, any>,
    target: Record<Key, any>,
  ): void => {
    const props = getEnumerableProperties(source, globalConstructors);
    const isModule = getTypeName(source) === 'Module' || source.__esModule;

    for (const prop of props) {
      // Skip built-in readonly properties
      if (isBuiltinReadonly(source, prop)) {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(source, prop);
      if (!descriptor) continue;

      // Handle getter/setter (non-module)
      if (!isModule && descriptor.get) {
        try {
          if (isSpyMode) {
            Object.defineProperty(target, prop, descriptor);
          } else {
            // automock mode: getter returns undefined
            Object.defineProperty(target, prop, {
              configurable: descriptor.configurable,
              enumerable: descriptor.enumerable,
              get: () => undefined,
              set: descriptor.set ? () => {} : undefined,
            });
          }
        } catch {
          // Ignore definition failures
        }
        continue;
      }

      const value = source[prop];

      // Check for circular references
      if (value && typeof value === 'object' && processedRefs.has(value)) {
        // Defer assignment until all objects are processed
        deferredAssignments.push(() => {
          target[prop] = processedRefs.get(value);
        });
        continue;
      }

      // Process and assign the value
      try {
        target[prop] = processValue(value);
      } catch {
        // Ignore assignment failures (some properties may be readonly)
      }
    }
  };

  // Start processing
  processedRefs.set(object, mockExports);
  processProperties(object, mockExports);

  // Execute deferred assignments to resolve circular references
  for (const assign of deferredAssignments) {
    assign();
  }

  return mockExports as T;
}
