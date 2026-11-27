import { VM_TIMER_EXPORTS } from '../../runtime/worker/vm/timerExports';

/**
 * VM pools and isolated jsdom/happy-dom files track timers on the test global
 * so teardown can cancel pending callbacks. Forward require('timers') and
 * require('node:timers') in ESM bundles to those same timer functions.
 * Use Reflect.get for the name lookup: Rspack expands `[name]` in banners.
 */
const createVmTimersShim = (nativeRequire: string): string =>
  `const __rstest_native_require = ${nativeRequire};
const __rstest_timer_exports = new Set(${JSON.stringify(VM_TIMER_EXPORTS)});
let __rstest_timers_proxy;
const __rstest_load_timers = (id) => {
  const timers = __rstest_native_require(id);
  const usesGlobalTimers = [...__rstest_timer_exports].some(
    (name) => Reflect.get(timers, name) !== Reflect.get(globalThis, name),
  );
  if (!usesGlobalTimers) return timers;
  if (!__rstest_timers_proxy) {
    __rstest_timers_proxy = new Proxy(timers, {
      get(target, property, receiver) {
        if (typeof property === 'string' && __rstest_timer_exports.has(property)) {
          return globalThis[property];
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }
  return __rstest_timers_proxy;
};
const require = (id) =>
  id === 'timers' || id === 'node:timers'
    ? __rstest_load_timers(id)
    : __rstest_native_require(id);
require.resolve = __rstest_native_require.resolve;
require.main = __rstest_native_require.main;
require.cache = __rstest_native_require.cache;
require.extensions = __rstest_native_require.extensions;`;

export const createRequireBanner = (useTrackedTimers: boolean): string => {
  const nativeRequire =
    '/*#__PURE__*/ __rstest_shim_module__.createRequire(import.meta.url)';
  const requireBinding = useTrackedTimers
    ? createVmTimersShim(nativeRequire)
    : `const require = ${nativeRequire};`;
  return `// Rstest ESM shims
import __rstest_shim_module__ from 'node:module';
${requireBinding}
`;
};
