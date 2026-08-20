import { afterAll, beforeAll, describe } from '@rstest/core';

const logUnexpectedHook = (hook: string) => {
  console.log(`[empty-suite-hook] ${hook}`);
};

beforeAll(() => logUnexpectedHook('root beforeAll'));
afterAll(() => logUnexpectedHook('root afterAll'));

describe('no tests', () => {
  beforeAll(() => logUnexpectedHook('suite beforeAll'));
  afterAll(() => logUnexpectedHook('suite afterAll'));

  describe('nested no tests', () => {
    beforeAll(() => logUnexpectedHook('nested beforeAll'));
    afterAll(() => logUnexpectedHook('nested afterAll'));
  });
});
