import { describe, expect, it } from '@rstest/core';

let nameFunctionCalled = false;

function Component() {
  nameFunctionCalled = true;
}

describe(Component, () => {
  it('uses the function name without invoking the function', ({ expect }) => {
    expect(nameFunctionCalled).toBe(false);
  });
});

let testNameFunctionCalled = false;

function testName() {
  testNameFunctionCalled = true;
}

it(testName, ({ expect }) => {
  expect(testNameFunctionCalled).toBe(false);
});

let tableNameFunctionCalled = false;

function tableCaseName() {
  tableNameFunctionCalled = true;
}

it.each([1])(tableCaseName, () => {
  expect(tableNameFunctionCalled).toBe(false);
});

it.for([2])(tableCaseName, () => {
  expect(tableNameFunctionCalled).toBe(false);
});
