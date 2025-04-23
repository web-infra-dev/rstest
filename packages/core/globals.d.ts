declare global {
  const test: typeof import('@rstest/core')['test'];
  const describe: typeof import('@rstest/core')['describe'];
  const it: typeof import('@rstest/core')['it'];
  const expect: typeof import('@rstest/core')['expect'];
  const beforeAll: typeof import('@rstest/core')['beforeAll'];
  const afterAll: typeof import('@rstest/core')['afterAll'];
  const beforeEach: typeof import('@rstest/core')['beforeEach'];
  const afterEach: typeof import('@rstest/core')['afterEach'];
  const rstest: typeof import('@rstest/core')['rstest'];
}
export {};
