// Module-level instance shared between the setup file and test files. A mock
// file's pre-flush must run BEFORE setup loads, so setup and test code still
// see the SAME instance (see the identity assertion in b-mock.test.ts).
export const singleton: { tag: string } = { tag: 'shared' };
