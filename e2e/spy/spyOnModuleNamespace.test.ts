import { describe, expect, it, rstest } from '@rstest/core';

// Follow-up for https://github.com/web-infra-dev/rstest/issues/1492
// Spying a non-configurable export of an ES module namespace (a native ES
// module, e.g. an externalized dependency in the `node` test environment) can't
// redefine the binding. Instead of a bare "Cannot redefine property", rstest
// throws an actionable error pointing at `rs.mock(..., { spy: true })`. The
// guard is deliberately precise: it fires ONLY for a `[object Module]` namespace
// whose target export is non-configurable — ordinary non-configurable object
// properties keep their original error.
describe('spyOn on a frozen ES module namespace export', () => {
  const makeModuleNamespace = <K extends string>(
    name: K,
    configurable: boolean,
  ): Record<K, () => string> => {
    const ns = {} as Record<K, () => string>;
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' });
    Object.defineProperty(ns, name, {
      value: () => 'real',
      enumerable: true,
      configurable,
    });
    return ns;
  };

  const messageOf = (fn: () => void): string => {
    try {
      fn();
      return '<did not throw>';
    } catch (error) {
      return (error as Error).message;
    }
  };

  it('throws an actionable error recommending rs.mock spy', () => {
    const ns = makeModuleNamespace('captureException', false);
    const message = messageOf(() => rstest.spyOn(ns, 'captureException'));

    expect(message).toContain('[Rstest]');
    expect(message).toContain("rs.mock('<module>', { spy: true })");
  });

  it('leaves ordinary non-configurable properties with their original error', () => {
    const obj: Record<PropertyKey, unknown> = {};
    Object.defineProperty(obj, 'method', {
      value: () => 'x',
      configurable: false,
    });

    const message = messageOf(() =>
      rstest.spyOn(obj as Record<string, () => string>, 'method'),
    );

    expect(message).toContain('Cannot redefine property');
    expect(message).not.toContain('[Rstest]');
  });

  it('does not fire for a module namespace with a configurable (spyable) export', () => {
    const ns = makeModuleNamespace('greet', true);

    const spy = rstest.spyOn(ns, 'greet');
    ns.greet();
    expect(spy).toHaveBeenCalled();
  });
});
