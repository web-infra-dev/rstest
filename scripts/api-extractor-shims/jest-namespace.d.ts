// Shim for api-extractor: the rolled-up dist/*.d.ts of @rstest/core embeds
// `JestAssertion extends jest.Matchers<...>` from @vitest/expect, but rslib's
// d.ts emit drops the `declare global { namespace jest }` block that defines
// the namespace. This shim provides a minimal declaration so api-extractor
// can resolve the symbol. It is consumed only by api-extractor, never shipped.
declare global {
  namespace jest {
    interface Matchers<R, T = any> {}
  }
}

export {};
