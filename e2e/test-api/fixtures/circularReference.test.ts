import { expect, it } from '@rstest/core';

class A {
  constructor(readonly b: B) {}
}

class B {
  a: A = new A(this);
}

it('should throw AssertionError', () => {
  const b = new B();
  expect(b.a).toEqual(undefined);
});
