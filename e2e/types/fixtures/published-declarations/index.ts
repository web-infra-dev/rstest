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

const fileFixtureTest = test
  .extend('fileBase', { scope: 'file' }, (_context, { onCleanup }) => {
    onCleanup(() => Promise.resolve());
    // @ts-expect-error file fixtures do not receive TestContext
    void _context.task;
    return { value: 42 };
  })
  .extend('fileValue', { scope: 'file' }, ({ fileBase }) => fileBase.value)
  .extend('testValue', ({ fileValue, task }) => `${task.name}:${fileValue}`);

fileFixtureTest('exposes inferred file fixture types', ({ fileValue }) => {
  expect(fileValue).toBeTypeOf('number');
});

// @ts-expect-error file-scoped fixtures cannot be overridden
fileFixtureTest.extend('fileValue', () => 1);

// @ts-expect-error object fixtures cannot override file-scoped fixtures
fileFixtureTest.extend({ fileBase: { value: 1 } });

fileFixtureTest.extend(
  'invalidFile',
  { scope: 'file' },
  // @ts-expect-error file-scoped fixtures cannot depend on test-scoped fixtures
  ({ testValue }) => testValue.length,
);

const workerFixtureTest = test
  .extend('workerBase', { scope: 'worker' }, (_context, { onCleanup }) => {
    onCleanup(() => Promise.resolve());
    // @ts-expect-error worker fixtures do not receive TestContext
    void _context.task;
    return { value: 42 };
  })
  .extend(
    'workerValue',
    { scope: 'worker' },
    ({ workerBase }) => workerBase.value,
  )
  .extend(
    'workerFileValue',
    { scope: 'file' },
    ({ workerValue }) => workerValue,
  );

workerFixtureTest(
  'exposes inferred worker fixture types',
  ({ workerValue, workerFileValue }) => {
    expect(workerValue).toBeTypeOf('number');
    expect(workerFileValue).toBeTypeOf('number');
  },
);

// @ts-expect-error object fixtures cannot override worker-scoped fixtures
workerFixtureTest.extend({ workerBase: { value: 1 } });

const predicate = (value: string) => value.length > 0;
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const broadlyTypedFunction: Function = predicate;
const broadlyTypedCallable: CallableFunction = predicate;
class Service {
  name = 'service';
}

// @ts-expect-error callable values must be returned by named fixture functions
test.extend('predicate', predicate);

// @ts-expect-error broadly typed functions are still callable at runtime
test.extend('broadFunction', broadlyTypedFunction);

// @ts-expect-error broadly typed callable values are fixture functions at runtime
test.extend('broadCallable', broadlyTypedCallable);

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
  patternName: `slot${string}`,
  unionName: 'left' | 'right',
) => {
  // @ts-expect-error named fixture names must be statically known
  test.extend('prefix', 'prefix').extend(fixtureName, 42);

  // @ts-expect-error patterned names do not identify one context field
  test.extend(patternName, 42);

  // @ts-expect-error named fixture names must be JavaScript identifiers
  test.extend('base-url', 'https://example.com');

  // @ts-expect-error named fixture names cannot replace TestContext fields
  test.extend('expect', 'fixture');

  // @ts-expect-error named fixture names cannot replace internal context fields
  test.extend('_useLocalExpect', false);

  test.extend('name', 'fixture')('supports Function property names', (ctx) => {
    expect(ctx.name).toBeTypeOf('string');
  });

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

// @ts-expect-error named fixture options must select file scope
test.extend('value', {}, 'value');
