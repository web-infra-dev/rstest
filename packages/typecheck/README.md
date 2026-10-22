# @rstest/typecheck

Static type testing for [Rstest](https://rstest.rs). Install it alongside the same version of `@rstest/core` and your project's TypeScript compiler.

```sh
npm install -D @rstest/typecheck typescript
```

```ts
import { describe, test, expectTypeOf } from '@rstest/typecheck';

describe('types', () => {
  test('infers numbers', () => {
    expectTypeOf(1).toEqualTypeOf<number>();
  });
});
```

Save type tests as `*.test-d.ts`, include them in your tsconfig, then run `rstest run --typecheck.only`.

See the [type testing guide](https://rstest.rs/guide/advanced/type-testing) for configuration and supported APIs.
