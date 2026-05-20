/**
 * Mirrors the jsdom fixture's setup-spy.ts but for happy-dom. happy-dom
 * exposes the same Element/HTMLElement/Node globals jsdom does, so the
 * vendor-style focus monkey-patch + descriptor-history recording is
 * portable. softResetEnv's protoSnapshot path handles both env names.
 */
if (typeof HTMLElement !== 'undefined') {
  const preDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'focus',
  );
  (
    globalThis as { __soft_focus_descriptor_history__?: Array<string> }
  ).__soft_focus_descriptor_history__ ??= [];
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
