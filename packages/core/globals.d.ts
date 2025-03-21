declare global {
  const test: typeof import('@rstest/core')['test'];
  const describe: typeof import('@rstest/core')['describe'];
  const it: typeof import('@rstest/core')['it'];
  const expect: typeof import('@rstest/core')['expect'];
}
export {};
