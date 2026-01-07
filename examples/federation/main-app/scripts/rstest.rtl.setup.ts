import { expect } from '@rstest/core';

// Try to use @testing-library/jest-dom if available; otherwise provide a small
// subset of matchers so this example can run without extra deps.
let matchers: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  matchers = require('@testing-library/jest-dom/matchers');
} catch {
  // ignore
}

if (matchers) {
  expect.extend(matchers);
} else {
  expect.extend({
    toBeInTheDocument(received: any) {
      const pass =
        Boolean(received) && received.ownerDocument?.contains?.(received);
      return {
        pass,
        message: () =>
          pass
            ? 'expected element not to be in the document'
            : 'expected element to be in the document',
      };
    },
    toHaveAttribute(received: any, name: string, expected?: string) {
      const actual = received?.getAttribute?.(name);
      const pass =
        typeof expected === 'undefined' ? actual != null : actual === expected;
      return {
        pass,
        message: () =>
          pass
            ? `expected element not to have attribute ${name}`
            : `expected attribute ${name} to be ${String(expected)}, got ${String(actual)}`,
      };
    },
  });
}
// Module Federation runtime picks the "web" script loader whenever it detects a DOM.
// In JSDOM, that loader can't reliably execute remoteEntry scripts. Force the runtime
// into the Node loader path (fetch + vm evaluation) while keeping RTL on JSDOM.
// MF SDK treats any value other than "web" as "node-like".
// eslint-disable-next-line no-restricted-globals
(globalThis as any).ENV_TARGET = 'node';
