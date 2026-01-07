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
