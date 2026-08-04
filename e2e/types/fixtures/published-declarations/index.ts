import { expect, test, type FixtureLifecycle } from '@rstest/core';

expect(true).toBe(true);

const namedFixtureTest = test
  .extend({ base: 'base' })
  .extend('count', async ({ base, task }, { onCleanup }) => {
    onCleanup(() => Promise.resolve());
    expect(task.name).toBeTypeOf('string');
    return base.length;
  })
  .extend('createLabel', () => async () => 'label');

namedFixtureTest(
  'exposes inferred named fixture types',
  async ({ count, createLabel }) => {
    expect(count).toBeTypeOf('number');
    expect(await createLabel()).toBeTypeOf('string');
  },
);

const lifecycle: FixtureLifecycle = {
  onCleanup(cleanup) {
    void cleanup;
  },
};
void lifecycle;

const predicate = (value: string) => value.length > 0;

// @ts-expect-error callable values must be returned by named fixture functions
test.extend('predicate', predicate);

test.extend('predicate', () => predicate)(
  'exposes callable fixture values returned by fixture functions',
  ({ predicate }) => {
    expect(predicate('value')).toBeTypeOf('boolean');
  },
);

// @ts-expect-error fixture options are not part of the named fixture form
test.extend('value', {}, 'value');
