// Shared setupFile: every test file in this fixture re-evaluates this
// module (rstest re-runs setupFiles per file). The spy and the
// HTMLElement.prototype.focus assignment are deliberate cross-file leaks
// that soft mode must clean up between files.
import { rstest } from '@rstest/core';

// Spy on Element.prototype.getBoundingClientRect — registered with
// tinyspy's worker-scope `spies` Set; soft mode's `restoreAll()` between
// files restores the original method so file N+1's setupFile creates a
// fresh spy on the original (not a spy-of-a-spy).
if (typeof Element !== 'undefined') {
  rstest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        top: 0,
        left: 0,
        right: 100,
        bottom: 100,
        toJSON: () => ({}),
      }) as DOMRect,
  );
}

// Vendor-style monkey-patch on HTMLElement.prototype.focus — mirrors what
// `@testing-library/user-event`'s `patchFocus` does (replaces the value
// descriptor with a getter-only one via `Object.defineProperty`). Without
// soft mode's prototype snapshot+restore, file N+1's vendor code that
// re-assigns via `prototype.focus = fn` would throw "has only a getter".
//
// Before re-patching, capture the current descriptor's *shape* so tests
// can assert that soft mode reset it back to the original `value+writable`
// form between files. After re-patching, the descriptor is getter-only
// again, so we can't observe the reset by inspecting the descriptor at
// test time — we have to look BEFORE the patch runs.
if (typeof HTMLElement !== 'undefined') {
  const preDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'focus',
  );
  (
    globalThis as { __soft_focus_descriptor_history__?: Array<string> }
  ).__soft_focus_descriptor_history__ ??= [];
  // 'value' = original / restored; 'get-only' = a prior file's patch is
  // still in place; 'missing' = something destroyed the property.
  (
    globalThis as { __soft_focus_descriptor_history__?: Array<string> }
  ).__soft_focus_descriptor_history__!.push(
    !preDescriptor
      ? 'missing'
      : 'value' in preDescriptor && typeof preDescriptor.value === 'function'
        ? 'value'
        : preDescriptor.get && !preDescriptor.set
          ? 'get-only'
          : 'other',
  );

  const originalFocus = HTMLElement.prototype.focus;
  Object.defineProperty(HTMLElement.prototype, 'focus', {
    configurable: true,
    get: () =>
      function patchedFocus(this: HTMLElement, options?: FocusOptions) {
        (globalThis as { __soft_focus_calls__?: number }).__soft_focus_calls__ =
          ((globalThis as { __soft_focus_calls__?: number })
            .__soft_focus_calls__ ?? 0) + 1;
        return originalFocus.call(this, options);
      },
  });
}
