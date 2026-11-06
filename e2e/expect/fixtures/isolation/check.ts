import { afterAll, expect, it } from '@rstest/core';

declare module '@rstest/core' {
  interface Assertion {
    toFileValue(): void;
    toContextValue(): void;
    toSetupValue(): void;
  }
}

export function registerExtensions() {
  expect.addEqualityTesters([
    (a, b) =>
      a?.equalGroup === true && b?.equalGroup === true ? true : undefined,
    (a, b) =>
      a?.equalGroup === true && b?.equalGroup === true ? false : undefined,
  ]);
  expect.extend({
    toFileValue: (value) => ({
      pass: value === 'file',
      message: () => 'expected file',
    }),
    toBe: () => ({ pass: false, message: () => 'first override' }),
  });
  expect.extend({
    toBe: (value) => ({
      pass: value === 'override',
      message: () => 'expected override',
    }),
  });
}

export function checkExtensions() {
  const firstFile =
    Reflect.get(process, Symbol.for('rstest.e2e.expectExtension.fileCount')) ===
    1;

  it('keeps expect extensions usable within the file', ({
    expect: contextExpect,
  }) => {
    const shared = process.env.EXPECT_EXTENSION_SHARED === 'true' && !firstFile;
    expect(Object.hasOwn(contextExpect, 'toFileValue')).toEqual(shared);
    expect(Object.hasOwn(contextExpect, 'toContextValue')).toEqual(shared);
    expect('setup').toSetupValue();
    registerExtensions();
    contextExpect.extend({
      toContextValue: (value) => ({
        pass: value === 'context',
        message: () => 'expected context',
      }),
    });
    expect({ equalGroup: true, value: 1 }).toEqual({
      equalGroup: true,
      value: 2,
    });
    contextExpect({ equalGroup: true, value: 1 }).toStrictEqual({
      equalGroup: true,
      value: 2,
    });
    expect('file').toFileValue();
    contextExpect('file').toFileValue();
    expect('context').toContextValue();
    contextExpect('context').toContextValue();
    expect('file').toEqual(Reflect.get(expect, 'toFileValue')());
    expect('other').toEqual(Reflect.get(expect.not, 'toFileValue')());
    contextExpect('context').toEqual(
      Reflect.get(contextExpect, 'toContextValue')(),
    );
    expect('other').toEqual(Reflect.get(expect.not, 'toContextValue')());
    expect('override').toBe('different');
    expect('setup').toMatchInlineSnapshot('from setup');
    expect({ number: 1 }).toMatchInlineSnapshot(`
      {
        "number": 1,
      }
    `);
    expect.addSnapshotSerializer({
      test: (value) => value === 'value',
      serialize: () => 'first',
    });
    expect('value').toMatchInlineSnapshot('first');
    expect.addSnapshotSerializer({
      test: (value) => value === 'value',
      serialize: () => 'latest',
    });
    expect('value').toMatchInlineSnapshot('latest');
    if (firstFile && process.env.EXPECT_EXTENSION_FAILURE === 'test') {
      throw new Error('EXPECT_EXTENSION_EXPECTED_TEST_FAILURE');
    }
  });

  afterAll(() => {
    expect('file').toFileValue();
    expect('context').toContextValue();
    expect({ equalGroup: true, value: 1 }).toEqual({
      equalGroup: true,
      value: 2,
    });
    expect('value').toMatchInlineSnapshot('latest');
    if (firstFile && process.env.EXPECT_EXTENSION_FAILURE === 'teardown') {
      throw new Error('EXPECT_EXTENSION_EXPECTED_TEARDOWN_FAILURE');
    }
  });
}
