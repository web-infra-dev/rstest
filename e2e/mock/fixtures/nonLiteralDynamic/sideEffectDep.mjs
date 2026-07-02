// Mocked with a function factory that has an observable side effect, to prove
// the factory runs LAZILY (only when this module is imported natively), not
// eagerly at rs.mock registration time. See mockNonLiteralDynamicImport.test.ts.
export const value = 'REAL_FX';
