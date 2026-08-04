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
class Service {
  name = 'service';
}

// @ts-expect-error callable values must be returned by named fixture functions
test.extend('predicate', predicate);

// @ts-expect-error constructable values must be returned by named fixture functions
test.extend('service', Service);

test.extend('predicate', () => predicate)(
  'exposes callable fixture values returned by fixture functions',
  ({ predicate }) => {
    expect(predicate('value')).toBeTypeOf('boolean');
  },
);

test.extend('service', () => Service)(
  'exposes constructable fixture values returned by fixture functions',
  ({ service }) => {
    expect(new service().name).toBeTypeOf('string');
  },
);

const checkNamedFixtureNameTypes = (
  fixtureName: string,
  unionName: 'left' | 'right',
) => {
  // @ts-expect-error named fixture names must be statically known
  test.extend('prefix', 'prefix').extend(fixtureName, 42);

  const unionFixtureTest = test
    .extend('prefix', 'prefix')
    .extend(unionName, 42);
  unionFixtureTest('models union names as alternative contexts', (ctx) => {
    const prefix: string = ctx.prefix;
    void prefix;
    // @ts-expect-error neither union member is guaranteed to be registered
    void ctx.left;
  });
};
void checkNamedFixtureNameTypes;

// @ts-expect-error fixture options are not part of the named fixture form
test.extend('value', {}, 'value');
